import type { Socket } from "socket.io";
import type { Player, PlayersUpdate } from "../types.js";
import { sessions, getIO, getLeadId } from "../state.js";
import { SENDER_SYSTEM } from "../shared_messages.js";

/** Broadcasts the current player list — and who leads — to all clients. */
export function broadcastPlayers(): void {
  const spectators: Player[] = [];
  const whitePlayers: Player[] = [];
  const blackPlayers: Player[] = [];

  for (const sess of sessions.values()) {
    const p: Player = { id: sess.pid, name: sess.name };
    if (sess.side === "white") whitePlayers.push(p);
    else if (sess.side === "black") blackPlayers.push(p);
    else spectators.push(p);
  }

  const update: PlayersUpdate = {
    spectators,
    whitePlayers,
    blackPlayers,
    leadId: getLeadId(),
  };
  getIO().emit("players", update);
}

export function sendSystemMessage(message: string): void {
  getIO().emit("chat_message", {
    sender: SENDER_SYSTEM,
    senderId: "system",
    message,
    system: true,
  });
}

/** A system message only the one client sees. */
export function sendPrivateSystemMessage(
  socket: Socket,
  message: string
): void {
  socket.emit("chat_message", {
    sender: SENDER_SYSTEM,
    senderId: "system",
    message,
    system: true,
  });
}
