import { getGameState, getIO } from "../state.js";
import { GameStatus, EndReason } from "../shared_types.js";
import { endGame } from "./gameLogic.js";

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

    // The winner comes from the clock that actually reached zero, not from the
    // side to move. Both agree today, since only the side to move is
    // decremented, but keeping them coupled would announce the wrong winner the
    // day a clock can drain off-turn (increment, reserve time, restored game).
    if (gameState.whiteTime <= 0 || gameState.blackTime <= 0) {
      const winner = gameState.whiteTime <= 0 ? "black" : "white";
      endGame(EndReason.Timeout, winner);
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
