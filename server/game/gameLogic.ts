import {
  getGameState,
  getIO,
  getActiveTeamPids,
  resetGameState,
} from "../state.js";
import { GameStatus, EndReason, Proposal, PlayerSide } from "../types.js";
import { reasonMessages, MSG } from "../shared_messages.js";
import { getCleanPgn } from "../utils/pgn.js";
import { broadcastPlayers, sendSystemMessage } from "../utils/messaging.js";
import { clearActiveVote, broadcastVote } from "../voting.js";
import { startClock, stopClock } from "./clock.js";
import { chooseBestMove, createEngine } from "../engine/stockfish.js";
import {
  shouldFinalizeTurn,
  calculateIncrement,
  detectGameOver,
  resolveSelectedMove,
} from "../core/turnLogic.js";
import { shouldEndDueToAbandonment } from "../core/playerLogic.js";
import { DEFAULT_CLOCK_TIME, TEAM_EMPTY_FORFEIT_MS } from "../constants.js";

/**
 * Ends the game with a given reason and optional winner.
 */
export function endGame(reason: EndReason, winner: string | null = null): void {
  const gameState = getGameState();
  const io = getIO();

  if (gameState.status === GameStatus.Over) return;
  // Invalidate any in-flight engine callback (see tryFinalizeTurn)
  gameState.generation++;
  stopClock();

  // A team vote is meaningless once the game is over
  clearActiveVote();
  clearForfeitCountdown();

  gameState.engine.quit();
  gameState.status = GameStatus.Over;
  gameState.endReason = reason;
  gameState.endWinner = winner;

  const message = reasonMessages[reason](winner);
  gameState.endMessage = message;

  sendSystemMessage(message);
  broadcastPlayers();

  gameState.drawOffer = undefined;
  const pgn = getCleanPgn(gameState.chess);
  io.emit("game_over", { reason, winner, pgn, message });
  io.emit("draw_offer_update", { side: null });
}

/**
 * Resets the game in place (same GameState object) with a fresh engine.
 */
export function executeGameReset(): void {
  const gameState = getGameState();
  const io = getIO();

  // The old engine may still be running (reset mid-game): kill it before replacing
  gameState.engine.quit();
  resetGameState(createEngine());

  sendSystemMessage(MSG.gameReset);
  io.emit("game_reset");
  io.emit("clock_update", {
    whiteTime: DEFAULT_CLOCK_TIME,
    blackTime: DEFAULT_CLOCK_TIME,
  });
  broadcastVote();
}

/**
 * Attempts to finalize the current turn if all active players have submitted moves.
 */
export function tryFinalizeTurn(): void {
  const gameState = getGameState();
  const io = getIO();

  const activeTeamPids = getActiveTeamPids(gameState.side);
  if (
    !shouldFinalizeTurn(
      gameState.status,
      activeTeamPids,
      gameState.proposals.keys()
    )
  ) {
    return;
  }

  gameState.status = GameStatus.FinalizingTurn;
  io.emit("game_status_update", { status: gameState.status });

  stopClock();

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

  // A game end or reset during the engine search bumps `generation`: the position
  // this search was started on no longer exists, so its answer must be dropped.
  const generation = gameState.generation;
  const isStale = () =>
    gameState.generation !== generation ||
    gameState.status !== GameStatus.FinalizingTurn;

  chooseBestMove(gameState.engine, currentFen, candidatesStr)
    .then((engineMove) => {
      if (isStale()) return;

      const selected = resolveSelectedMove(engineMove, candidatesStr);

      if (!selected) {
        // Nothing to play: hand the turn back instead of freezing on FinalizingTurn.
        gameState.status = GameStatus.AwaitingProposals;
        io.emit("game_status_update", { status: gameState.status });
        startClock();
        return;
      }

      if (selected.fallback) sendSystemMessage(MSG.engineFallback);

      const selLan = selected.lan;
      const from = selLan.slice(0, 2);
      const to = selLan.slice(2, 4);

      const params: { from: string; to: string; promotion?: string } = {
        from,
        to,
      };
      if (selLan.length === 5) params.promotion = selLan[4];

      const move = gameState.chess.move(params);
      if (!move) {
        console.error(
          `CRITICAL: Illegal move. FEN: ${currentFen}, Move: ${selLan}`
        );
        return;
      }
      const fen = gameState.chess.fen();

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

      const gameOverResult = detectGameOver(gameState.chess, gameState.side);

      if (gameOverResult.isOver) {
        endGame(gameOverResult.reason!, gameOverResult.winner ?? null);
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
        startClock();
      }
    })
    .catch((e) => {
      console.error(
        `CRITICAL: Engine error. FEN: ${currentFen}, Candidates: ${candidatesStr}`,
        e
      );
      if (isStale()) return;
      gameState.status = GameStatus.AwaitingProposals;
      gameState.proposals.clear();
      io.emit("game_status_update", { status: gameState.status });
      sendSystemMessage(MSG.systemError);
    });
}

/**
 * An abandoned team does not lose on the spot: it gets TEAM_EMPTY_FORFEIT_MS,
 * counted down in front of everyone, for the missing player to come back or for
 * anyone else to take the seat. Call after anything that can change who is
 * connected on a side; it arms, refreshes or cancels the countdown accordingly.
 */
export function endIfOneSided(): void {
  const gameState = getGameState();

  if (
    gameState.status === GameStatus.Setup ||
    gameState.status === GameStatus.Over
  ) {
    clearForfeitCountdown();
    return;
  }

  const empty = emptySides();
  if (empty.length === 0) {
    clearForfeitCountdown();
    return;
  }

  // Both empty means the game is heading for a draw rather than a winner
  const side = empty.length === 2 ? null : empty[0];

  // A team emptying while another countdown runs shares its deadline: the clock
  // started when the game first lost a side, and that is the one that matters.
  if (!gameState.forfeitTimer) {
    gameState.forfeitEndTime = Date.now() + TEAM_EMPTY_FORFEIT_MS;
    gameState.forfeitTimer = setTimeout(() => {
      gameState.forfeitTimer = undefined;
      executeForfeit();
    }, TEAM_EMPTY_FORFEIT_MS);
  }

  getIO().emit("forfeit_countdown", {
    side,
    endTime: gameState.forfeitEndTime,
  });
}

/** The countdown ran out. Recomputed from scratch: a side may have filled up since. */
function executeForfeit(): void {
  const result = shouldEndDueToAbandonment(
    getActiveTeamPids("white"),
    getActiveTeamPids("black")
  );

  if (result.shouldEnd) {
    endGame(EndReason.Abandonment, result.winner ?? null);
  } else {
    clearForfeitCountdown();
  }
}

export function clearForfeitCountdown(): void {
  const gameState = getGameState();

  if (gameState.forfeitTimer) {
    clearTimeout(gameState.forfeitTimer);
    gameState.forfeitTimer = undefined;
  }
  if (gameState.forfeitEndTime === 0) return;
  gameState.forfeitEndTime = 0;
  getIO().emit("forfeit_countdown", null);
}

/** Sides with nobody connected. A held seat does not count: it cannot play. */
function emptySides(): PlayerSide[] {
  const sides: PlayerSide[] = [];
  if (getActiveTeamPids("white").size === 0) sides.push("white");
  if (getActiveTeamPids("black").size === 0) sides.push("black");
  return sides;
}
