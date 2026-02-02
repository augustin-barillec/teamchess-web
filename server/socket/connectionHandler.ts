import { Socket } from "socket.io";
import { nanoid } from "nanoid";
import { sessions, getGameState, getIO } from "../state.js";
import { GameStatus, VoteType } from "../types.js";
import { getCleanPgn } from "../utils/pgn.js";
import { broadcastPlayers } from "../utils/messaging.js";
import { tryFinalizeTurn } from "../game/gameLogic.js";
import { getTeamVoteClientData } from "../voting/teamVote.js";
import { leave } from "../players/playerManager.js";
import {
  handleSetName,
  handleJoinSide,
  handleResetGame,
  handlePlayMove,
  handleChatMessage,
  handleStartTeamVote,
  handleVoteTeam,
} from "./eventHandlers.js";

export function setupConnectionHandler(): void {
  const io = getIO();

  io.on("connection", (socket: Socket) => {
    const gameState = getGameState();
    const { pid: providedPid, name: providedName } =
      (socket.handshake.auth as { pid?: string; name?: string }) || {};

    const pid =
      providedPid && sessions.has(providedPid) ? providedPid : nanoid();
    let sess = sessions.get(pid);

    if (!sess) {
      sess = { pid, name: providedName || "Player", side: "spectator" };
      sessions.set(pid, sess);
    } else {
      if (sess.reconnectTimer) {
        clearTimeout(sess.reconnectTimer);
        sess.reconnectTimer = undefined;
      }

      if (providedName) sess.name = providedName;
    }

    socket.data.pid = pid;
    socket.data.name = sess.name;
    socket.data.side = sess.side;

    socket.emit("session", { id: pid, name: sess.name });
    socket.emit("game_status_update", { status: gameState.status });

    socket.emit("clock_update", {
      whiteTime: gameState.whiteTime,
      blackTime: gameState.blackTime,
    });

    if (gameState.status !== GameStatus.Lobby) {
      const currentProposals = Array.from(gameState.proposals.entries()).map(
        ([pid, proposal]) => ({
          id: pid,
          name: proposal.name,
          moveNumber: gameState.moveNumber,
          side: gameState.side,
          lan: proposal.lan,
          san: proposal.san,
        })
      );

      socket.emit("game_started", {
        moveNumber: gameState.moveNumber,
        side: gameState.side,
        proposals: currentProposals,
      });
      socket.emit("position_update", { fen: gameState.chess.fen() });
      socket.emit("clock_update", {
        whiteTime: gameState.whiteTime,
        blackTime: gameState.blackTime,
      });

      if (gameState.drawOffer) {
        socket.emit("draw_offer_update", { side: gameState.drawOffer });
      }
      if (gameState.status === GameStatus.Over) {
        socket.emit("game_over", {
          reason: gameState.endReason,
          winner: gameState.endWinner,
          pgn: getCleanPgn(gameState.chess),
        });
      }
    }

    if (socket.data.side === "white" || socket.data.side === "black") {
      socket.emit("team_vote_update", getTeamVoteClientData(socket.data.side));
    }

    broadcastPlayers();
    tryFinalizeTurn();

    // Event handlers
    socket.on("set_name", (name: string) => handleSetName(socket, name));

    socket.on("join_side", ({ side }, cb) => handleJoinSide(socket, side, cb));

    socket.on("reset_game", (cb) => handleResetGame(socket, cb));

    socket.on("play_move", (lan: string, cb) =>
      handlePlayMove(socket, lan, cb)
    );

    socket.on("chat_message", (message: string) =>
      handleChatMessage(socket, message)
    );

    socket.on("start_team_vote", (type: VoteType) =>
      handleStartTeamVote(socket, type)
    );

    socket.on("vote_team", (vote: "yes" | "no") =>
      handleVoteTeam(socket, vote)
    );

    socket.on("disconnect", () => leave(socket));
  });
}
