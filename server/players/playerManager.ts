import { Socket } from "socket.io";
import { sessions, getGameState, getAllSockets } from "../state.js";

import { broadcastPlayers, sendSystemMessage } from "../utils/messaging.js";
import { endIfOneSided, tryFinalizeTurn } from "../game/gameLogic.js";
import { MSG } from "../shared_messages.js";

/**
 * Gives up a seat for good: nothing is held for an absent player, whatever the
 * game state. What makes a blink survivable is the countdown endIfOneSided arms
 * on the team this empties — long enough for the client to come back and claim
 * its side, or for anyone else to take it.
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
  // Teammates never wait on someone who is not there.
  tryFinalizeTurn();
  endIfOneSided();
}

/** Blacklists the target so they stay kicked across reconnects, then drops them. */
export function executeKick(targetPid: string, targetName: string): void {
  const gameState = getGameState();

  gameState.blacklist.add(targetPid);

  for (const socket of getAllSockets()) {
    if (socket.data.pid === targetPid) {
      socket.emit("kicked", { message: MSG.youHaveBeenKicked });
      socket.disconnect();
    }
  }

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
