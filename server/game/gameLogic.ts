import type { IGameContext } from "../context/GameContext.js";
import { globalContext } from "../context/GlobalContextAdapter.js";
import { GameStatus, EndReason, Proposal } from "../types.js";
import { reasonMessages } from "../constants.js";
import { getCleanPgn } from "../utils/pgn.js";
import { broadcastPlayers, sendSystemMessage } from "../utils/messaging.js";
import { clearTeamVote, setEndGameCallback } from "../voting/teamVote.js";
import { startClock, stopClock, setTimeoutCallback } from "./clock.js";
import { chooseBestMove } from "../engine/stockfish.js";
import {
  shouldFinalizeTurn as checkShouldFinalize,
  calculateIncrement,
  detectGameOver,
} from "../core/turnLogic.js";
import { shouldEndDueToAbandonment } from "../core/playerLogic.js";

/**
 * Ends the game with a given reason and optional winner.
 * @param ctx Optional context for dependency injection (defaults to global)
 */
export function endGame(
  reason: string,
  winner: string | null = null,
  ctx: IGameContext = globalContext
): void {
  const { gameState, io } = ctx;

  if (gameState.status === GameStatus.Over) return;
  stopClock(ctx);

  clearTeamVote("white", ctx);
  clearTeamVote("black", ctx);

  gameState.engine.quit();
  gameState.status = GameStatus.Over;
  gameState.endReason = reason;
  gameState.endWinner = winner;

  const message = reasonMessages[reason]
    ? reasonMessages[reason](winner)
    : `🎉 Game over! ${
        winner ? winner.charAt(0).toUpperCase() + winner.slice(1) : ""
      } wins!`;

  sendSystemMessage(message, ctx);
  broadcastPlayers(ctx);

  gameState.drawOffer = undefined;
  const pgn = getCleanPgn(gameState.chess);
  io.emit("game_over", { reason, winner, pgn });
  io.emit("draw_offer_update", { side: null });
}

// Initialize callbacks to avoid circular dependencies
setTimeoutCallback((reason, winner) => endGame(reason, winner));
setEndGameCallback((reason, winner) => endGame(reason, winner));

/**
 * Attempts to finalize the current turn if all active players have submitted moves.
 * @param ctx Optional context for dependency injection (defaults to global)
 */
export function tryFinalizeTurn(ctx: IGameContext = globalContext): void {
  const { gameState, io } = ctx;

  if (gameState.status !== GameStatus.AwaitingProposals) return;

  const activeTeamPids = ctx.getActiveTeamPids(gameState.side);

  // Use pure logic to check if we should finalize
  const shouldFinalize = checkShouldFinalize(
    {
      status: gameState.status,
      side: gameState.side,
      moveNumber: gameState.moveNumber,
      whiteTime: gameState.whiteTime,
      blackTime: gameState.blackTime,
      proposals: gameState.proposals,
    },
    { activeTeamPids }
  );

  if (!shouldFinalize) return;

  gameState.status = GameStatus.FinalizingTurn;
  io.emit("game_status_update", { status: gameState.status });

  stopClock(ctx);

  const allEntries = [...gameState.proposals.entries()];
  const candidatesStr = allEntries.map(([, { lan }]) => lan);
  const candidatesObjs: Proposal[] = allEntries.map(([id, val]) => ({
    id,
    name: val.name,
    moveNumber: gameState.moveNumber,
    side: gameState.side,
    lan: val.lan,
    san: val.san,
  }));

  const currentFen = gameState.chess.fen();

  chooseBestMove(gameState.engine, currentFen, candidatesStr).then((selLan) => {
    try {
      const from = selLan.slice(0, 2);
      const to = selLan.slice(2, 4);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params: any = { from, to };
      if (selLan.length === 5) params.promotion = selLan[4];

      const move = gameState.chess.move(params);
      if (!move) {
        console.error(
          `CRITICAL: Illegal move. FEN: ${currentFen}, Move: ${selLan}`
        );
        return;
      }
      const fen = gameState.chess.fen();

      // Use pure logic for increment calculation
      const currentTime =
        gameState.side === "white" ? gameState.whiteTime : gameState.blackTime;
      const increment = calculateIncrement(currentTime);

      if (gameState.side === "white") gameState.whiteTime += increment;
      else gameState.blackTime += increment;

      io.emit("clock_update", {
        whiteTime: gameState.whiteTime,
        blackTime: gameState.blackTime,
      });

      const winnerEntry = allEntries.find(([, val]) => val.lan === selLan);
      const winnerId = winnerEntry ? winnerEntry[0] : "unknown";
      const winnerName = winnerEntry ? winnerEntry[1].name : "TeamChess";

      io.emit("move_selected", {
        id: winnerId,
        name: winnerName,
        moveNumber: gameState.moveNumber,
        side: gameState.side,
        lan: selLan,
        san: move.san,
        fen,
        candidates: candidatesObjs,
      });

      // Use pure logic to detect game over
      const gameOverResult = detectGameOver(gameState.chess, gameState.side);

      if (gameOverResult.isOver) {
        endGame(gameOverResult.reason!, gameOverResult.winner ?? null, ctx);
      } else {
        gameState.proposals.clear();
        gameState.side = gameState.side === "white" ? "black" : "white";
        gameState.moveNumber++;
        gameState.status = GameStatus.AwaitingProposals;
        io.emit("turn_change", {
          moveNumber: gameState.moveNumber,
          side: gameState.side,
        });
        io.emit("game_status_update", { status: gameState.status });
        io.emit("position_update", { fen });
        startClock(ctx);
      }
    } catch (e) {
      console.error(
        `CRITICAL: Error on move. FEN: ${currentFen}, Move: ${selLan}`,
        e
      );
      gameState.status = GameStatus.AwaitingProposals;
      gameState.proposals.clear();
      io.emit("game_status_update", { status: gameState.status });
      sendSystemMessage(
        "⚠️ System Error: The move could not be processed. The turn has been reset. Please submit your moves again.",
        ctx
      );
    }
  });
}

/**
 * Ends the game if one side has no remaining players.
 * @param ctx Optional context for dependency injection (defaults to global)
 */
export function endIfOneSided(ctx: IGameContext = globalContext): void {
  const { gameState } = ctx;

  if (
    gameState.status === GameStatus.Lobby ||
    gameState.status === GameStatus.Over
  )
    return;

  // Use pure logic to check abandonment
  const result = shouldEndDueToAbandonment(
    gameState.whiteIds,
    gameState.blackIds
  );

  if (result.shouldEnd) {
    endGame(EndReason.Abandonment, result.winner ?? null, ctx);
  }
}
