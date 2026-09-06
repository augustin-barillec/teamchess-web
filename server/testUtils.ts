import type { Server } from "socket.io";
import {
  sessions,
  setGameState,
  setIO,
  createInitialGameState,
} from "./state.js";
import type { GameState, Engine, Side } from "./types.js";

/**
 * Test scaffolding: installs a fresh game state and a fake Socket.IO server
 * into the state module, and provides helpers to add fake players and inspect
 * emitted events. Production code reads the same global state it always does.
 */

export interface FakeSocket {
  id: string;
  data: { pid?: string; side?: string; name?: string };
  emittedEvents: Array<{ event: string; data?: unknown }>;
  emit: (event: string, data?: unknown) => void;
  disconnect: () => void;
}

export function createMockEngine(): Engine {
  return {
    send: () => {},
    quit: () => {},
  };
}

export function createFakeSocket(
  id: string,
  data: { pid?: string; side?: string; name?: string } = {}
): FakeSocket {
  return {
    id,
    data,
    emittedEvents: [],
    emit(event: string, eventData?: unknown) {
      this.emittedEvents.push({ event, data: eventData });
    },
    disconnect() {},
  };
}

export class TestGame {
  gameState: GameState;

  /** All events emitted via io.emit() */
  emittedEvents: Array<{ event: string; data?: unknown }> = [];

  private fakeSockets = new Map<string, FakeSocket>();

  constructor(initialState?: Partial<GameState>) {
    sessions.clear();
    this.gameState = {
      ...createInitialGameState(createMockEngine()),
      ...initialState,
    };
    setGameState(this.gameState);

    const io = {
      emit: (event: string, data?: unknown) => {
        this.emittedEvents.push({ event, data });
      },
      sockets: { sockets: this.fakeSockets },
      on: () => {},
    };
    setIO(io as unknown as Server);
  }

  get sessions() {
    return sessions;
  }

  /**
   * Adds a player: session, fake socket, and team membership.
   */
  addPlayer(pid: string, name: string, side: Side): FakeSocket {
    sessions.set(pid, { pid, name, side });
    const socket = createFakeSocket(pid, { pid, side, name });
    this.fakeSockets.set(pid, socket);

    if (side === "white") this.gameState.whiteIds.add(pid);
    if (side === "black") this.gameState.blackIds.add(pid);

    return socket;
  }

  /**
   * Removes a player entirely (session + socket + team membership).
   */
  removePlayer(pid: string): void {
    sessions.delete(pid);
    this.fakeSockets.delete(pid);
    this.gameState.whiteIds.delete(pid);
    this.gameState.blackIds.delete(pid);
  }

  /**
   * Simulates a socket disconnection: the socket leaves io but the session and
   * team membership survive — the seat is held for the whole game.
   */
  disconnectSocket(pid: string): void {
    this.fakeSockets.delete(pid);
  }

  /** Simulates a reconnection: a socket comes back for a session that never left. */
  reconnectSocket(pid: string): void {
    const sess = sessions.get(pid);
    if (!sess) return;
    this.fakeSockets.set(
      pid,
      createFakeSocket(pid, { pid, side: sess.side, name: sess.name })
    );
  }

  hasEmitted(event: string): boolean {
    return this.emittedEvents.some((e) => e.event === event);
  }

  getEmittedData<T = unknown>(event: string): T[] {
    return this.emittedEvents
      .filter((e) => e.event === event)
      .map((e) => e.data as T);
  }

  getLastEmittedData<T = unknown>(event: string): T | undefined {
    const events = this.getEmittedData<T>(event);
    return events[events.length - 1];
  }

  clearEmittedEvents(): void {
    this.emittedEvents = [];
    for (const socket of this.fakeSockets.values()) {
      socket.emittedEvents = [];
    }
  }

  /**
   * Clears any live timer held by the state (clock interval, vote timer,
   * empty-team forfeit countdown) so nothing leaks into the next test.
   */
  cleanup(): void {
    if (this.gameState.timerInterval) {
      clearInterval(this.gameState.timerInterval);
      this.gameState.timerInterval = undefined;
    }
    if (this.gameState.activeVote) {
      clearTimeout(this.gameState.activeVote.timer);
      this.gameState.activeVote = undefined;
    }
    if (this.gameState.forfeitTimer) {
      clearTimeout(this.gameState.forfeitTimer);
      this.gameState.forfeitTimer = undefined;
    }
  }
}
