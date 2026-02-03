import { Socket } from "socket.io";
import type { IGameContext } from "../context/GameContext.js";
import { globalContext } from "../context/GlobalContextAdapter.js";
import { DISCONNECT_GRACE_MS } from "../constants.js";
import { broadcastPlayers } from "../utils/messaging.js";
import { endIfOneSided, tryFinalizeTurn } from "../game/gameLogic.js";

/**
 * Handles player disconnection with grace period for reconnection.
 * @param ctx Optional context for dependency injection (defaults to global)
 */
export function leave(socket: Socket, ctx: IGameContext = globalContext): void {
  const pid = socket.data.pid as string | undefined;
  if (!pid) return;

  const { sessions, gameState } = ctx;
  const sess = sessions.get(pid);
  if (!sess) return;

  const finalize = () => {
    if (sess.side === "white") gameState.whiteIds.delete(pid);
    if (sess.side === "black") gameState.blackIds.delete(pid);

    sessions.delete(pid);
    endIfOneSided(ctx);
    tryFinalizeTurn(ctx);
    broadcastPlayers(ctx);
  };

  if (sess.reconnectTimer) clearTimeout(sess.reconnectTimer);
  sess.reconnectTimer = setTimeout(() => {
    finalize();
  }, DISCONNECT_GRACE_MS);

  broadcastPlayers(ctx);
  tryFinalizeTurn(ctx);
}
