import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { Chess } from "chess.js";
import { toast } from "react-hot-toast";
import {
  Players,
  PlayersUpdate,
  GameInfo,
  Proposal,
  Selection,
  ChatMessage,
  GameStatus,
  TeamVoteState,
  ForfeitCountdown,
} from "../types";
import { Turn } from "../types";
import { STORAGE_KEYS } from "../constants";
import { DEFAULT_PLAYER_NAME, UI } from "../messages";
import { sounds, soundForMove } from "../soundEngine";

interface UseSocketProps {
  chess: Chess;
}

interface UseSocketReturn {
  socket: Socket | null;
  amDisconnected: boolean;
  myId: string;
  name: string;
  nameInput: string;
  setNameInput: React.Dispatch<React.SetStateAction<string>>;
  side: "spectator" | "white" | "black";
  rememberSide: (s: "spectator" | "white" | "black") => void;
  players: Players;
  /** The player who may kick and reset — the longest-present one. */
  leadId: string | null;
  gameStatus: GameStatus;
  pgn: string;
  chatMessages: ChatMessage[];
  turns: Turn[];
  position: string;
  clocks: { whiteTime: number; blackTime: number };
  lastMoveSquares: { from: string; to: string } | null;
  drawOffer: "white" | "black" | null;
  activeVote: TeamVoteState | null;
  forfeitCountdown: ForfeitCountdown | null;
}

