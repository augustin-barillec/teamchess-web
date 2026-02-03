import type { IEngineService } from "./IEngineService.js";

/**
 * Mock implementation of IEngineService for testing.
 * Allows configuring the move to return and tracks calls.
 */
export class MockEngineService implements IEngineService {
  /** The move to return on the next chooseBestMove call */
  private nextMove?: string;

  /** Number of times chooseBestMove has been called */
  chooseMoveCallCount = 0;

  /** Last FEN passed to chooseBestMove */
  lastFen?: string;

  /** Last candidates passed to chooseBestMove */
  lastCandidates?: string[];

  /** Whether quit() has been called */
  wasQuit = false;

  /**
   * Sets the move to return on the next chooseBestMove call.
   * If not set, returns the first candidate.
   */
  setNextMove(move: string): void {
    this.nextMove = move;
  }

  async chooseBestMove(fen: string, candidates: string[]): Promise<string> {
    this.chooseMoveCallCount++;
    this.lastFen = fen;
    this.lastCandidates = candidates;

    const move = this.nextMove ?? candidates[0];
    this.nextMove = undefined; // Reset after use
    return move;
  }

  quit(): void {
    this.wasQuit = true;
  }

  /**
   * Resets all state for a fresh test.
   */
  reset(): void {
    this.nextMove = undefined;
    this.chooseMoveCallCount = 0;
    this.lastFen = undefined;
    this.lastCandidates = undefined;
    this.wasQuit = false;
  }
}
