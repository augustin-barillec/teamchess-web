import {
  useState,
  useEffect,
  useMemo,
  useRef,
  CSSProperties,
  KeyboardEvent,
} from "react";
import type { ChangeEvent, RefObject } from "react";
import { Toaster, toast } from "react-hot-toast";
import { io, Socket } from "socket.io-client";
import { Chess, Square, Move } from "chess.js";
import {
  Chessboard,
  PieceDropHandlerArgs,
  PieceHandlerArgs,
} from "react-chessboard";
import {
  Players,
  GameInfo,
  Proposal,
  Selection,
  EndReason,
  ChatMessage,
  GameStatus,
} from "../../server/shared_types";
import { DisconnectedIcon } from "./DisconnectedIcon";

const STORAGE_KEYS = {
  pid: "tc:pid",
  name: "tc:name",
  side: "tc:side",
} as const;

const reasonMessages: Record<string, (winner: string | null) => string> = {
  [EndReason.Checkmate]: (winner) =>
    `☑️ Checkmate!\n${
      winner ? winner.charAt(0).toUpperCase() + winner.slice(1) : ""
    } wins!`,
  [EndReason.Stalemate]: () => `🤝 Game drawn by stalemate.`,
  [EndReason.Threefold]: () => `🤝 Game drawn by threefold repetition.`,
  [EndReason.Insufficient]: () => `🤝 Game drawn by insufficient material.`,
  [EndReason.DrawRule]: () => `🤝 Game drawn by rule (e.g. fifty-move).`,
  [EndReason.Resignation]: (winner) =>
    `🏳️ Resignation!\n${
      winner ? winner.charAt(0).toUpperCase() + winner.slice(1) : ""
    } wins!`,
  [EndReason.DrawAgreement]: () => `🤝 Draw agreed.`,
  [EndReason.Timeout]: (winner) =>
    `⏱️ Time!\n${
      winner ? winner.charAt(0).toUpperCase() + winner.slice(1) : ""
    } wins!`,
  [EndReason.Abandonment]: (winner) =>
    `🚫 Forfeit!\n${
      winner ? winner.charAt(0).toUpperCase() + winner.slice(1) : ""
    } wins as the opposing team is empty.`,
};

const pieceToFigurineWhite: Record<string, string> = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
};

const pieceToFigurineBlack: Record<string, string> = {
  K: "♚",
  Q: "♛",
  R: "♜",
  B: "♝",
  N: "♞",
  P: "♟",
};

interface NameChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  gameStatus: GameStatus;
  side: "white" | "black" | "spectator";
}

const NameChangeModal: React.FC<NameChangeModalProps> = ({
  isOpen,
  onClose,
  onSave,
  value,
  onChange,
  onKeyDown,
  inputRef,
  gameStatus,
  side,
}) => {
  if (!isOpen) return null;
  return (
    <div className="name-modal-overlay" onClick={onClose}>
      <div className="name-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Change Name</h3>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder="Set your name"
          aria-label="Set your name (Enter to save)"
        />

        <div className="name-modal-buttons">
          <button onClick={onClose}>Cancel</button>
          <button onClick={onSave}>Save</button>
        </div>
      </div>
    </div>
  );
};

interface ControlsPanelProps {
  gameStatus: GameStatus;
  side: "white" | "black" | "spectator";
  drawOffer: "white" | "black" | null;
  pgn: string;
  resetGame: () => void;
  autoAssign: () => void;
  joinSide: (side: "white" | "black" | "spectator") => void;
  joinSpectator: () => void;
  resignGame: () => void;
  offerDraw: () => void;
  acceptDraw: () => void;
  rejectDraw: () => void;
  copyPgn: () => void;
}

