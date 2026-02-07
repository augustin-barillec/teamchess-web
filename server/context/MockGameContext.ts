import { Chess } from "chess.js";
import type { Session, GameState, Engine, PlayerSide } from "../types.js";
import { GameStatus } from "../shared_types.js";
import type { IGameContext, ISocket, IIO } from "./GameContext.js";

/**
 * Mock socket for testing - tracks emitted events.
 */
export interface MockSocket {
  id: string;
  data: { pid?: string; side?: string; name?: string };
  emit: (event: string, data?: unknown) => void;
  emittedEvents: Array<{ event: string; data?: unknown }>;
}

/**
 * Creates a mock socket for testing.
 */
export function createMockSocket(
  id: string,
  data: { pid?: string; side?: string; name?: string } = {}
): MockSocket {
  const socket: MockSocket = {
    id,
    data,
    emittedEvents: [],
    emit(event: string, eventData?: unknown) {
      this.emittedEvents.push({ event, data: eventData });
    },
  };
  return socket;
}

/**
 * Creates a mock engine for testing.
 */
export function createMockEngine(): Engine {
  return {
    send: () => {},
    quit: () => {},
  };
}

/**
 * Mock implementation of IGameContext for testing.
 * Provides full control over state and captures all emitted events.
 */
export class MockGameContext implements IGameContext {
  sessions: Map<string, Session> = new Map();
  gameState: GameState;

  /** All events emitted via io.emit() */
  emittedEvents: Array<{ event: string; data?: unknown; target?: string }> = [];

  /** Mock sockets by their ID */
  private mockSockets: Map<string, MockSocket> = new Map();

  constructor(initialState?: Partial<GameState>) {
    this.gameState = {
      whiteIds: new Set(),
      blackIds: new Set(),
      moveNumber: 1,
      side: "white",
      proposals: new Map(),
      whiteTime: 600,
      blackTime: 600,
      timerInterval: undefined,
      engine: createMockEngine(),
      chess: new Chess(),
      status: GameStatus.Lobby,
      endReason: undefined,
      endWinner: undefined,
      drawOffer: undefined,
      whiteVote: undefined,
      blackVote: undefined,
      kickVote: undefined,
      blacklist: new Set(),
      ...initialState,
    };
  }

  /**
   * Mock IO server that captures emit calls.
   */
  get io(): IIO {
    return {
      emit: (event: string, data?: unknown) => {
        this.emittedEvents.push({ event, data, target: "broadcast" });
      },
      sockets: {
        sockets: this.mockSockets as Map<string, ISocket>,
      },
      on: () => {},
    };
  }

  // ========== Test Helpers ==========

  /**
   * Adds a player to the context with a mock socket.
   */
  addPlayer(
    pid: string,
    name: string,
    side: "white" | "black" | "spectator"
  ): MockSocket {
    this.sessions.set(pid, { pid, name, side });
    const socket = createMockSocket(pid, { pid, side, name });
    this.mockSockets.set(pid, socket);

    if (side === "white") this.gameState.whiteIds.add(pid);
    if (side === "black") this.gameState.blackIds.add(pid);

    return socket;
  }

  /**
   * Removes a player from the context.
   */
  removePlayer(pid: string): void {
    this.sessions.delete(pid);
    this.mockSockets.delete(pid);
    this.gameState.whiteIds.delete(pid);
    this.gameState.blackIds.delete(pid);
  }

  /**
   * Gets a mock socket by player ID.
   */
  getSocket(pid: string): MockSocket | undefined {
    return this.mockSockets.get(pid);
  }

  /**
   * Checks if a specific event was emitted via io.emit().
   */
  hasEmitted(event: string): boolean {
    return this.emittedEvents.some((e) => e.event === event);
  }

  /**
   * Gets all data emitted for a specific event.
   */
  getEmittedData<T = unknown>(event: string): T[] {
    return this.emittedEvents
      .filter((e) => e.event === event)
      .map((e) => e.data as T);
  }

  /**
   * Gets the last emitted data for a specific event.
   */
  getLastEmittedData<T = unknown>(event: string): T | undefined {
    const events = this.getEmittedData<T>(event);
    return events[events.length - 1];
  }

  /**
   * Clears all captured emitted events.
   */
  clearEmittedEvents(): void {
    this.emittedEvents = [];
    for (const socket of this.mockSockets.values()) {
      socket.emittedEvents = [];
    }
  }

  // ========== IGameContext Implementation ==========

  updateGameState(updates: Partial<GameState>): void {
    Object.assign(this.gameState, updates);
  }

  resetGame(engine: Engine): void {
    if (this.gameState.timerInterval) {
      clearInterval(this.gameState.timerInterval);
    }
    const blacklist = this.gameState.blacklist;
    this.gameState = {
      whiteIds: new Set(),
      blackIds: new Set(),
      moveNumber: 1,
      side: "white",
      proposals: new Map(),
      whiteTime: 600,
      blackTime: 600,
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
      blacklist,
    };
  }

  getOnlinePids(): Set<string> {
    return new Set(this.mockSockets.keys());
  }

  getActiveTeamPids(side: PlayerSide): Set<string> {
    const onlinePids = this.getOnlinePids();
    const teamIds =
      side === "white" ? this.gameState.whiteIds : this.gameState.blackIds;
    return new Set([...teamIds].filter((pid) => onlinePids.has(pid)));
  }

  getSocketsBySide(side: PlayerSide): ISocket[] {
    return [...this.mockSockets.values()].filter((s) => s.data.side === side);
  }

  getAllSockets(): ISocket[] {
    return [...this.mockSockets.values()];
  }
}