export function useSocket({ chess }: UseSocketProps): UseSocketReturn {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [amDisconnected, setAmDisconnected] = useState(false);
  const [myId, setMyId] = useState<string>(
    localStorage.getItem(STORAGE_KEYS.pid) || ""
  );
  const [name, setName] = useState(
    localStorage.getItem(STORAGE_KEYS.name) || DEFAULT_PLAYER_NAME
  );
  const [nameInput, setNameInput] = useState(
    localStorage.getItem(STORAGE_KEYS.name) || DEFAULT_PLAYER_NAME
  );
  const [side, setSide] = useState<"spectator" | "white" | "black">(
    (localStorage.getItem(STORAGE_KEYS.side) as
      | "spectator"
      | "white"
      | "black") || "spectator"
  );
  /**
   * The side we last asked for, as opposed to the one the server currently grants us.
   * It outlives a reload, and it is what we claim back after a drop: the server holds
   * no seat for an absent player, so coming back means asking for it again.
   */
  const chosenSide = useRef<"spectator" | "white" | "black">(
    (localStorage.getItem(STORAGE_KEYS.side) as
      | "spectator"
      | "white"
      | "black") || "spectator"
  );

  const rememberSide = useCallback((s: "spectator" | "white" | "black") => {
    chosenSide.current = s;
    localStorage.setItem(STORAGE_KEYS.side, s);
  }, []);

  const [players, setPlayers] = useState<Players>({
    spectators: [],
    whitePlayers: [],
    blackPlayers: [],
  });
  const [leadId, setLeadId] = useState<string | null>(null);
  const [gameStatus, setGameStatus] = useState<GameStatus>(GameStatus.Setup);
  const [pgn, setPgn] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [position, setPosition] = useState(chess.fen());
  const [clocks, setClocks] = useState({ whiteTime: 0, blackTime: 0 });
  const [lastMoveSquares, setLastMoveSquares] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [drawOffer, setDrawOffer] = useState<"white" | "black" | null>(null);
  const [activeVote, setActiveVote] = useState<TeamVoteState | null>(null);
  const [forfeitCountdown, setForfeitCountdown] =
    useState<ForfeitCountdown | null>(null);

  useEffect(() => {
    const s = io({
      auth: {
        pid: localStorage.getItem(STORAGE_KEYS.pid) || undefined,
        name: localStorage.getItem(STORAGE_KEYS.name) || DEFAULT_PLAYER_NAME,
      },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 2000,
      randomizationFactor: 0.2,
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!myId) return;
    const serverSide = players.whitePlayers.some((p) => p.id === myId)
      ? "white"
      : players.blackPlayers.some((p) => p.id === myId)
        ? "black"
        : "spectator";
    if (serverSide === side) return;

    // The server drops whoever disconnects, so a blink takes our seat with it and
    // hands us back as a spectator. Claim back the side we chose rather than accept
    // the demotion — joining the spectators for real moves chosenSide with it, so a
    // deliberate move out of a team never lands here.
    if (serverSide === "spectator" && chosenSide.current !== "spectator") {
      socket?.emit("join_side", { side: chosenSide.current });
      return;
    }

    setSide(serverSide);
  }, [players, myId, side, socket]);

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
        socket.auth = { pid: id, name: serverName };
      }
    );

    socket.on("players", ({ leadId: lead, ...p }: PlayersUpdate) => {
      setPlayers(p);
      setLeadId(lead);
    });

    socket.on(
      "game_started",
      ({
        moveNumber,
        side,
        proposals,
      }: GameInfo & { proposals: Proposal[] }) => {
        setGameStatus(GameStatus.AwaitingProposals);
        setPgn("");
        setTurns((prev) => {
          const incoming = { moveNumber, side, proposals: proposals || [] };
          const last = prev[prev.length - 1];
          // Reconnection resync of the turn we already know: keep the history
          // and just refresh the current turn's proposals.
          if (last && last.moveNumber === moveNumber && last.side === side) {
            return [...prev.slice(0, -1), { ...last, ...incoming }];
          }
          return [incoming];
        });
        setLastMoveSquares(null);
        setDrawOffer(null);

        sounds.play("start");
      }
    );

    socket.on("game_reset", () => {
      setGameStatus(GameStatus.Setup);
      setPgn("");
      setTurns([]);
      chess.reset();
      setPosition(chess.fen());
      setClocks({ whiteTime: 0, blackTime: 0 });
      setLastMoveSquares(null);
      setDrawOffer(null);
      sounds.play("reset");
    });

    socket.on("clock_update", ({ whiteTime, blackTime }) => {
      setClocks({ whiteTime, blackTime });
    });

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
            ? {
                ...t,
                selection: sel,
                proposals: sel.candidates,
              }
            : t
        )
      );
      chess.load(sel.fen);
      const from = sel.lan.slice(0, 2);
      const to = sel.lan.slice(2, 4);
      setLastMoveSquares({ from, to });
      setPosition(sel.fen);

      // The first move rides on the very submit that started the game, so its
      // game_started chord is still sounding — staying silent here keeps the two
      // from landing on top of each other.
      if (!(sel.moveNumber === 1 && sel.side === "white")) {
        sounds.play(soundForMove(sel.san || ""));
      }
    });

    socket.on("turn_change", ({ moveNumber, side }: GameInfo) =>
      setTurns((ts) => [...ts, { moveNumber, side, proposals: [] }])
    );

    socket.on("game_over", ({ pgn: newPgn }: { pgn: string }) => {
      setGameStatus(GameStatus.Over);
      setPgn(newPgn);
      setDrawOffer(null);

      sounds.play("end");
    });

    socket.on("chat_message", (msg: ChatMessage) => {
      setChatMessages((msgs) => [...msgs, msg]);
    });

    socket.on("game_status_update", ({ status }: { status: GameStatus }) => {
      setGameStatus(status);
    });

    socket.on(
      "draw_offer_update",
      ({ side }: { side: "white" | "black" | null }) => {
        setDrawOffer(side as "white" | "black" | null);
      }
    );

    socket.on("vote_update", (state: TeamVoteState | null) => {
      setActiveVote(state);
    });

    socket.on("forfeit_countdown", (state: ForfeitCountdown | null) => {
      setForfeitCountdown(state);
    });

    socket.on("kicked", () => {
      toast.error(UI.toastKicked);
      socket.disconnect();
    });

    return () => {
      // Only detach our handlers: disconnecting here would kill the connection
      // for good (socket.io never auto-reconnects after a manual disconnect).
      socket.removeAllListeners();
    };
  }, [socket, chess]);

  return {
    socket,
    amDisconnected,
    myId,
    name,
    nameInput,
    setNameInput,
    side,
    rememberSide,
    players,
    leadId,
    gameStatus,
    pgn,
    chatMessages,
    turns,
    position,
    clocks,
    lastMoveSquares,
    drawOffer,
    activeVote,
    forfeitCountdown,
  };
}
