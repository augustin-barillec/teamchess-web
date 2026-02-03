import type { IGameContext } from "../context/GameContext.js";
import type { Player, PlayerSide } from "../types.js";

/**
 * Service for broadcasting messages and player updates.
 * Uses dependency injection for context.
 */
export class MessagingService {
  constructor(private context: IGameContext) {}

  /**
   * Broadcasts the current player list to all clients.
   */
  broadcastPlayers(): void {
    const { sessions, io } = this.context;
    const onlinePids = this.context.getOnlinePids();

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
   */
  sendSystemMessage(message: string): void {
    this.context.io.emit("chat_message", {
      sender: "System",
      senderId: "system",
      message,
      system: true,
    });
  }

  /**
   * Sends a system message to a specific team.
   */
  sendTeamMessage(side: PlayerSide, message: string): void {
    for (const socket of this.context.getSocketsBySide(side)) {
      socket.emit("chat_message", {
        sender: "Team System",
        senderId: "system",
        message,
        system: true,
      });
    }
  }
}
