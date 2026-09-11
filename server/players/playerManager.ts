import { Socket } from "socket.io";
import { sessions, getGameState, getAllSockets } from "../state.js";

import { broadcastPlayers, sendSystemMessage } from "../utils/messaging.js";
import { endIfOneSided, tryFinalizeTurn } from "../game/gameLogic.js";
import { MSG } from "../shared_messages.js";

/**
 * Handles a player disconnecting.
 *
 * Once a game is under way their seat is theirs to the end: going quiet costs a
 * player nothing by itself, so a dropped connection can never lose a game on its
 * own. Only an empty team is a problem, and endIfOneSided gives it a visible
 * countdown to fix itself. The session stays, so a reconnection with the same pid
 * walks straight back into the same side.
 *
 * A seat is only worth holding for someone who has one, so spectators — and
 * anyone at all before the game starts — are dropped on the spot instead.
 */
export function leave(socket: Socket): void {
  const pid = socket.data.pid as string | undefined;
  if (!pid) return;

  const gameState = getGameState();
  const sess = sessions.get(pid);
  if (!sess) return;

  gameState.whiteIds.delete(pid);
  gameState.blackIds.delete(pid);
  sessions.delete(pid);

  broadcastPlayers();
  // Teammates never wait on someone who is not there, and there is no offline state
  // to hold a seat open: a client that comes back claims its side again itself.
  tryFinalizeTurn();
  endIfOneSided();
}

/**
 * Executes a kick: adds target to blacklist, disconnects them.
 */
export function executeKick(targetPid: string, targetName: string): void {
  const gameState = getGameState();

  // Add to blacklist
  gameState.blacklist.add(targetPid);

  // Find and disconnect the target's socket
  for (const socket of getAllSockets()) {
    if (socket.data.pid === targetPid) {
      socket.emit("kicked", { message: MSG.youHaveBeenKicked });
      socket.disconnect();
    }
  }

  // Clean up session
  const sess = sessions.get(targetPid);
  if (sess) {
    if (sess.side === "white") gameState.whiteIds.delete(targetPid);
    if (sess.side === "black") gameState.blackIds.delete(targetPid);
    sessions.delete(targetPid);
  }

  sendSystemMessage(MSG.playerKicked(targetName));
  broadcastPlayers();

  // The kicked player may have been the last of their team, or the only one
  // whose proposal was still awaited
  endIfOneSided();
  tryFinalizeTurn();
}
