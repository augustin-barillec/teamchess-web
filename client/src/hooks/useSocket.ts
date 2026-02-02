import { useEffect, useState, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { Chess } from "chess.js";
import { toast } from "react-hot-toast";
import {
  Players,
  GameInfo,
  Proposal,
  Selection,
  ChatMessage,
  GameStatus,
  TeamVoteState,
} from "../types";
import { Turn } from "../types";
import { STORAGE_KEYS, reasonMessages } from "../constants";
import { sounds } from "../soundEngine";

interface UseSocketProps {
  chess: Chess;
  isMobile: boolean;
  activeTabRef: React.MutableRefObject<string>;
}

interface UseSocketReturn {
  socket: Socket | null;
  amDisconnected: boolean;
  myId: string;
  name: string;
  nameInput: string;
  setNameInput: React.Dispatch<React.SetStateAction<string>>;
  side: "spectator" | "white" | "black";
  setSide: React.Dispatch<
    React.SetStateAction<"spectator" | "white" | "black">
  >;
  players: Players;
  gameStatus: GameStatus;
  pgn: string;
  chatMessages: ChatMessage[];
  turns: Turn[];
  position: string;
  clocks: { whiteTime: number; blackTime: number };
  lastMoveSquares: { from: string; to: string } | null;
  drawOffer: "white" | "black" | null;
  teamVote: TeamVoteState;
  setHasUnreadMessages: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useSocket({
  chess,
  isMobile,
  activeTabRef,
}: UseSocketProps): UseSocketReturn {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [amDisconnected, setAmDisconnected] = useState(false);
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
  const [_winner, setWinner] = useState<"white" | "black" | null>(null);
  const [_endReason, setEndReason] = useState<string | null>(null);
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
  const [teamVote, setTeamVote] = useState<TeamVoteState>({
    isActive: false,
    type: null,
    initiatorName: "",
    yesVotes: [],
    requiredVotes: 0,
    endTime: 0,
  });
  const [_hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const prevClocks = useRef({ whiteTime: 600, blackTime: 600 });

  // Socket initialization
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, []);

  // Sync side with server state
  useEffect(() => {
    if (!myId) return;
    const serverSide = players.whitePlayers.some((p) => p.id === myId)
      ? "white"
      : players.blackPlayers.some((p) => p.id === myId)
        ? "black"
        : "spectator";
    if (serverSide !== side) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSide(serverSide);
      localStorage.setItem(STORAGE_KEYS.side, serverSide);
    }
  }, [players, myId, side]);

  // Socket event handlers
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

        prevClocks.current = { whiteTime: 600, blackTime: 600 };

        sounds.play("start");
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
      prevClocks.current = { whiteTime: 600, blackTime: 600 };
    });

    socket.on("clock_update", ({ whiteTime, blackTime }) => {
      const prev = prevClocks.current;

      if (prev.whiteTime > 60 && whiteTime <= 60 && whiteTime > 0) {
        sounds.play("lowtime");
      }

      if (prev.blackTime > 60 && blackTime <= 60 && blackTime > 0) {
        sounds.play("lowtime");
      }

      prevClocks.current = { whiteTime, blackTime };
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

      const isFirstMove = sel.moveNumber === 1 && sel.side === "white";

      if (!isFirstMove) {
        const san = sel.san || "";
        if (san.includes("#") || san.includes("+")) {
          sounds.play("check");
        } else if (san.includes("x")) {
          sounds.play("capture");
        } else {
          sounds.play("move");
        }
      }
    });

    socket.on("turn_change", ({ moveNumber, side }: GameInfo) =>
      setTurns((ts) => [...ts, { moveNumber, side, proposals: [] }])
    );

    socket.on(
      "game_over",
      ({
        reason,
        winner,
        pgn: newPgn,
      }: {
        reason: string;
        winner: "white" | "black" | null;
        pgn: string;
      }) => {
        setGameStatus(GameStatus.Over);
        setWinner(winner);
        setEndReason(reason);
        setPgn(newPgn);
        setDrawOffer(null);

        sounds.play("end");

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

    socket.on("team_vote_update", (state: TeamVoteState) => {
      setTeamVote(state);
    });

    return () => {
      socket.disconnect();
    };
  }, [socket, chess, isMobile, activeTabRef]);

  return {
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
  };
}
