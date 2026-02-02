import { getGameState, getIO } from "../state.js";
import { GameStatus, EndReason } from "../types.js";

// This callback will be set by gameLogic.ts to avoid circular dependency
let onTimeoutCallback: ((reason: string, winner: string) => void) | null = null;

export function setTimeoutCallback(
  callback: (reason: string, winner: string) => void
): void {
  onTimeoutCallback = callback;
}

export function startClock(): void {
  const gameState = getGameState();
  const io = getIO();

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

export function stopClock(): void {
  const gameState = getGameState();
  if (gameState.timerInterval) {
    clearInterval(gameState.timerInterval);
    gameState.timerInterval = undefined;
  }
}
