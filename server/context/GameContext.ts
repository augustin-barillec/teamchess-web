import { Server } from "socket.io";
import { Chess } from "chess.js";
import type { Session, GameState, Engine, PlayerSide } from "../types.js";
import { GameStatus } from "../shared_types.js";
import { DEFAULT_TIME } from "../constants.js";

/**
 * Minimal socket interface for dependency injection.
 * Allows both real Socket.io sockets and mock sockets in tests.
 */
export interface ISocket {
  data: { pid?: string; side?: string; name?: string };
  emit: (event: string, data?: unknown) => void;
}

/**
 * Minimal IO interface for dependency injection.
 */
export interface IIO {
  emit: (event: string, data?: unknown) => void;
  sockets: {
    sockets: Map<string, ISocket>;
  };
  // Handler parameter is broad to accept both real Socket.IO sockets and ISocket in tests
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on: (event: string, handler: (socket: any) => void) => void;
}

/**
 * Interface for the game context - the central dependency injection container.
 * All modules that need access to game state, sessions, or IO should depend on this interface.
 */
export interface IGameContext {
  readonly sessions: Map<string, Session>;
  readonly gameState: GameState;
  readonly io: IIO;

  updateGameState(updates: Partial<GameState>): void;
  resetGame(engine: Engine): void;
  getOnlinePids(): Set<string>;
  getActiveTeamPids(side: PlayerSide): Set<string>;
  getSocketsBySide(side: PlayerSide): ISocket[];
  getAllSockets(): ISocket[];
}

/**
 * Production implementation of the game context.
 * Holds all shared state and provides methods to access and modify it.
 */
export class GameContext implements IGameContext {
  private _sessions: Map<string, Session>;
  private _gameState: GameState;
  private _io: Server;

  constructor(io: Server, initialState: GameState) {
    this._sessions = new Map();
    this._gameState = initialState;
    this._io = io;
  }

  get sessions(): Map<string, Session> {
    return this._sessions;
  }

  get gameState(): GameState {
    return this._gameState;
  }

  get io(): IIO {
    return this._io as unknown as IIO;
  }

  updateGameState(updates: Partial<GameState>): void {
    Object.assign(this._gameState, updates);
  }

  resetGame(engine: Engine): void {
    clearGameStateTimers(this._gameState);
    const blacklist = this._gameState.blacklist;
    this._gameState = createInitialGameState(engine);
    this._gameState.blacklist = blacklist;
  }

  getOnlinePids(): Set<string> {
    const pids = new Set<string>();
    for (const socket of this._io.sockets.sockets.values()) {
      if (socket.data.pid) pids.add(socket.data.pid);
    }
    return pids;
  }

  getActiveTeamPids(side: PlayerSide): Set<string> {
    const onlinePids = this.getOnlinePids();
    const teamIds =
      side === "white" ? this._gameState.whiteIds : this._gameState.blackIds;
    return new Set([...teamIds].filter((pid) => onlinePids.has(pid)));
  }

  getSocketsBySide(side: PlayerSide): ISocket[] {
    return [...this._io.sockets.sockets.values()].filter(
      (s) => s.data.side === side
    ) as unknown as ISocket[];
  }

  getAllSockets(): ISocket[] {
    return [...this._io.sockets.sockets.values()] as unknown as ISocket[];
  }
}

/**
 * Clears all active timers on a game state to prevent leaked callbacks.
 */
export function clearGameStateTimers(state: GameState): void {
  if (state.timerInterval) clearInterval(state.timerInterval);
  if (state.whiteVote?.timer) clearTimeout(state.whiteVote.timer);
  if (state.blackVote?.timer) clearTimeout(state.blackVote.timer);
  if (state.kickVote?.timer) clearTimeout(state.kickVote.timer);
  if (state.resetVote?.timer) clearTimeout(state.resetVote.timer);
}

/**
 * Creates initial game state for a new game.
 */
export function createInitialGameState(engine: Engine): GameState {
  return {
    whiteIds: new Set(),
    blackIds: new Set(),
    moveNumber: 1,
    side: "white",
    proposals: new Map(),
    whiteTime: DEFAULT_TIME,
    blackTime: DEFAULT_TIME,
    timerInterval: undefined,
    engine,
    chess: new Chess(),
    status: GameStatus.Lobby,
    endReason: undefined,
    endWinner: undefined,
    drawOffer: undefined,
    whiteVote: undefined,
    blackVote: undefined,
    kickVote: undefined,
    resetVote: undefined,
    blacklist: new Set(),
  };
}
