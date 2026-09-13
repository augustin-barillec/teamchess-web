import {
  useState,
  useEffect,
  useMemo,
  useRef,
  CSSProperties,
  KeyboardEvent,
} from "react";
import { Toaster, toast } from "react-hot-toast";
import { Chess, Square, Move } from "chess.js";
import {
  Chessboard,
  PieceDropHandlerArgs,
  PieceHandlerArgs,
} from "react-chessboard";
import { GameState, GameStatus, PlayerSide, Side, VoteType } from "./types";
import { UI } from "./messages";
import { calculateMaterial } from "./materialCalc";
import { shouldConfirmTeamAction } from "./confirmUtils";
import { useSocket } from "./hooks/useSocket";
import { NameChangeModal } from "./components/NameChangeModal";
import { ConfirmModal } from "./components/ConfirmModal";
import { PromotionDialog } from "./components/PromotionDialog";
import { PlayerInfoBox } from "./components/PlayerInfoBox";
import { PlayersPanel } from "./components/PlayersPanel";
import { MovesPanel } from "./components/MovesPanel";
import { ChatPanel } from "./components/ChatPanel";
import { VoteBanner } from "./components/VoteBanner";
import { sounds, soundForMove } from "./soundEngine";

/** Seconds left on a side's clock right now, extrapolated from the server's snapshot. */
function secondsLeft(game: GameState, side: PlayerSide, now: number): number {
  const base = side === "white" ? game.whiteTime : game.blackTime;
  const current = game.turns[game.turns.length - 1];
  if (game.turnStartedAt === null || current?.side !== side) return base;
  // Clamped above too: `now` can lag the server's timestamp by up to one tick.
  return Math.max(0, Math.min(base, base - (now - game.turnStartedAt) / 1000));
}

/** How many turns have been played — what a new selection bumps. */
const playedCount = (game: GameState): number =>
  game.turns.filter((t) => t.selection).length;

const countdown = (endTime: number, now: number): number =>
  Math.max(0, Math.ceil((endTime - now) / 1000));

