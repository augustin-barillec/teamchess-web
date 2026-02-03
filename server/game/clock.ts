import type { IGameContext } from "../context/GameContext.js";
import { globalContext } from "../context/GlobalContextAdapter.js";
import { GameStatus, EndReason } from "../shared_types.js";

// This callback will be set by gameLogic.ts to avoid circular dependency
let onTimeoutCallback: ((reason: string, winner: string) => void) | null = null;

export function setTimeoutCallback(
  callback: (reason: string, winner: string) => void
): void {
  onTimeoutCallback = callback;
}

/**
 * Starts the game clock.
 * @param ctx Optional context for dependency injection (defaults to global)
 */
export function startClock(ctx: IGameContext = globalContext): void {
  const { gameState, io } = ctx;

  if (gameState.status !== GameStatus.AwaitingProposals) return;
  if (gameState.timerInterval) clearInterval(gameState.timerInterval);

  io.emit("clock_update", {
    whiteTime: gameState.whiteTime,
    blackTime: gameState.blackTime,
  });

  gameState.timerInterval = setInterval(() => {
    if (gameState.side === "white") gameState.whiteTime--;
    else gameState.blackTime--;

    io.emit("clock_update", {
      whiteTime: gameState.whiteTime,
      blackTime: gameState.blackTime,
    });

    if (gameState.whiteTime <= 0 || gameState.blackTime <= 0) {
      const winner = gameState.side === "white" ? "black" : "white";
      if (onTimeoutCallback) {
        onTimeoutCallback(EndReason.Timeout, winner);
      }
    }
  }, 1000);
}

/**
 * Stops the game clock.
 * @param ctx Optional context for dependency injection (defaults to global)
 */
export function stopClock(ctx: IGameContext = globalContext): void {
  const { gameState } = ctx;
  if (gameState.timerInterval) {
    clearInterval(gameState.timerInterval);
    gameState.timerInterval = undefined;
  }
}
