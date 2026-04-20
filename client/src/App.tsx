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
import { GameStatus, VoteType } from "./types";
import { STORAGE_KEYS } from "./constants";
import { UI } from "./messages";
import { calculateMaterial } from "./materialCalc";
import {
  shouldConfirmTeamAction,
  shouldConfirmResetGame,
} from "./confirmUtils";
import { useSocket } from "./hooks/useSocket";
import { NameChangeModal } from "./components/NameChangeModal";
import { ConfirmModal } from "./components/ConfirmModal";
import { ControlsPanel } from "./components/ControlsPanel";
import { PromotionDialog } from "./components/PromotionDialog";
import { PlayerInfoBox } from "./components/PlayerInfoBox";
import { PlayersPanel } from "./components/PlayersPanel";
import { MovesPanel } from "./components/MovesPanel";
import { ChatPanel } from "./components/ChatPanel";
import { sounds } from "./soundEngine";

export default function App() {
  const [chess] = useState(new Chess());
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 900);
  const activeTabRef = useRef<string>("players");

  const {
    socket,
    amDisconnected,
    myId,
    name,
    nameInput,
    setNameInput,
    side,
    setSide,
    players,
    gameStatus,
    pgn,
    chatMessages,
    turns,
    position,
    clocks,
    lastMoveSquares,
    drawOffer,
    teamVote,
    kickVote,
    resetVote,
    setHasUnreadMessages,
  } = useSocket({ chess, isMobile, activeTabRef });

  const [legalSquareStyles, setLegalSquareStyles] = useState<
    Record<string, CSSProperties>
  >({});
  const [promotionMove, setPromotionMove] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(600);
  const [activeTab, setActiveTab] = useState<
    "chat" | "moves" | "players" | "controls"
  >("players");
  const [hasUnreadMessages, setLocalHasUnreadMessages] = useState(false);
  const movesRef = useRef<HTMLDivElement>(null);
  const [isMobileInfoVisible, setIsMobileInfoVisible] = useState(false);
  const [isNameModalOpen, setIsNameModalOpen] = useState(false);
  const [pendingTeamVote, setPendingTeamVote] = useState<VoteType | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const [chatInput, setChatInput] = useState("");
  const current = turns[turns.length - 1];
  const orientation: "white" | "black" = side === "black" ? "black" : "white";
  const isFinalizing = gameStatus === GameStatus.FinalizingTurn;
  const [isMuted, setIsMuted] = useState(sounds.getMuted());

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    sounds.setMuted(next);
  };

  const kingInCheckSquare = useMemo(() => {
    if (!chess.isCheck()) return null;
    const kingPiece = { type: "k", color: chess.turn() };
    let square: string | null = null;
    chess.board().forEach((row, rowIndex) => {
      row.forEach((piece, colIndex) => {
        if (
          piece &&
          piece.type === kingPiece.type &&
          piece.color === kingPiece.color
        ) {
          square = `${"abcdefgh"[colIndex]}${8 - rowIndex}`;
        }
      });
    });
    return square;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, chess]);

  const { whiteMaterialDiff, blackMaterialDiff, materialBalance } = useMemo(
    () => calculateMaterial(chess.board()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [position, chess]
  );

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) setBoardWidth(entries[0].contentRect.width);
    });
    if (boardContainerRef.current) observer.observe(boardContainerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const checkIsMobile = () => setIsMobile(window.innerWidth <= 900);
    window.addEventListener("resize", checkIsMobile);
    return () => window.removeEventListener("resize", checkIsMobile);
  }, []);

  useEffect(() => {
    if (movesRef.current)
      movesRef.current.scrollTop = movesRef.current.scrollHeight;
  }, [turns, activeTab]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    if (isNameModalOpen && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [isNameModalOpen]);

  const [voteNow, setVoteNow] = useState(() => Date.now());
  useEffect(() => {
    if (!teamVote.isActive && !resetVote.isActive) return;
    const interval = setInterval(() => setVoteNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [teamVote.isActive, resetVote.isActive]);
  const teamVoteTimeLeft = Math.max(
    0,
    Math.ceil((teamVote.endTime - voteNow) / 1000)
  );
  const resetVoteTimeLeft = Math.max(
    0,
    Math.ceil((resetVote.endTime - voteNow) / 1000)
  );

  const joinSide = (s: "white" | "black" | "spectator") => {
    socket?.emit("join_side", { side: s }, (res: { error?: string }) => {
      if (res.error) toast.error(res.error);
      else setSide(s);
      localStorage.setItem(STORAGE_KEYS.side, s);
    });
    setIsMobileInfoVisible(false);
  };

  const autoAssign = () => {
    const whiteCount = players.whitePlayers.length;
    const blackCount = players.blackPlayers.length;
    let chosen: "white" | "black";
    if (whiteCount < blackCount) chosen = "white";
    else if (blackCount < whiteCount) chosen = "black";
    else chosen = Math.random() < 0.5 ? "white" : "black";
    joinSide(chosen);
    setIsMobileInfoVisible(false);
  };

  const joinSpectator = () => joinSide("spectator");

  const doStartTeamVote = (type: VoteType) => {
    socket?.emit("start_team_vote", type);
    setIsMobileInfoVisible(false);
  };

  const startTeamVote = (type: VoteType) => {
    if (side === "white" || side === "black") {
      const myTeamArray =
        side === "white" ? players.whitePlayers : players.blackPlayers;
      if (shouldConfirmTeamAction(myTeamArray)) {
        setPendingTeamVote(type);
        return;
      }
    }
    doStartTeamVote(type);
  };

  const sendTeamVote = (vote: "yes" | "no") => {
    socket?.emit("vote_team", vote);
  };

  const startKickVote = (targetId: string) => {
    socket?.emit("start_kick_vote", targetId);
  };

  const sendKickVote = (vote: "yes" | "no") => {
    socket?.emit("vote_kick", vote);
  };

  const doResetGame = () => {
    socket?.emit("reset_game", (res: { success: boolean; error?: string }) => {
      if (res.error) return toast.error(res.error);
    });
    setIsMobileInfoVisible(false);
  };

  const resetGame = () => {
    const allPlayers = [
      ...players.whitePlayers,
      ...players.blackPlayers,
      ...players.spectators,
    ];
    if (shouldConfirmResetGame(allPlayers)) {
      setShowResetConfirm(true);
      return;
    }
    doResetGame();
  };

  const sendResetVote = (vote: "yes" | "no") => {
    socket?.emit("vote_reset", vote);
  };

  const submitMove = (lan: string) => {
    if (!socket) return;
    socket.emit("play_move", lan, (res: { error?: string }) => {
      if (res?.error) toast.error(res.error);
      else if (isMobile) {
        toast.success(UI.toastMoveSubmitted);
      }
    });
  };

  const onPromote = (promotionPiece: "q" | "r" | "b" | "n") => {
    if (!promotionMove) return;
    const { from, to } = promotionMove;
    const lan = from + to + promotionPiece;
    submitMove(lan);
    setPromotionMove(null);
  };

  function needsPromotion(from: string, to: string) {
    const piece = chess.get(from as Square);
    if (!piece || piece.type !== "p") return false;
    const rank = to[1];
    return piece.color === "w" ? rank === "8" : rank === "1";
  }

  const hasPlayed = (playerId: string, teamSide: "white" | "black") =>
    current?.proposals.some((p) => p.id === playerId && p.side === teamSide);

  const copyPgn = () => {
    if (!pgn) return;
    const textArea = document.createElement("textarea");
    textArea.value = pgn;
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
    setIsMobileInfoVisible(false);
  };

  const openNameModal = () => {
    setNameInput(name);
    setIsNameModalOpen(true);
  };

  const closeNameModal = () => {
    setIsNameModalOpen(false);
    setNameInput(name);
  };

  const submitSave = () => {
    const newName = nameInput.trim();
    if (newName && newName !== name) {
      socket?.emit("set_name", newName);
    }

    setIsNameModalOpen(false);
  };

  const handleNameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      submitSave();
    } else if (e.key === "Escape") {
      closeNameModal();
    }
  };

  const boardOptions = {
    position,
    boardOrientation: orientation,
    viewOnly: isFinalizing,
    squareStyles: {
      ...(lastMoveSquares
        ? {
            [lastMoveSquares.from]: {
              backgroundColor: "rgba(245,246,110,0.75)",
            },
            [lastMoveSquares.to]: { backgroundColor: "rgba(245,246,110,0.75)" },
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
    },
    boardWidth: boardWidth,
    draggingPieceStyle: isMobile
      ? {
          transform: "translateY(-50px) scale(2)",

          zIndex: 9999,

          opacity: 0.9,
          boxShadow: "0px 10px 15px rgba(0, 0, 0, 0.3)",
        }
      : undefined,
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
      if (gameStatus === GameStatus.Setup) {
        if (side !== "white") {
          toast.error(UI.toastOnlyWhiteStart);
          return false;
        }
      } else if (gameStatus === GameStatus.AwaitingProposals) {
        if (!current || side !== current.side) {
          return false;
        }
      } else {
        return false;
      }

      const isPromotion = needsPromotion(from, to);
      try {
        const move = chess.move({
          from,
          to,
          promotion: isPromotion ? "q" : undefined,
        });
        if (!move) return false;
        chess.undo();
      } catch (_e) {
        toast.error(UI.toastIllegalMove);
        return false;
      }
      if (isPromotion) {
        setPromotionMove({ from, to });
      } else {
        const lan = from + to;
        submitMove(lan);
      }
      return true;
    },
  };

  const boardBlock = (
    <div ref={boardContainerRef} className="board-wrapper">
      <Chessboard options={boardOptions} />
      <PromotionDialog
        promotionMove={promotionMove}
        turnColor={chess.turn()}
        onPromote={onPromote}
      />
    </div>
  );

  const topPlayerInfoBox = (
    <PlayerInfoBox
      clockTime={orientation === "white" ? clocks.blackTime : clocks.whiteTime}
      lostPieces={
        orientation === "white" ? blackMaterialDiff : whiteMaterialDiff
      }
      materialAdv={orientation === "white" ? -materialBalance : materialBalance}
      isActive={
        gameStatus !== GameStatus.Setup &&
        gameStatus !== GameStatus.Over &&
        current?.side === (orientation === "white" ? "black" : "white")
      }
    />
  );

  const renderBottomPlayerInfoBox = (actionSlot?: React.ReactNode) => (
    <PlayerInfoBox
      clockTime={orientation === "white" ? clocks.whiteTime : clocks.blackTime}
      lostPieces={
        orientation === "white" ? whiteMaterialDiff : blackMaterialDiff
      }
      materialAdv={orientation === "white" ? materialBalance : -materialBalance}
      isActive={
        gameStatus !== GameStatus.Setup &&
        gameStatus !== GameStatus.Over &&
        current?.side === (orientation === "white" ? "white" : "black")
      }
      actionSlot={actionSlot}
    />
  );

  // --- Desktop action slot (under-board icons) ---
  const showBoardActions =
    gameStatus === GameStatus.AwaitingProposals &&
    (side === "white" || side === "black") &&
    !teamVote.isActive;
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
  ) : pgn && gameStatus === GameStatus.Over ? (
    <button
      className="action-icon-btn"
      onClick={copyPgn}
      title={UI.tooltipCopyPgn}
    >
      {UI.btnCopyPgnLabel}
    </button>
  ) : null;

  // --- Desktop vote banner (team vote or reset vote) ---
  let voteBannerContent: React.ReactNode = null;
  if (teamVote.isActive && teamVote.type) {
    const titleMap = {
      resign: UI.voteTypeResign,
      offer_draw: UI.voteTypeOfferDraw,
      accept_draw: UI.voteTypeAcceptDraw,
    };
    voteBannerContent = (
      <div className="vote-banner">
        <div className="vote-banner-info">
          <div className="vote-banner-title">
            Vote: {titleMap[teamVote.type]}
          </div>
          <div className="vote-banner-meta">
            {teamVote.yesVotes.length}/{teamVote.requiredVotes} &bull;{" "}
            {teamVoteTimeLeft}s
            {teamVote.yesVotes.length > 0 && (
              <span className="vote-banner-yes-list">
                {" "}
                &bull; Yes: {teamVote.yesVotes.join(", ")}
              </span>
            )}
          </div>
        </div>
        <div className="vote-banner-buttons">
          <button
            onClick={() => sendTeamVote("yes")}
            disabled={!teamVote.myVoteEligible}
            className="vote-yes-btn"
          >
            Yes ({teamVote.yesVotes.length})
          </button>
          <button
            onClick={() => sendTeamVote("no")}
            disabled={!teamVote.myVoteEligible}
            className="vote-no-btn"
          >
            No
          </button>
        </div>
      </div>
    );
  } else if (resetVote.isActive) {
    voteBannerContent = (
      <div className="vote-banner">
        <div className="vote-banner-info">
          <div className="vote-banner-title">{UI.voteResetGame}</div>
          <div className="vote-banner-meta">
            {resetVote.yesVotes.length}/{resetVote.requiredVotes} &bull;{" "}
            {resetVoteTimeLeft}s
            {resetVote.yesVotes.length > 0 && (
              <span className="vote-banner-yes-list">
                {" "}
                &bull; Yes: {resetVote.yesVotes.join(", ")}
              </span>
            )}
            {resetVote.noVotes.length > 0 && (
              <span className="vote-banner-no-list">
                {" "}
                &bull; No: {resetVote.noVotes.join(", ")}
              </span>
            )}
          </div>
        </div>
        <div className="vote-banner-buttons">
          <button
            onClick={() => sendResetVote("yes")}
            disabled={
              !resetVote.myVoteEligible || resetVote.myCurrentVote === "yes"
            }
            className="vote-yes-btn"
          >
            Yes ({resetVote.yesVotes.length})
          </button>
          <button
            onClick={() => sendResetVote("no")}
            disabled={
              !resetVote.myVoteEligible || resetVote.myCurrentVote === "no"
            }
            className="vote-no-btn"
          >
            No ({resetVote.noVotes.length})
          </button>
        </div>
      </div>
    );
  }

  // --- Desktop header icon buttons ---
  const showDesktopReset =
    gameStatus !== GameStatus.Setup &&
    gameStatus !== GameStatus.Over &&
    !resetVote.isActive;
  const desktopHeaderActions = (
    <div className="header-actions">
      {showDesktopReset && (
        <button
          className="icon-btn"
          onClick={resetGame}
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

  const mobileTabsAndContent = (
    <div
      className={`info-column${isMobileInfoVisible ? " mobile-overlay-active" : ""}`}
    >
      <nav className="info-tabs-nav">
        <button
          className={activeTab === "players" ? "active" : ""}
          onClick={() => {
            setActiveTab("players");
            setIsMobileInfoVisible(true);
          }}
        >
          {UI.tabPlayers}
          {kickVote.isActive &&
            (kickVote.amTarget || activeTab !== "players") && (
              <span className="unread-dot"></span>
            )}
        </button>
        <button
          className={activeTab === "moves" ? "active" : ""}
          onClick={() => {
            setActiveTab("moves");
            setIsMobileInfoVisible(true);
          }}
        >
          {" "}
          {UI.tabMoves}{" "}
        </button>
        <button
          className={activeTab === "chat" ? "active" : ""}
          onClick={() => {
            setActiveTab("chat");
            setLocalHasUnreadMessages(false);
            setHasUnreadMessages(false);
            setIsMobileInfoVisible(true);
          }}
        >
          {" "}
          {UI.tabChat}{" "}
          {hasUnreadMessages && <span className="unread-dot"></span>}{" "}
        </button>
        <button
          className={activeTab === "controls" ? "active" : ""}
          onClick={() => {
            setActiveTab("controls");
            setIsMobileInfoVisible(true);
          }}
        >
          {UI.tabControls}
          {(teamVote.isActive || resetVote.isActive) &&
            activeTab !== "controls" && <span className="unread-dot"></span>}
        </button>
      </nav>

      <div className="info-tabs-content">
        <PlayersPanel
          activeTab={activeTab}
          players={players}
          myId={myId}
          amDisconnected={amDisconnected}
          openNameModal={openNameModal}
          hasPlayed={hasPlayed}
          kickVote={kickVote}
          onStartKickVote={startKickVote}
          onSendKickVote={sendKickVote}
        />
        <MovesPanel
          activeTab={activeTab}
          turns={turns}
          myId={myId}
          movesRef={movesRef}
        />
        <ChatPanel
          activeTab={activeTab}
          chatMessages={chatMessages}
          myId={myId}
          chatInput={chatInput}
          setChatInput={setChatInput}
          chatInputRef={chatInputRef}
          socket={socket}
        />
        <div
          className={
            "tab-panel controls-panel " +
            (activeTab === "controls" ? "active" : "")
          }
        >
          <h3>{UI.headingControls}</h3>
          <div className="controls-panel-content">
            <ControlsPanel
              gameStatus={gameStatus}
              side={side}
              drawOffer={drawOffer}
              pgn={pgn}
              isMuted={isMuted}
              toggleMute={toggleMute}
              resetGame={resetGame}
              autoAssign={autoAssign}
              joinSide={joinSide}
              joinSpectator={joinSpectator}
              copyPgn={copyPgn}
              teamVote={teamVote}
              onStartTeamVote={startTeamVote}
              onSendTeamVote={sendTeamVote}
              resetVote={resetVote}
              onSendResetVote={sendResetVote}
            />
          </div>
        </div>
      </div>
      <div className="mobile-info-header">
        <h3>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</h3>
        <button onClick={() => setIsMobileInfoVisible(false)}>
          {UI.btnClose}
        </button>
      </div>
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
        gameStatus={gameStatus}
        side={side}
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
        <div className="header-bar">{!isMobile && desktopHeaderActions}</div>

        <div className="main-layout">
          {isMobile ? (
            <>
              <div className="game-column">
                {topPlayerInfoBox}
                {boardBlock}
                {renderBottomPlayerInfoBox()}
              </div>
              {mobileTabsAndContent}
            </>
          ) : (
            <>
              <div className="side-left">
                <PlayersPanel
                  activeTab={activeTab}
                  players={players}
                  myId={myId}
                  amDisconnected={amDisconnected}
                  openNameModal={openNameModal}
                  hasPlayed={hasPlayed}
                  kickVote={kickVote}
                  onStartKickVote={startKickVote}
                  onSendKickVote={sendKickVote}
                  showJoinControls
                  side={side}
                  gameStatus={gameStatus}
                  joinSide={joinSide}
                  autoAssign={autoAssign}
                />
                <MovesPanel
                  activeTab={activeTab}
                  turns={turns}
                  myId={myId}
                  movesRef={movesRef}
                />
              </div>
              <div className="game-column">
                {topPlayerInfoBox}
                {boardBlock}
              </div>
              <div className="side-right">
                <ChatPanel
                  activeTab={activeTab}
                  chatMessages={chatMessages}
                  myId={myId}
                  chatInput={chatInput}
                  setChatInput={setChatInput}
                  chatInputRef={chatInputRef}
                  socket={socket}
                />
              </div>
              <div className="bottom-clock-row">
                {renderBottomPlayerInfoBox(bottomActionSlot)}
              </div>
              {voteBannerContent && (
                <div className="vote-row">{voteBannerContent}</div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
