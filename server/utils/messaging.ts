import type { Socket } from "socket.io";
import type { Player, PlayerSide } from "../types.js";
import type { IGameContext } from "../context/GameContext.js";
import { globalContext } from "../context/GlobalContextAdapter.js";
import { SENDER_SYSTEM, SENDER_TEAM_SYSTEM } from "../shared_messages.js";

/**
 * Broadcasts the current player list to all clients.
 * @param ctx Optional context for dependency injection (defaults to global)
 */
export function broadcastPlayers(ctx: IGameContext = globalContext): void {
  const { sessions, io } = ctx;
  const onlinePids = ctx.getOnlinePids();

  const spectators: Player[] = [];
  const whitePlayers: Player[] = [];
  const blackPlayers: Player[] = [];

  for (const sess of sessions.values()) {
    const p: Player = {
      id: sess.pid,
      name: sess.name,
      connected: onlinePids.has(sess.pid),
    };
    if (sess.side === "white") whitePlayers.push(p);
    else if (sess.side === "black") blackPlayers.push(p);
    else spectators.push(p);
  }
  io.emit("players", { spectators, whitePlayers, blackPlayers });
}

/**
 * Sends a system message to all clients.
 * @param ctx Optional context for dependency injection (defaults to global)
 */
export function sendSystemMessage(
  message: string,
  ctx: IGameContext = globalContext
): void {
  ctx.io.emit("chat_message", {
    sender: SENDER_SYSTEM,
    senderId: "system",
    message,
    system: true,
  });
}

/**
 * Sends a system message to a single socket (private, only visible to that client).
 */
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

/**
 * Sends a system message to a specific team.
 * @param ctx Optional context for dependency injection (defaults to global)
 */
export function sendTeamMessage(
  side: PlayerSide,
  message: string,
  ctx: IGameContext = globalContext
): void {
  for (const socket of ctx.getSocketsBySide(side)) {
    socket.emit("chat_message", {
      sender: SENDER_TEAM_SYSTEM,
      senderId: "system",
      message,
      system: true,
    });
  }
}
