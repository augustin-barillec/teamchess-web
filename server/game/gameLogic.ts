import { getGameState, getIO } from "../state.js";
import { GameStatus, EndReason, Proposal } from "../types.js";
import { reasonMessages } from "../constants.js";
import { getCleanPgn } from "../utils/pgn.js";
import { broadcastPlayers, sendSystemMessage } from "../utils/messaging.js";
import { clearTeamVote, setEndGameCallback } from "../voting/teamVote.js";
import { startClock, stopClock, setTimeoutCallback } from "./clock.js";
import { chooseBestMove } from "../engine/stockfish.js";

export function endGame(reason: string, winner: string | null = null): void {
  const gameState = getGameState();
  const io = getIO();

  if (gameState.status === GameStatus.Over) return;
  stopClock();

  clearTeamVote("white");
  clearTeamVote("black");

  gameState.engine.quit();
  gameState.status = GameStatus.Over;
  gameState.endReason = reason;
  gameState.endWinner = winner;

  const message = reasonMessages[reason]
    ? reasonMessages[reason](winner)
    : `🎉 Game over! ${
        winner ? winner.charAt(0).toUpperCase() + winner.slice(1) : ""
      } wins!`;

  sendSystemMessage(message);
  broadcastPlayers();

  gameState.drawOffer = undefined;
  const pgn = getCleanPgn(gameState.chess);
  io.emit("game_over", { reason, winner, pgn });
  io.emit("draw_offer_update", { side: null });
}

// Initialize callbacks to avoid circular dependencies
setTimeoutCallback(endGame);
setEndGameCallback(endGame);

export function tryFinalizeTurn(): void {
  const gameState = getGameState();
  const io = getIO();

  if (gameState.status !== GameStatus.AwaitingProposals) return;

  const onlinePids = new Set<string>();
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.pid) {
      onlinePids.add(socket.data.pid);
    }
  }

  const sideSet =
    gameState.side === "white" ? gameState.whiteIds : gameState.blackIds;

  const activeConnected = new Set(
    [...sideSet].filter((pid) => onlinePids.has(pid))
  );

  const onlineProposalsCount = [...gameState.proposals.keys()].filter((pid) =>
    activeConnected.has(pid)
  ).length;

  if (
    activeConnected.size > 0 &&
    onlineProposalsCount === activeConnected.size
  ) {
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

    chooseBestMove(gameState.engine, currentFen, candidatesStr).then(
      (selLan) => {
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

          const currentTime =
            gameState.side === "white"
              ? gameState.whiteTime
              : gameState.blackTime;

          const increment = currentTime <= 60 ? 10 : 0;

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

          if (gameState.chess.isGameOver()) {
            let reason: string;
            let winner: "white" | "black" | null = null;
            if (gameState.chess.isCheckmate()) {
              reason = EndReason.Checkmate;
              winner = gameState.side;
            } else if (gameState.chess.isStalemate()) {
              reason = EndReason.Stalemate;
            } else if (gameState.chess.isThreefoldRepetition()) {
              reason = EndReason.Threefold;
            } else if (gameState.chess.isInsufficientMaterial()) {
              reason = EndReason.Insufficient;
            } else {
              reason = EndReason.DrawRule;
            }
            endGame(reason, winner);
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
        } catch (e) {
          console.error(
            `CRITICAL: Error on move. FEN: ${currentFen}, Move: ${selLan}`,
            e
          );
          gameState.status = GameStatus.AwaitingProposals;
          gameState.proposals.clear();
          io.emit("game_status_update", { status: gameState.status });
          sendSystemMessage(
            "⚠️ System Error: The move could not be processed. The turn has been reset. Please submit your moves again."
          );
        }
      }
    );
  }
}

export function endIfOneSided(): void {
  const gameState = getGameState();

  if (
    gameState.status === GameStatus.Lobby ||
    gameState.status === GameStatus.Over
  )
    return;

  const whiteAlive = gameState.whiteIds.size > 0;
  const blackAlive = gameState.blackIds.size > 0;

  if (whiteAlive && blackAlive) return;

  const winner = whiteAlive ? "white" : blackAlive ? "black" : null;
  endGame(EndReason.Abandonment, winner);
}
