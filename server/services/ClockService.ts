import type { IGameContext } from "../context/GameContext.js";
import type { IClock } from "../interfaces/IClock.js";
import { RealClock } from "../interfaces/IClock.js";
import { GameStatus, EndReason } from "../shared_types.js";

/**
 * Service for managing the game clock.
 * Uses dependency injection for both context and clock abstraction.
 */
export class ClockService {
  private onTimeoutCallback?: (reason: string, winner: string) => void;

  constructor(
    private context: IGameContext,
    private clock: IClock = new RealClock()
  ) {}

  /**
   * Sets the callback to be called when time runs out.
   */
  setTimeoutCallback(
    callback: (reason: string, winner: string) => void
  ): void {
    this.onTimeoutCallback = callback;
  }

  /**
   * Starts the game clock.
   * Only runs when game status is AwaitingProposals.
   */
  start(): void {
    const { gameState, io } = this.context;

    if (gameState.status !== GameStatus.AwaitingProposals) return;

    this.stop();

    io.emit("clock_update", {
      whiteTime: gameState.whiteTime,
      blackTime: gameState.blackTime,
    });

    this.clock.startInterval(() => {
      if (gameState.side === "white") gameState.whiteTime--;
      else gameState.blackTime--;

      io.emit("clock_update", {
        whiteTime: gameState.whiteTime,
        blackTime: gameState.blackTime,
      });

      if (gameState.whiteTime <= 0 || gameState.blackTime <= 0) {
        const winner = gameState.side === "white" ? "black" : "white";
        this.onTimeoutCallback?.(EndReason.Timeout, winner);
      }
    }, 1000);
  }

  /**
   * Stops the game clock.
   */
  stop(): void {
    this.clock.stopInterval();
  }
}
