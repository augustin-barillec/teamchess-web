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
import { Chess } from "chess.js";
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
const STORAGE_KEYS = {
  pid: "tc:pid",
  name: "tc:name",
  side: "tc:side",
} as const;
const reasonMessages: Record<string, (winner: string | null) => string> = {
  [EndReason.Checkmate]: (winner) =>
    `☑️ Checkmate!\n${winner?.[0].toUpperCase() + winner?.slice(1)} wins!`,
  [EndReason.Stalemate]: () => `🤝 Game drawn by stalemate.`,
  [EndReason.Threefold]: () => `🤝 Game drawn by threefold repetition.`,
  [EndReason.Insufficient]: () => `🤝 Game drawn by insufficient material.`,
  [EndReason.DrawRule]: () => `🤝 Game drawn by rule (e.g. fifty-move).`,
  [EndReason.Resignation]: (winner) =>
    `🏳️ Resignation!\n${winner?.[0].toUpperCase() + winner?.slice(1)} wins!`,
  [EndReason.DrawAgreement]: () => `🤝 Draw agreed.`,
  [EndReason.Timeout]: (winner) =>
    `⏱️ Time!\n${winner?.[0].toUpperCase() + winner?.slice(1)} wins!`,
  [EndReason.Abandonment]: (winner) =>
    `🚫 Forfeit!\n${
      winner?.[0].toUpperCase() + winner?.slice(1)
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
  inputRef: RefObject<HTMLInputElement>;
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
        <h3>Player Settings</h3>
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

export default function App() {
  const [amDisconnected, setAmDisconnected] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [myId, setMyId] = useState<string>(
    sessionStorage.getItem(STORAGE_KEYS.pid) || ""
  );
  const [name, setName] = useState(
    sessionStorage.getItem(STORAGE_KEYS.name) || "Player"
  );
  const [nameInput, setNameInput] = useState(
    sessionStorage.getItem(STORAGE_KEYS.name) || "Player"
  );
  const [side, setSide] = useState<"spectator" | "white" | "black">(
    (sessionStorage.getItem(STORAGE_KEYS.side) as
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

  const [activeTab, setActiveTab] = useState<"chat" | "moves" | "players">(
    "players"
  );
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const movesRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef(activeTab);
  const [isMobileInfoVisible, setIsMobileInfoVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 900);
  const [isNameModalOpen, setIsNameModalOpen] = useState(false);
  const [isPgnVisible, setIsPgnVisible] = useState(false);
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
    return {
      lostWhitePieces: lostW.map((p) => p.figurine),
      lostBlackPieces: lostB.map((p) => p.figurine),
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
        pid: sessionStorage.getItem(STORAGE_KEYS.pid) || undefined,
        name: sessionStorage.getItem(STORAGE_KEYS.name) || "Player",
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
      sessionStorage.setItem(STORAGE_KEYS.side, serverSide);
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
        sessionStorage.setItem(STORAGE_KEYS.pid, id);
        sessionStorage.setItem(STORAGE_KEYS.name, serverName);
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
    socket.on("move_selected", (sel: Selection) => {
      setTurns((ts) =>
        ts.map((t) =>
          t.moveNumber === sel.moveNumber && t.side === sel.side
            ? { ...t, selection: sel }
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
    socket.on("proposal_removed", ({ moveNumber, side, id }) =>
      setTurns((ts) =>
        ts.map((t) =>
          t.moveNumber === moveNumber && t.side === side
            ? { ...t, proposals: t.proposals.filter((p) => p.id !== id) }
            : t
        )
      )
    );
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
        setIsPgnVisible(false);
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
      ({ side }: { side: "white" | "black" | null }) => setDrawOffer(side)
    );
    return () => {
      socket.disconnect();
    };
  }, [socket, chess]);
  useEffect(() => {
    if (isNameModalOpen && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [isNameModalOpen]);
  const joinSide = (s: "white" | "black" | "spectator") =>
    socket?.emit("join_side", { side: s }, (res: { error?: string }) => {
      if (res.error) toast.error(res.error);
      else setSide(s);
      sessionStorage.setItem(STORAGE_KEYS.side, s);
    });
  const autoAssign = () => {
    const whiteCount = players.whitePlayers.length;
    const blackCount = players.blackPlayers.length;
    let chosen: "white" | "black";
    if (whiteCount < blackCount) chosen = "white";
    else if (blackCount < whiteCount) chosen = "black";
    else chosen = Math.random() < 0.5 ? "white" : "black";
    joinSide(chosen);
  };
  const joinSpectator = () => joinSide("spectator");
  const resignGame = () => {
    if (window.confirm("Are you sure you want to resign for your team?"))
      socket?.emit("resign");
  };

  const offerDraw = () => {
    if (window.confirm("Are you sure you want to offer a draw for your team?"))
      socket?.emit("offer_draw");
  };

  const acceptDraw = () => {
    if (window.confirm("Accept the draw offer for your team?"))
      socket?.emit("accept_draw");
  };

  const rejectDraw = () => {
    if (window.confirm("Reject the draw offer for your team?"))
      socket?.emit("reject_draw");
  };

  const startGame = () => socket?.emit("start_game");
  const resetGame = () => {
    if (window.confirm("Are you sure you want to reset the game?")) {
      socket?.emit(
        "reset_game",
        (res: { success: boolean; error?: string }) => {
          if (res.error) return toast.error(res.error);
        }
      );
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
    const piece = chess.get(from);
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
  const DisconnectedIcon = () => (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        width: "16px",
        height: "16px",
        fill: "#000000",
        verticalAlign: "middle",
      }}
    >
      {" "}
      <g id="Wi-Fi_Off" data-name="Wi-Fi Off">
        {" "}
        <g>
          {" "}
          <path d="M10.37,6.564a12.392,12.392,0,0,1,10.71,3.93c.436.476,1.141-.233.708-.708A13.324,13.324,0,0,0,10.37,5.564c-.631.076-.638,1.077,0,1Z" />{" "}
          <path d="M13.907,10.283A8.641,8.641,0,0,1,18.349,12.9c.434.477,1.139-.232.707-.707a9.586,9.586,0,0,0-4.883-2.871c-.626-.146-.893.818-.266.965Z" />{" "}
          <circle cx="12.003" cy="16.922" r="1.12" />{" "}
          <path d="M19.773,19.06a.5.5,0,0,1-.71.71l-5.84-5.84A4.478,4.478,0,0,0,8.7,15.24c-.43.48-1.14-.23-.71-.7a5.47,5.47,0,0,1,4.06-1.78l-2.37-2.37a8.693,8.693,0,0,0-4.03,2.53c-.43.48-1.13-.23-.7-.71A9.439,9.439,0,0,1,8.893,9.6L6.883,7.59a12.557,12.557,0,0,0-3.96,2.94a.5.5,0,1,1-.7-.71,13.109,13.109,0,0,1,3.91-2.98l-1.9-1.9a.5.5,0,0,1,.71-.71Z" />{" "}
        </g>{" "}
      </g>{" "}
    </svg>
  );
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
    onPieceDrag: ({ square }: PieceHandlerArgs) => {
      const moves = chess.moves({ square: square, verbose: true });
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
      if (gameStatus !== GameStatus.AwaitingProposals || side !== current.side)
        return false;
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
      <div className={"tab-panel " + (activeTab === "chat" ? "active" : "")}>
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
                  // This component no longer uses Shift+Enter
                  // Enter (with or without Shift) will send
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
        <div className="header-bar">
          {/* <h1>TeamChess</h1> - REMOVED */}

          {/* <div className="game-id-bar">
            <span> {playerCount} Players </span>
          </div> - REMOVED */}

          <div className="action-panel **action-panel-desktop-left**">
            {" "}
            {/* "Set Name" button removed as requested */}
            {gameStatus === GameStatus.Lobby && (
              <>
                {" "}
                {players.whitePlayers.length > 0 &&
                  players.blackPlayers.length > 0 && (
                    <button onClick={startGame}>Start Game</button>
                  )}{" "}
              </>
            )}
            {gameStatus !== GameStatus.Lobby && (
              <button onClick={resetGame}>Reset Game</button>
            )}
            {gameStatus !== GameStatus.Over && (
              <>
                {" "}
                {side === "spectator" && (
                  <>
                    {" "}
                    <button onClick={autoAssign}>Auto Assign</button>{" "}
                    <button onClick={() => joinSide("white")}>
                      Join White
                    </button>{" "}
                    <button onClick={() => joinSide("black")}>
                      Join Black
                    </button>{" "}
                  </>
                )}{" "}
                {(side === "white" || side === "black") && (
                  <>
                    {" "}
                    <button onClick={joinSpectator}>
                      Join Spectators
                    </button>{" "}
                    {gameStatus === GameStatus.Lobby && (
                      <button
                        onClick={() =>
                          joinSide(side === "white" ? "black" : "white")
                        }
                      >
                        {" "}
                        Switch to {side === "white" ? "Black" : "White"}{" "}
                      </button>
                    )}{" "}
                    {gameStatus === GameStatus.AwaitingProposals && (
                      <>
                        {" "}
                        {drawOffer && drawOffer !== side ? (
                          <>
                            {" "}
                            <button onClick={acceptDraw}>
                              Accept Draw
                            </button>{" "}
                            <button onClick={rejectDraw}>
                              Reject Draw
                            </button>{" "}
                          </>
                        ) : drawOffer === side ? (
                          <span style={{ fontStyle: "italic" }}>
                            Draw offered...
                          </span>
                        ) : (
                          <>
                            {" "}
                            <button onClick={resignGame}>Resign</button>{" "}
                            <button onClick={offerDraw}>Offer Draw</button>{" "}
                          </>
                        )}{" "}
                      </>
                    )}{" "}
                  </>
                )}{" "}
              </>
            )}
          </div>
        </div>

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
            {gameStatus === GameStatus.Over && (
              <div className="game-over-info">
                {" "}
                <p>
                  {" "}
                  {endReason && reasonMessages[endReason]
                    ? reasonMessages[endReason](winner)
                    : `🎉 Game over! ${
                        winner?.[0].toUpperCase() + winner?.slice(1)
                      } wins!`}{" "}
                </p>{" "}
                {pgn && (
                  <div>
                    {" "}
                    <div className="pgn-header">
                      {" "}
                      <strong>PGN</strong>{" "}
                      <button onClick={() => setIsPgnVisible(!isPgnVisible)}>
                        {isPgnVisible ? "Hide" : "Show"}
                      </button>{" "}
                      <button onClick={copyPgn}>Copy</button>{" "}
                    </div>{" "}
                    {isPgnVisible && <pre>{pgn}</pre>}{" "}
                  </div>
                )}{" "}
              </div>
            )}
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
            </nav>
            {TabContent}
          </div>
        </div>
      </div>
    </>
  );
}