const ControlsPanel: React.FC<ControlsPanelProps> = ({
  gameStatus,
  side,
  drawOffer,
  pgn,
  resetGame,
  autoAssign,
  joinSide,
  joinSpectator,
  resignGame,
  offerDraw,
  acceptDraw,
  rejectDraw,
  copyPgn,
}) => {
  return (
    <>
      {gameStatus !== GameStatus.Lobby && (
        <button onClick={resetGame}>Reset Game</button>
      )}
      {gameStatus !== GameStatus.Over && (
        <>
          {side === "spectator" && (
            <>
              <button onClick={autoAssign}>Auto Assign</button>
              <button onClick={() => joinSide("white")}>Join White</button>
              <button onClick={() => joinSide("black")}>Join Black</button>
            </>
          )}
          {(side === "white" || side === "black") && (
            <>
              <button onClick={joinSpectator}>Join Spectators</button>
              {gameStatus === GameStatus.Lobby && (
                <button
                  onClick={() => joinSide(side === "white" ? "black" : "white")}
                >
                  Switch to {side === "white" ? "Black" : "White"}
                </button>
              )}
              {gameStatus === GameStatus.AwaitingProposals && (
                <>
                  {drawOffer && drawOffer !== side ? (
                    <>
                      <button onClick={acceptDraw}>Accept Draw</button>
                      <button onClick={rejectDraw}>Reject Draw</button>
                    </>
                  ) : drawOffer === side ? (
                    <span style={{ fontStyle: "italic" }}>Draw offered...</span>
                  ) : (
                    <>
                      <button onClick={resignGame}>Resign</button>
                      <button onClick={offerDraw}>Offer Draw</button>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
      {gameStatus === GameStatus.Over && pgn && (
        <button onClick={copyPgn}>Copy PGN</button>
      )}
    </>
  );
};

export default function App() {
  const [amDisconnected, setAmDisconnected] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [myId, setMyId] = useState<string>(
    localStorage.getItem(STORAGE_KEYS.pid) || ""
  );
  const [name, setName] = useState(
    localStorage.getItem(STORAGE_KEYS.name) || "Player"
  );
  const [nameInput, setNameInput] = useState(
    localStorage.getItem(STORAGE_KEYS.name) || "Player"
  );
  const [side, setSide] = useState<"spectator" | "white" | "black">(
    (localStorage.getItem(STORAGE_KEYS.side) as
      | "spectator"
      | "white"
      | "black") || "spectator"
  );
  const [players, setPlayers] = useState<Players>({
    spectators: [],
    whitePlayers: [],
    blackPlayers: [],
  });
  const [gameStatus, setGameStatus] = useState<GameStatus>(GameStatus.Lobby);
  const [winner, setWinner] = useState<"white" | "black" | null>(null);
  const [endReason, setEndReason] = useState<string | null>(null);
  const [pgn, setPgn] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [turns, setTurns] = useState<
    {
      moveNumber: number;
      side: "white" | "black";
      proposals: Proposal[];
      selection?: Selection;
    }[]
  >([]);
  const [chess] = useState(new Chess());
  const [position, setPosition] = useState(chess.fen());
  const [clocks, setClocks] = useState({ whiteTime: 0, blackTime: 0 });
  const [lastMoveSquares, setLastMoveSquares] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [legalSquareStyles, setLegalSquareStyles] = useState<
    Record<string, CSSProperties>
  >({});
  const [drawOffer, setDrawOffer] = useState<"white" | "black" | null>(null);
  const [promotionMove, setPromotionMove] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(600);
  const [activeTab, setActiveTab] = useState<
    "chat" | "moves" | "players" | "controls"
  >("players");
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const movesRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef(activeTab);
  const [isMobileInfoVisible, setIsMobileInfoVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 900);
  const [isNameModalOpen, setIsNameModalOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const [chatInput, setChatInput] = useState("");
  const current = turns[turns.length - 1];
  const orientation: "white" | "black" = side === "black" ? "black" : "white";
  const isFinalizing = gameStatus === GameStatus.FinalizingTurn;
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
  }, [position, chess]);

  const { lostWhitePieces, lostBlackPieces, materialBalance } = useMemo(() => {
    const initial: Record<string, number> = {
      P: 8,
      N: 2,
      B: 2,
      R: 2,
      Q: 1,
      K: 1,
    };
    const currWhite: Record<string, number> = {
      P: 0,
      N: 0,
      B: 0,
      R: 0,
      Q: 0,
      K: 0,
    };
    const currBlack: Record<string, number> = {
      P: 0,
      N: 0,
      B: 0,
      R: 0,
      Q: 0,
      K: 0,
    };
    chess
      .board()
      .flat()
      .forEach((piece) => {
        if (piece) {
          const type = piece.type.toUpperCase();
          if (piece.color === "w") currWhite[type]++;
          else currBlack[type]++;
        }
      });
    const lostW: { type: string; figurine: string }[] = [];
    const lostB: { type: string; figurine: string }[] = [];
    const order = ["P", "N", "B", "R", "Q", "K"];

    const values: Record<string, number> = {
      P: 1,
      N: 3,
      B: 3,
      R: 5,
      Q: 9,
      K: 0,
    };
    Object.entries(initial).forEach(([type, count]) => {
      const wCount = currWhite[type] || 0;
      const bCount = currBlack[type] || 0;
      for (let i = 0; i < count - wCount; i++)
        lostW.push({ type, figurine: pieceToFigurineWhite[type] });
      for (let i = 0; i < count - bCount; i++)
        lostB.push({ type, figurine: pieceToFigurineBlack[type] });
    });
    lostW.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    lostB.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    const whiteLostValue = lostW.reduce((sum, p) => sum + values[p.type], 0);
    const blackLostValue = lostB.reduce((sum, p) => sum + values[p.type], 0);
    const balance = blackLostValue - whiteLostValue;

    // Helper function to group pieces
    const groupPiecesToStrings = (
      pieces: { type: string; figurine: string }[]
    ) => {
      const groupedStrings: string[] = [];
      if (pieces.length === 0) return groupedStrings;

      // The pieces array is already sorted by value (P, N, B, R, Q)
      let currentFigurine = pieces[0].figurine;
      let currentCount = 0;

      for (const piece of pieces) {
        if (piece.figurine === currentFigurine) {
          currentCount++;
        } else {
          // Push previous group
          groupedStrings.push(
            `${currentFigurine}${currentCount > 1 ? `x${currentCount}` : ""}`
          );
          // Start new group
          currentFigurine = piece.figurine;
          currentCount = 1;
        }
      }

      // Push the very last group
      groupedStrings.push(
        `${currentFigurine}${currentCount > 1 ? `x${currentCount}` : ""}`
      );
      return groupedStrings;
    };

    return {
      lostWhitePieces: groupPiecesToStrings(lostW),
      lostBlackPieces: groupPiecesToStrings(lostB),
      materialBalance: balance,
    };
  }, [position, chess]);

  const playerCount = useMemo(
    () =>
      players.spectators.length +
      players.whitePlayers.length +
      players.blackPlayers.length,
    [players]
  );
  useEffect(() => {
    const s = io({
      auth: {
        pid: localStorage.getItem(STORAGE_KEYS.pid) || undefined,
        name: localStorage.getItem(STORAGE_KEYS.name) || "Player",
      },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 2000,
      randomizationFactor: 0.2,
    });
    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, []);

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
    if (!myId) return;
    const serverSide = players.whitePlayers.some((p) => p.id === myId)
      ? "white"
      : players.blackPlayers.some((p) => p.id === myId)
        ? "black"
        : "spectator";
    if (serverSide !== side) {
      setSide(serverSide);
      localStorage.setItem(STORAGE_KEYS.side, serverSide);
    }
  }, [players, myId, side]);
  useEffect(() => {
    if (!socket) return;

    socket.on("connect", () => {
      setAmDisconnected(false);
    });

    socket.on("disconnect", () => {
      setAmDisconnected(true);
    });

    socket.on("error", (data: { message: string }) => {
      toast.error(data.message);
    });

    socket.on(
      "session",
      ({ id, name: serverName }: { id: string; name: string }) => {
        setMyId(id);
        setName(serverName);
        setNameInput(serverName);
        localStorage.setItem(STORAGE_KEYS.pid, id);
        localStorage.setItem(STORAGE_KEYS.name, serverName);
      }
    );

    socket.on("players", (p: Players) => setPlayers(p));

    socket.on(
      "game_started",
      ({
        moveNumber,
        side,
        proposals,
      }: GameInfo & { proposals: Proposal[] }) => {
        setGameStatus(GameStatus.AwaitingProposals);
        setWinner(null);
        setEndReason(null);
        setPgn("");
        setTurns([{ moveNumber, side, proposals: proposals || [] }]);
        setLastMoveSquares(null);
        setDrawOffer(null);
      }
    );

    socket.on("game_reset", () => {
      setGameStatus(GameStatus.Lobby);
      setWinner(null);
      setEndReason(null);
      setPgn("");
      setTurns([]);
      chess.reset();
      setPosition(chess.fen());
      setClocks({ whiteTime: 0, blackTime: 0 });
      setLastMoveSquares(null);
      setDrawOffer(null);
    });
    socket.on("clock_update", ({ whiteTime, blackTime }) =>
      setClocks({ whiteTime, blackTime })
    );
    socket.on("position_update", ({ fen }) => {
      chess.load(fen);
      setPosition(fen);
    });
    socket.on("move_submitted", (m: Proposal) =>
      setTurns((ts) =>
        ts.map((t) =>
          t.moveNumber === m.moveNumber && t.side === m.side
            ? { ...t, proposals: [...t.proposals, m] }
            : t
        )
      )
    );
    // UPDATED: Overwrite local proposals with official candidates
    socket.on("move_selected", (sel: Selection) => {
      setTurns((ts) =>
        ts.map((t) =>
          t.moveNumber === sel.moveNumber && t.side === sel.side
            ? {
                ...t,
                selection: sel,
                proposals: sel.candidates, // <--- FORCE SYNC
              }
            : t
        )
      );
      chess.load(sel.fen);
      const from = sel.lan.slice(0, 2);
      const to = sel.lan.slice(2, 4);
      setLastMoveSquares({ from, to });
      setPosition(sel.fen);
    });

    socket.on("turn_change", ({ moveNumber, side }: GameInfo) =>
      setTurns((ts) => [...ts, { moveNumber, side, proposals: [] }])
    );
    // DELETED: socket.on("proposal_removed", ...)

    socket.on(
      "game_over",
      ({
        reason,
        winner,
        pgn: newPgn,
      }: {
        reason: string;
        winner: string | null;
        pgn: string;
      }) => {
        setGameStatus(GameStatus.Over);
        setWinner(winner);
        setEndReason(reason);
        setPgn(newPgn);
        setDrawOffer(null);

        const gameOverMessage = reasonMessages[reason]
          ? reasonMessages[reason](winner)
          : `🎉 Game over! ${
              winner ? winner.charAt(0).toUpperCase() + winner.slice(1) : ""
            } wins!`;

        if (isMobile) {
          toast(gameOverMessage, {
            duration: 5000,
            icon: "♟️",
          });
        }
      }
    );
    socket.on("chat_message", (msg: ChatMessage) => {
      setChatMessages((msgs) => [...msgs, msg]);
      if (!msg.system && activeTabRef.current !== "chat")
        setHasUnreadMessages(true);
    });
    socket.on("game_status_update", ({ status }: { status: GameStatus }) => {
      setGameStatus(status);
    });
    socket.on(
      "draw_offer_update",
      ({ side }: { side: "white" | "black" | null }) => {
        // FIX: Cast side to allowed union type
        setDrawOffer(side as "white" | "black" | null);
        if (side && isMobile) {
          const teamName = side.charAt(0).toUpperCase() + side.slice(1);
          toast(`Draw offer from the ${teamName} team.`, {
            icon: "🤝",
            duration: 4000,
          });
        }
      }
    );
    return () => {
      socket.disconnect();
    };
  }, [socket, chess, isMobile]);
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
  const resignGame = () => {
    if (window.confirm("Are you sure you want to resign for your team?")) {
      socket?.emit("resign");
      setIsMobileInfoVisible(false);
    }
  };

  const offerDraw = () => {
    if (
      window.confirm("Are you sure you want to offer a draw for your team?")
    ) {
      socket?.emit("offer_draw");
      setIsMobileInfoVisible(false);
    }
  };

  const acceptDraw = () => {
    if (window.confirm("Accept the draw offer for your team?")) {
      socket?.emit("accept_draw");
      setIsMobileInfoVisible(false);
    }
  };

  const rejectDraw = () => {
    if (window.confirm("Reject the draw offer for your team?")) {
      socket?.emit("reject_draw");
      setIsMobileInfoVisible(false);
    }
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

  const hasPlayed = (playerId: string) =>
    current?.proposals.some((p) => p.id === playerId);
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
    } catch (err) {
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
  const PromotionDialog = () => {
    if (!promotionMove) return null;
    const turnColor = chess.turn();
    const promotionPieces = ["Q", "R", "B", "N"];
    const pieceMap =
      turnColor === "w" ? pieceToFigurineWhite : pieceToFigurineBlack;
    return (
      <div className="promotion-dialog">
        <h3>Promote to:</h3>
        <div className="promotion-choices">
          {promotionPieces.map((p) => (
            <button
              key={p}
              onClick={() =>
                onPromote(p.toLowerCase() as "q" | "r" | "b" | "n")
              }
            >
              {" "}
              {pieceMap[p]}{" "}
            </button>
          ))}
        </div>
      </div>
    );
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
      } catch (e) {
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
  const PlayerInfoBox = ({
    clockTime,
    lostPieces,
    materialAdv,
    isActive,
  }: {
    clockTime: number;
    lostPieces: string[];
    materialAdv: number;
    isActive: boolean;
  }) => (
    <div className="game-player-info">
      <div className={"clock-box " + (isActive ? "active" : "")}>
        {String(Math.floor(clockTime / 60)).padStart(2, "0")}:
        {String(clockTime % 60).padStart(2, "0")}
      </div>
      <div className="material-display">
        <span>{lostPieces.join(" ")}</span>
        <span
          className="material-adv-label"
          style={{ visibility: materialAdv === 0 ? "hidden" : "visible" }}
        >
          {materialAdv > 0 ? `+${materialAdv}` : ""}
        </span>
      </div>
    </div>
  );
  const TabContent = (
    <div className="info-tabs-content">
      <div
        className={
          "tab-panel players-panel " + (activeTab === "players" ? "active" : "")
        }
      >
        <h3>Players</h3>
        <div className="player-lists-container">
          <div>
            {" "}
            <h3>Spectators</h3>{" "}
            <ul className="player-list">
              {" "}
              {players.spectators.map((p) => {
                const isMe = p.id === myId;
                const disconnected = isMe ? amDisconnected : !p.connected;
                return (
                  <li key={p.id}>
                    {" "}
                    {isMe ? (
                      <strong>
                        <button
                          className="clickable-name"
                          onClick={openNameModal}
                        >
                          {p.name}
                          {p.name === "Player" ? " ✏️" : ""}
                        </button>
                      </strong>
                    ) : (
                      <span>{p.name}</span>
                    )}{" "}
                    {disconnected && <DisconnectedIcon />}{" "}
                  </li>
                );
              })}{" "}
            </ul>{" "}
          </div>
          <div>
            {" "}
            <h3>White</h3>{" "}
            <ul className="player-list">
              {" "}
              {players.whitePlayers.map((p) => {
                const isMe = p.id === myId;
                const disconnected = isMe ? amDisconnected : !p.connected;
                return (
                  <li key={p.id}>
                    {" "}
                    {isMe ? (
                      <strong>
                        <button
                          className="clickable-name"
                          onClick={openNameModal}
                        >
                          {p.name}
                          {p.name === "Player" ? " ✏️" : ""}
                        </button>
                      </strong>
                    ) : (
                      <span>{p.name}</span>
                    )}{" "}
                    {disconnected && <DisconnectedIcon />}{" "}
                    {hasPlayed(p.id) && <span>✔️</span>}{" "}
                  </li>
                );
              })}{" "}
            </ul>{" "}
          </div>
          <div>
            {" "}
            <h3>Black</h3>{" "}
            <ul className="player-list">
              {" "}
              {players.blackPlayers.map((p) => {
                const isMe = p.id === myId;
                const disconnected = isMe ? amDisconnected : !p.connected;
                return (
                  <li key={p.id}>
                    {" "}
                    {isMe ? (
                      <strong>
                        <button
                          className="clickable-name"
                          onClick={openNameModal}
                        >
                          {p.name}
                          {p.name === "Player" ? " ✏️" : ""}
                        </button>
                      </strong>
                    ) : (
                      <span>{p.name}</span>
                    )}{" "}
                    {disconnected && <DisconnectedIcon />}{" "}
                    {hasPlayed(p.id) && <span>✔️</span>}{" "}
                  </li>
                );
              })}{" "}
            </ul>{" "}
          </div>
        </div>
      </div>
      <div
        className={
          "tab-panel moves-panel " + (activeTab === "moves" ? "active" : "")
        }
      >
        <h3>Moves</h3>
        {turns.some((t) => t.selection) ? (
          <div ref={movesRef} className="moves-list">
            {" "}
            {turns
              .filter((t) => t.selection)
              .map((t) => (
                <div
                  key={`${t.side}-${t.moveNumber}`}
                  className="move-turn-header"
                  style={{ marginBottom: "1rem" }}
                >
                  {" "}
                  <strong>{t.moveNumber}</strong>{" "}
                  <ul style={{ margin: 4, paddingLeft: "1.2rem" }}>
                    {" "}
                    {t.proposals.map((p) => {
                      const isSel = t.selection!.lan === p.lan;
                      return (
                        <li key={p.id}>
                          {" "}
                          {p.id === myId ? (
                            <strong>{p.name}</strong>
                          ) : (
                            p.name
                          )}{" "}
                          {isSel ? (
                            <span className="moves-list-item">{p.san}</span>
                          ) : (
                            p.san
                          )}{" "}
                        </li>
                      );
                    })}{" "}
                  </ul>{" "}
                </div>
              ))}{" "}
          </div>
        ) : (
          <p style={{ padding: "10px", fontStyle: "italic" }}>
            No moves played yet.
          </p>
        )}
      </div>
      <div
        className={
          "tab-panel chat-panel " + (activeTab === "chat" ? "active" : "")
        }
      >
        <h3>Chat</h3>
        <div className="chat-box-container">
          <div className="chat-messages">
            {" "}
            {chatMessages
              .slice()
              .reverse()
              .map((msg, idx) => {
                if (msg.system) {
                  return (
                    <div key={idx} className="chat-message-item system">
                      {" "}
                      {msg.message}{" "}
                    </div>
                  );
                }
                return (
                  <div
                    key={idx}
                    className={
                      "chat-message-item " +
                      (myId === msg.senderId ? "own" : "other")
                    }
                  >
                    {" "}
                    {myId === msg.senderId ? (
                      <strong>{msg.sender}:</strong>
                    ) : (
                      <span>{msg.sender}:</span>
                    )}{" "}
                    {msg.message}{" "}
                  </div>
                );
              })}{" "}
          </div>
          <div className="chat-form">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const message = chatInput.trim();
                if (message) {
                  socket?.emit("chat_message", message);
                  setChatInput("");
                }
              }}
            >
              <input
                ref={chatInputRef}
                type="text"
                name="chatInput"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                placeholder="Type a message..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const message = chatInput.trim();
                    if (message) {
                      socket?.emit("chat_message", message);
                      setChatInput("");
                    }
                  }
                }}
              />
            </form>
          </div>
        </div>
      </div>
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
            resetGame={resetGame}
            autoAssign={autoAssign}
            joinSide={joinSide}
            joinSpectator={joinSpectator}
            resignGame={resignGame}
            offerDraw={offerDraw}
            acceptDraw={acceptDraw}
            rejectDraw={rejectDraw}
            copyPgn={copyPgn}
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
          You’re offline. Trying to reconnect…{" "}
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
                orientation === "white" ? lostBlackPieces : lostWhitePieces
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
              <PromotionDialog />{" "}
            </div>
            <PlayerInfoBox
              clockTime={
                orientation === "white" ? clocks.whiteTime : clocks.blackTime
              }
              lostPieces={
                orientation === "white" ? lostWhitePieces : lostBlackPieces
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
              </button>
            </nav>

            {TabContent}
          </div>
        </div>
      </div>
    </>
  );
}
