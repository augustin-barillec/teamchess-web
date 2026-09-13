import { useCallback, useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import { Chess } from "chess.js";
import { toast } from "react-hot-toast";
import {
  ChatMessage,
  ClientAction,
  GameState,
  GameStatus,
  ServerEvent,
  Side,
} from "../types";
import { STORAGE_KEYS } from "../constants";
import { DEFAULT_PLAYER_NAME, UI } from "../messages";
import { DEFAULT_CLOCK_TIME } from "../../../server/shared_constants";

/** The board before the first snapshot lands — or while the link is down for good. */
const EMPTY_STATE: GameState = {
  leadId: null,
  players: [],
  status: GameStatus.Setup,
  fen: new Chess().fen(),
  turns: [],
  whiteTime: DEFAULT_CLOCK_TIME,
  blackTime: DEFAULT_CLOCK_TIME,
  turnStartedAt: null,
  vote: null,
  drawOffer: null,
  forfeit: null,
  gameOver: null,
};

const welcome = (): ChatMessage => ({
  sender: "System",
  senderId: "system",
  message: UI.welcomeMessage,
  system: true,
});

const storedSide = (): Side =>
  (localStorage.getItem(STORAGE_KEYS.side) as Side | null) ?? "spectator";

interface UseSocketReturn {
  act: (action: ClientAction) => void;
  amDisconnected: boolean;
  myId: string;
  name: string;
  changeName: (name: string) => void;
  /** The game as the server last published it: the only game state this side holds. */
  game: GameState;
  chat: ChatMessage[];
  side: Side;
  rememberSide: (side: Side) => void;
}

export function useSocket(): UseSocketReturn {
  // Built once, connected by the effect below: the object is inert until then, so
  // creating it during render has no side effect and StrictMode's double render
  // opens nothing twice.
  const [socket] = useState<Socket>(() =>
    io({
      autoConnect: false,
      // Read at every connection attempt, so a reconnect carries whatever id and
      // name the storage holds by then.
      auth: (cb) =>
        cb({
          pid: localStorage.getItem(STORAGE_KEYS.pid) || undefined,
          name: localStorage.getItem(STORAGE_KEYS.name) || DEFAULT_PLAYER_NAME,
        }),
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 2000,
      randomizationFactor: 0.2,
    })
  );
  const [amDisconnected, setAmDisconnected] = useState(false);
  const [myId, setMyId] = useState<string>(
    localStorage.getItem(STORAGE_KEYS.pid) || ""
  );
  const [storedName, setStoredName] = useState(
    localStorage.getItem(STORAGE_KEYS.name) || DEFAULT_PLAYER_NAME
  );
  /**
   * The side we last asked for, as opposed to the one the server currently grants us.
   * It outlives a reload, and it is what we claim back after a drop: the server holds
   * no seat for an absent player, so coming back means asking for it again.
   */
  const [chosenSide, setChosenSide] = useState<Side>(storedSide);
  const [game, setGame] = useState<GameState>(EMPTY_STATE);
  const [chat, setChat] = useState<ChatMessage[]>(() => [welcome()]);

  useEffect(() => {
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, [socket]);

  useEffect(() => {
    socket.on("connect", () => setAmDisconnected(false));
    socket.on("disconnect", () => setAmDisconnected(true));

    socket.on("event", (event: ServerEvent) => {
      switch (event.type) {
        case "SESSION": {
          const { id, name } = event.payload;
          setMyId(id);
          setStoredName(name);
          localStorage.setItem(STORAGE_KEYS.pid, id);
          localStorage.setItem(STORAGE_KEYS.name, name);
          break;
        }
        case "STATE":
          setGame(event.payload);
          break;
        case "CHAT":
          setChat((prev) => [...prev, event.payload]);
          break;
        case "ERROR":
          toast.error(event.payload.message);
          break;
        case "KICKED":
          toast.error(UI.toastKicked);
          socket.disconnect();
          break;
      }
    });

    return () => {
      // Only detach our handlers: disconnecting here would kill the connection
      // for good (socket.io never auto-reconnects after a manual disconnect).
      socket.removeAllListeners();
    };
  }, [socket]);

  const act = useCallback(
    (action: ClientAction) => {
      socket.emit("action", action);
    },
    [socket]
  );

  const me = game.players.find((p) => p.id === myId);
  const serverSide: Side = me?.side ?? "spectator";

  // The server drops whoever disconnects, so a blink takes our seat with it and
  // hands us back as a spectator. Claim back the side we chose rather than accept
  // the demotion — joining the spectators for real moves chosenSide with it, so a
  // deliberate move out of a team never lands here.
  const reclaiming =
    !!me && serverSide === "spectator" && chosenSide !== "spectator";
  useEffect(() => {
    if (reclaiming) act({ type: "JOIN_SIDE", payload: { side: chosenSide } });
  }, [reclaiming, chosenSide, act, game]);

  const rememberSide = useCallback((s: Side) => {
    setChosenSide(s);
    localStorage.setItem(STORAGE_KEYS.side, s);
  }, []);

  const changeName = useCallback(
    (name: string) => {
      setStoredName(name);
      localStorage.setItem(STORAGE_KEYS.name, name);
      act({ type: "SET_NAME", payload: { name } });
    },
    [act]
  );

  return {
    act,
    amDisconnected,
    myId,
    name: me?.name ?? storedName,
    changeName,
    game,
    chat,
    // Shown as the side we are claiming back while the claim is in flight, so a
    // blink never flips the board or offers Join buttons for a seat we still hold.
    side: reclaiming ? chosenSide : serverSide,
    rememberSide,
  };
}
