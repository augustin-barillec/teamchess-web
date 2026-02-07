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
  // Using any for the socket parameter to allow both real Socket.io sockets and ISocket
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
    if (this._gameState.timerInterval) {
      clearInterval(this._gameState.timerInterval);
    }
    if (this._gameState.resetVote?.timer) {
      clearTimeout(this._gameState.resetVote.timer);
    }
    const blacklist = this._gameState.blacklist;
    this._gameState = {
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
      blacklist,
    };
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
