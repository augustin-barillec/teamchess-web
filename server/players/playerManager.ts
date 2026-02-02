import { Socket } from "socket.io";
import { sessions, getGameState } from "../state.js";
import { DISCONNECT_GRACE_MS } from "../constants.js";
import { broadcastPlayers } from "../utils/messaging.js";
import { endIfOneSided, tryFinalizeTurn } from "../game/gameLogic.js";

export function leave(socket: Socket): void {
  const pid = socket.data.pid as string | undefined;
  if (!pid) return;

  const sess = sessions.get(pid);
  if (!sess) return;

  const gameState = getGameState();

  const finalize = () => {
    if (sess.side === "white") gameState.whiteIds.delete(pid);
    if (sess.side === "black") gameState.blackIds.delete(pid);

    sessions.delete(pid);
    endIfOneSided();
    tryFinalizeTurn();
    broadcastPlayers();
  };

  if (sess.reconnectTimer) clearTimeout(sess.reconnectTimer);
  sess.reconnectTimer = setTimeout(() => {
    finalize();
  }, DISCONNECT_GRACE_MS);

  broadcastPlayers();
  tryFinalizeTurn();
}
