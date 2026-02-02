import { Server } from "socket.io";
import { Session, GameState } from "./types.js";

export const sessions = new Map<string, Session>();

let gameState: GameState;
let io: Server;

export function getGameState(): GameState {
  return gameState;
}

export function setGameState(state: GameState): void {
  gameState = state;
}

export function getIO(): Server {
  return io;
}

export function setIO(server: Server): void {
  io = server;
}