export default function App() {
  const {
    act,
    amDisconnected,
    myId,
    name,
    changeName,
    game,
    chat,
    side,
    rememberSide,
  } = useSocket();
  const { players, status, turns, vote, drawOffer, forfeit, gameOver } = game;

  const amILead = !!myId && myId === game.leadId;

  const chess = useMemo(() => new Chess(game.fen), [game.fen]);
  const current = turns[turns.length - 1];
  const lastSelection = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const selection = turns[i].selection;
      if (selection) return selection;
    }
    return null;
  }, [turns]);

  // One ticker for everything that runs on a deadline: clocks, vote, forfeit.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Sounds are the difference between two snapshots.
  const prevGame = useRef(game);
  useEffect(() => {
    const prev = prevGame.current;
    prevGame.current = game;
    if (prev === game) return;
    if (prev.status === GameStatus.Setup && status !== GameStatus.Setup) {
      sounds.play("start");
    }
    if (status === GameStatus.Setup && prev.status !== GameStatus.Setup) {
      sounds.play("reset");
    }
    // The first move rides on the very submit that started the game, so its start
    // chord is still sounding — staying silent keeps the two from landing together.
    const played = playedCount(game);
    if (played > playedCount(prev) && played > 1 && lastSelection) {
      sounds.play(soundForMove(lastSelection.san));
    }
    if (status === GameStatus.Over && prev.status !== GameStatus.Over) {
      sounds.play("end");
    }
  }, [game, status, lastSelection]);

  const [legalSquareStyles, setLegalSquareStyles] = useState<
    Record<string, CSSProperties>
  >({});
  const [promotionMove, setPromotionMove] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const movesRef = useRef<HTMLDivElement>(null);
  const [isNameModalOpen, setIsNameModalOpen] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [pendingTeamVote, setPendingTeamVote] = useState<VoteType | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const [chatInput, setChatInput] = useState("");
  const orientation: PlayerSide = side === "black" ? "black" : "white";
  const isFinalizing = status === GameStatus.FinalizingTurn;
  const [isMuted, setIsMuted] = useState(sounds.getMuted());

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    sounds.setMuted(next);
  };

  const kingInCheckSquare = useMemo(() => {
    if (!chess.isCheck()) return null;
    const color = chess.turn();
    const board = chess.board();
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = board[row][col];
        if (piece && piece.type === "k" && piece.color === color) {
          return `${"abcdefgh"[col]}${8 - row}`;
        }
      }
    }
    return null;
  }, [chess]);

  const { whiteMaterialDiff, blackMaterialDiff, materialBalance } = useMemo(
    () => calculateMaterial(chess.board()),
    [chess]
  );

  useEffect(() => {
    if (movesRef.current)
      movesRef.current.scrollTop = movesRef.current.scrollHeight;
  }, [turns]);

  useEffect(() => {
    if (isNameModalOpen && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [isNameModalOpen]);

  /** The seat is the server's: its next snapshot is what moves us. */
  const joinSide = (s: Side) => {
    rememberSide(s);
    act({ type: "JOIN_SIDE", payload: { side: s } });
  };

  const autoAssign = () => {
    // An empty side wins the comparison outright, and it is also the one running a
    // forfeit countdown — auto-assign sends the newcomer to the seat that needs taking.
    const whiteCount = players.filter((p) => p.side === "white").length;
    const blackCount = players.filter((p) => p.side === "black").length;
    let chosen: PlayerSide;
    if (whiteCount < blackCount) chosen = "white";
    else if (blackCount < whiteCount) chosen = "black";
    else chosen = Math.random() < 0.5 ? "white" : "black";
    joinSide(chosen);
  };

  const doStartTeamVote = (type: VoteType) =>
    act({ type: "START_TEAM_VOTE", payload: { voteType: type } });

  /**
   * Single gate for every team action: alone on the team, my own yes is the whole
   * quorum and the vote passes the instant it opens, so the modal has to intercept
   * the click first. It confirms via doStartTeamVote to avoid looping through here.
   */
  const startTeamVote = (type: VoteType) => {
    if (
      side !== "spectator" &&
      shouldConfirmTeamAction(players.filter((p) => p.side === side))
    ) {
      setPendingTeamVote(type);
      return;
    }
    doStartTeamVote(type);
  };

  const castVote = (v: "yes" | "no") =>
    act({ type: "VOTE_TEAM", payload: { vote: v } });

  /** Lead power: takes effect immediately, hence the confirmation in the UI. */
  const kickPlayer = (targetId: string) =>
    act({ type: "KICK_PLAYER", payload: { id: targetId } });

  /** Lead power: takes effect immediately, hence the confirmation in the UI. */
  const doResetGame = () => act({ type: "RESET_GAME", payload: null });

  const submitMove = (lan: string) =>
    act({ type: "SUBMIT_MOVE", payload: { lan } });

  const onPromote = (promotionPiece: "q" | "r" | "b" | "n") => {
    if (!promotionMove) return;
    const { from, to } = promotionMove;
    submitMove(from + to + promotionPiece);
    setPromotionMove(null);
  };

  function needsPromotion(from: string, to: string) {
    const piece = chess.get(from as Square);
    if (!piece || piece.type !== "p") return false;
    const rank = to[1];
    return piece.color === "w" ? rank === "8" : rank === "1";
  }

  const hasPlayed = (playerId: string, teamSide: PlayerSide) =>
    !!current &&
    current.side === teamSide &&
    current.proposals.some((p) => p.id === playerId);

  const copyPgn = () => {
    if (!gameOver?.pgn) return;
    const textArea = document.createElement("textarea");
    textArea.value = gameOver.pgn;
    textArea.style.position = "fixed";
    textArea.style.top = "-9999px";
    textArea.style.left = "-9999px";

    try {
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      toast.success(UI.toastPgnCopied);
    } catch (_err) {
      toast.error(UI.toastPgnCopyFailed);
    } finally {
      document.body.removeChild(textArea);
    }
  };

  const openNameModal = () => {
    setNameInput(name);
    setIsNameModalOpen(true);
  };

  const closeNameModal = () => {
    setIsNameModalOpen(false);
  };

  const submitSave = () => {
    const newName = nameInput.trim();
    if (newName && newName !== name) changeName(newName);
    setIsNameModalOpen(false);
  };

  const handleNameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      submitSave();
    } else if (e.key === "Escape") {
      closeNameModal();
    }
  };

  const squareStyles = useMemo(
    () => ({
      ...(lastSelection
        ? {
            [lastSelection.lan.slice(0, 2)]: {
              backgroundColor: "rgba(245,246,110,0.75)",
            },
            [lastSelection.lan.slice(2, 4)]: {
              backgroundColor: "rgba(245,246,110,0.75)",
            },
          }
        : {}),
      ...legalSquareStyles,
      ...(kingInCheckSquare
        ? {
            [kingInCheckSquare]: {
              background:
                "radial-gradient(ellipse at center, rgba(255,0,0,0.5) 0%, rgba(255,0,0,0) 75%)",
            },
          }
        : {}),
    }),
    [lastSelection, legalSquareStyles, kingInCheckSquare]
  );

  const boardOptions = {
    position: game.fen,
    boardOrientation: orientation,
    viewOnly: isFinalizing,
    arePiecesDraggable: side !== "spectator",
    squareStyles,

    // The drop lands on the square under the *cursor*, never under the dragged
    // piece: this ring is the only thing telling the player which one that is.
    // The library default (a 1px inset border) is invisible in practice.
    dropSquareStyle: {
      boxShadow:
        "inset 0 0 0 4px rgba(255,255,255,0.9), inset 0 0 0 6px rgba(0,0,0,0.45)",
    },

    onPieceDrag: ({ square }: PieceHandlerArgs) => {
      const moves = chess.moves({
        square: square as Square,
        verbose: true,
      }) as Move[];
      const highlights: Record<string, CSSProperties> = {};
      moves.forEach((m) => {
        highlights[m.to] = { backgroundColor: "rgba(0,255,0,0.2)" };
      });
      setLegalSquareStyles(highlights);
    },
    onPieceDragEnd: () => {
      setLegalSquareStyles({});
    },
    onPieceDrop: ({ sourceSquare, targetSquare }: PieceDropHandlerArgs) => {
      setLegalSquareStyles({});
      const from = sourceSquare;
      const to = targetSquare;

      if (!from || !to) return false;
      if (status === GameStatus.Setup) {
        if (side !== "white") {
          toast.error(UI.toastOnlyWhiteStart);
          return false;
        }
      } else if (status === GameStatus.AwaitingProposals) {
        if (!current || side !== current.side) {
          return false;
        }
      } else {
        return false;
      }

      const isPromotion = needsPromotion(from, to);
      // Checked on a throwaway board: the one on screen is the server's position.
      try {
        new Chess(game.fen).move({
          from,
          to,
          promotion: isPromotion ? "q" : undefined,
        });
      } catch (_e) {
        toast.error(UI.toastIllegalMove);
        return false;
      }
      if (isPromotion) {
        setPromotionMove({ from, to });
      } else {
        submitMove(from + to);
      }
      return true;
    },
  };

  const boardBlock = (
    <div className="board-wrapper">
      <Chessboard options={boardOptions} />
      <PromotionDialog
        promotionMove={promotionMove}
        turnColor={chess.turn()}
        onPromote={onPromote}
      />
    </div>
  );

  const clockRunning =
    status !== GameStatus.Setup && status !== GameStatus.Over;
  const topSide: PlayerSide = orientation === "white" ? "black" : "white";
  const bottomSide: PlayerSide = orientation;

  const topPlayerInfoBox = (
    <PlayerInfoBox
      clockTime={Math.ceil(secondsLeft(game, topSide, now))}
      lostPieces={topSide === "white" ? whiteMaterialDiff : blackMaterialDiff}
      materialAdv={topSide === "white" ? materialBalance : -materialBalance}
      isActive={clockRunning && current?.side === topSide}
    />
  );

  const renderBottomPlayerInfoBox = (actionSlot?: React.ReactNode) => (
    <PlayerInfoBox
      clockTime={Math.ceil(secondsLeft(game, bottomSide, now))}
      lostPieces={
        bottomSide === "white" ? whiteMaterialDiff : blackMaterialDiff
      }
      materialAdv={bottomSide === "white" ? materialBalance : -materialBalance}
      isActive={clockRunning && current?.side === bottomSide}
      actionSlot={actionSlot}
    />
  );

  const showBoardActions =
    status === GameStatus.AwaitingProposals && side !== "spectator" && !vote;
  const myTeamOfferedDraw = showBoardActions && drawOffer === side;
  const otherTeamOfferingDraw =
    showBoardActions && drawOffer !== null && drawOffer !== side;
  const canAct = showBoardActions && !drawOffer;

  const bottomActionSlot: React.ReactNode = canAct ? (
    <>
      <button
        className="action-icon-btn"
        onClick={() => startTeamVote("resign")}
        aria-label={UI.btnResignLabel}
        title={UI.btnResignLabel}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" y1="22" x2="4" y2="15" />
        </svg>
      </button>
      <button
        className="action-icon-btn"
        onClick={() => startTeamVote("offer_draw")}
        aria-label={UI.btnOfferDrawLabel}
        title={UI.btnOfferDrawLabel}
      >
        <span className="draw-glyph">½</span>
      </button>
    </>
  ) : myTeamOfferedDraw ? (
    <span className="vote-status-text">{UI.drawOfferPending}</span>
  ) : otherTeamOfferingDraw ? (
    <span className="vote-status-text">{UI.votingOnDraw}</span>
  ) : gameOver?.pgn ? (
    <button
      className="action-icon-btn"
      onClick={copyPgn}
      title={UI.tooltipCopyPgn}
    >
      {UI.btnCopyPgnLabel}
    </button>
  ) : null;

  const teamVoteTitleMap = {
    resign: UI.voteTypeResign,
    offer_draw: UI.voteTypeOfferDraw,
    accept_draw: UI.voteTypeAcceptDraw,
  };
  const myBallot = vote?.voters.find((v) => v.id === myId);
  const voteBannerContent: React.ReactNode = vote ? (
    <VoteBanner
      title={`Vote: ${teamVoteTitleMap[vote.type]}`}
      yesVotes={vote.voters.filter((v) => v.yes).map((v) => v.name)}
      requiredVotes={vote.voters.length}
      timeLeft={countdown(vote.endTime, now)}
      myVoteEligible={!!myBallot}
      myCurrentVote={myBallot?.yes ? "yes" : null}
      onYes={() => castVote("yes")}
      onNo={() => castVote("no")}
    />
  ) : null;

  const showResetIcon = amILead && status !== GameStatus.Setup;
  const headerActions = (
    <div className="header-actions">
      {showResetIcon && (
        <button
          className="icon-btn"
          onClick={() => setShowResetConfirm(true)}
          title={UI.btnResetLabel}
          aria-label={UI.btnResetLabel}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        </button>
      )}
      <button
        className="icon-btn"
        onClick={toggleMute}
        title={isMuted ? UI.btnUnmuteLabel : UI.btnMuteLabel}
        aria-label={isMuted ? UI.btnUnmuteLabel : UI.btnMuteLabel}
      >
        {isMuted ? (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="22" y1="9" x2="16" y2="15" />
            <line x1="16" y1="9" x2="22" y2="15" />
          </svg>
        ) : (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
        )}
      </button>
    </div>
  );

  return (
    <>
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: "var(--color-bg-surface)",
            color: "var(--color-text-primary)",
          },
        }}
      />
      <NameChangeModal
        isOpen={isNameModalOpen}
        onClose={closeNameModal}
        onSave={submitSave}
        value={nameInput}
        onChange={(e) => setNameInput(e.target.value)}
        onKeyDown={handleNameKeyDown}
        inputRef={nameInputRef}
      />
      {pendingTeamVote && (
        <ConfirmModal
          message={
            pendingTeamVote === "resign"
              ? UI.confirmResign
              : UI.confirmOfferDraw
          }
          onConfirm={() => {
            doStartTeamVote(pendingTeamVote);
            setPendingTeamVote(null);
          }}
          onCancel={() => setPendingTeamVote(null)}
        />
      )}
      {showResetConfirm && (
        <ConfirmModal
          message={UI.confirmResetGame}
          onConfirm={() => {
            setShowResetConfirm(false);
            doResetGame();
          }}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}

      {amDisconnected && (
        <div className="offline-banner"> {UI.offlineBanner} </div>
      )}

      <div className="app-container">
        <div className="header-bar">{headerActions}</div>

        <div className="main-layout">
          <div className="side-left">
            <div className="side-inner">
              <MovesPanel turns={turns} myId={myId} movesRef={movesRef} />
              <PlayersPanel
                players={players}
                myId={myId}
                amILead={amILead}
                leadId={game.leadId}
                amDisconnected={amDisconnected}
                openNameModal={openNameModal}
                hasPlayed={hasPlayed}
                onKickPlayer={kickPlayer}
                side={side}
                gameStatus={status}
                joinSide={joinSide}
                autoAssign={autoAssign}
              />
            </div>
          </div>
          <div className="game-column">
            {topPlayerInfoBox}
            {boardBlock}
          </div>
          <div className="side-right">
            <div className="side-inner">
              <ChatPanel
                chatMessages={chat}
                myId={myId}
                chatInput={chatInput}
                setChatInput={setChatInput}
                chatInputRef={chatInputRef}
                onSend={(message) =>
                  act({ type: "SEND_CHAT", payload: { message } })
                }
              />
            </div>
          </div>
          <div className="bottom-clock-row">
            {renderBottomPlayerInfoBox(bottomActionSlot)}
          </div>
          {/* One row for both banners, and the vote takes the top: see .vote-row. */}
          {(voteBannerContent || forfeit) && (
            <div className="vote-row">
              {voteBannerContent}
              {forfeit && (
                <div className="forfeit-banner" role="status">
                  {forfeit.side
                    ? UI.forfeitCountdown(
                        forfeit.side === "white"
                          ? UI.headingWhite
                          : UI.headingBlack,
                        countdown(forfeit.endTime, now)
                      )
                    : UI.forfeitCountdownBoth(countdown(forfeit.endTime, now))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
