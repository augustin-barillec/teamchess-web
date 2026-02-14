import { Socket } from "socket.io";
import { sessions, getGameState, setGameState, getIO } from "../state.js";
import {
  type IGameContext,
  clearGameStateTimers,
  createInitialGameState,
} from "./GameContext.js";
import type { GameState, Engine, PlayerSide, Session } from "../types.js";

/**
 * Adapter that wraps the existing global state to implement IGameContext.
 * Used during migration to allow gradual refactoring from global state to DI.
 *
 * This adapter enables new code to use IGameContext while existing code
 * continues to use the global state functions.
 */
export class GlobalContextAdapter implements IGameContext {
  get sessions(): Map<string, Session> {
    return sessions;
  }

  get gameState(): GameState {
    return getGameState();
  }

  get io() {
    return getIO();
  }

  updateGameState(updates: Partial<GameState>): void {
    const current = getGameState();
    Object.assign(current, updates);
  }

  resetGame(engine: Engine): void {
    const current = getGameState();
    clearGameStateTimers(current);
    const blacklist = current.blacklist;
    const newState = createInitialGameState(engine);
    newState.blacklist = blacklist;
    setGameState(newState);
  }

  getOnlinePids(): Set<string> {
    const pids = new Set<string>();
    for (const socket of getIO().sockets.sockets.values()) {
      if (socket.data.pid) pids.add(socket.data.pid);
    }
    return pids;
  }

  getActiveTeamPids(side: PlayerSide): Set<string> {
    const onlinePids = this.getOnlinePids();
    const gameState = getGameState();
    const teamIds = side === "white" ? gameState.whiteIds : gameState.blackIds;
    return new Set([...teamIds].filter((pid) => onlinePids.has(pid)));
  }

  getSocketsBySide(side: PlayerSide): Socket[] {
    return [...getIO().sockets.sockets.values()].filter(
      (s) => s.data.side === side
    );
  }

  getAllSockets(): Socket[] {
    return [...getIO().sockets.sockets.values()];
  }
}

/**
 * Singleton instance for use during migration.
 * Import this in files that need to migrate incrementally.
 */
export const globalContext = new GlobalContextAdapter();
