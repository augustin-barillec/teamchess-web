import { Player } from "../types.js";
import { sessions, getIO } from "../state.js";

export function broadcastPlayers(): void {
  const io = getIO();
  const onlinePids = new Set<string>();
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.pid) {
      onlinePids.add(socket.data.pid);
    }
  }

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

export function sendSystemMessage(message: string): void {
  const io = getIO();
  io.emit("chat_message", {
    sender: "System",
    senderId: "system",
    message,
    system: true,
  });
}

export function sendTeamMessage(
  side: "white" | "black",
  message: string
): void {
  const io = getIO();
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.side === side) {
      socket.emit("chat_message", {
        sender: "Team System",
        senderId: "system",
        message,
        system: true,
      });
    }
  }
}
