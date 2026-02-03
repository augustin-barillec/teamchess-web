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
import { calculateMaterial } from "./materialCalc";
import { useSocket } from "./hooks/useSocket";
import { NameChangeModal } from "./components/NameChangeModal";
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

  const startTeamVote = (type: VoteType) => {
    if (side === "white" || side === "black") {
      const myTeamArray =
        side === "white" ? players.whitePlayers : players.blackPlayers;
      if (myTeamArray.length === 1) {
        let msg = "";
        if (type === "resign") msg = "Are you sure you want to resign?";
        else if (type === "offer_draw")
          msg = "Are you sure you want to offer a draw?";
        if (msg && !window.confirm(msg)) return;
      }
    }

    socket?.emit("start_team_vote", type);
    setIsMobileInfoVisible(false);
  };

  const sendTeamVote = (vote: "yes" | "no") => {
    socket?.emit("vote_team", vote);
  };

  const resetGame = () => {
    if (window.confirm("Are you sure you want to reset the game?")) {
      socket?.emit(
        "reset_game",
        (res: { success: boolean; error?: string }) => {
          if (res.error) return toast.error(res.error);
        }
      );
      setIsMobileInfoVisible(false);
    }
  };

  const submitMove = (lan: string) => {
    if (!socket) return;
    socket.emit("play_move", lan, (res: { error?: string }) => {
      if (res?.error) toast.error(res.error);
      else if (isMobile) {
        toast.success("Move submitted ✔️");
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
      toast.success("PGN copied!");
    } catch (_err) {
      toast.error("Could not copy PGN.");
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
      if (gameStatus === GameStatus.Lobby) {
        if (side !== "white") {
          toast.error("Only White can make the first move to start the game.");
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
        toast.error("Illegal move!");
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

  const TabContent = (
    <div className="info-tabs-content">
      <PlayersPanel
        activeTab={activeTab}
        players={players}
        myId={myId}
        amDisconnected={amDisconnected}
        openNameModal={openNameModal}
        hasPlayed={hasPlayed}
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
        <h3>Controls</h3>
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
          />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <Toaster position="top-center" />
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

      <div
        className="mobile-info-overlay"
        style={{ display: isMobileInfoVisible ? "flex" : "none" }}
      >
        {TabContent}
        <div className="mobile-info-header">
          <h3>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</h3>
          <button onClick={() => setIsMobileInfoVisible(false)}>Close</button>
        </div>
      </div>

      {amDisconnected && (
        <div className="offline-banner">
          {" "}
          You're offline. Trying to reconnect…{" "}
        </div>
      )}

      <div className="app-container">
        <div className="header-bar"></div>

        <div className="main-layout">
          <div className="game-column">
            <PlayerInfoBox
              clockTime={
                orientation === "white" ? clocks.blackTime : clocks.whiteTime
              }
              lostPieces={
                orientation === "white" ? blackMaterialDiff : whiteMaterialDiff
              }
              materialAdv={
                orientation === "white" ? -materialBalance : materialBalance
              }
              isActive={
                gameStatus !== GameStatus.Lobby &&
                gameStatus !== GameStatus.Over &&
                current?.side === (orientation === "white" ? "black" : "white")
              }
            />
            <div ref={boardContainerRef} className="board-wrapper">
              {" "}
              <Chessboard options={boardOptions} />
              <PromotionDialog
                promotionMove={promotionMove}
                turnColor={chess.turn()}
                onPromote={onPromote}
              />{" "}
            </div>
            <PlayerInfoBox
              clockTime={
                orientation === "white" ? clocks.whiteTime : clocks.blackTime
              }
              lostPieces={
                orientation === "white" ? whiteMaterialDiff : blackMaterialDiff
              }
              materialAdv={
                orientation === "white" ? materialBalance : -materialBalance
              }
              isActive={
                gameStatus !== GameStatus.Lobby &&
                gameStatus !== GameStatus.Over &&
                current?.side === (orientation === "white" ? "white" : "black")
              }
            />
          </div>

          <div className="info-column">
            <nav className="info-tabs-nav">
              <button
                className={activeTab === "players" ? "active" : ""}
                onClick={() => {
                  setActiveTab("players");
                  setIsMobileInfoVisible(true);
                }}
              >
                {" "}
                Players{" "}
              </button>
              <button
                className={activeTab === "moves" ? "active" : ""}
                onClick={() => {
                  setActiveTab("moves");
                  setIsMobileInfoVisible(true);
                }}
              >
                {" "}
                Moves{" "}
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
                Chat{" "}
                {hasUnreadMessages && <span className="unread-dot"></span>}{" "}
              </button>
              <button
                className={activeTab === "controls" ? "active" : ""}
                onClick={() => {
                  setActiveTab("controls");
                  setIsMobileInfoVisible(true);
                }}
              >
                Controls
                {teamVote.isActive && activeTab !== "controls" && (
                  <span className="unread-dot"></span>
                )}
              </button>
            </nav>

            {TabContent}
          </div>
        </div>
      </div>
    </>
  );
}
