import { Socket } from "socket.io";
import { nanoid } from "nanoid";
import { sessions, getGameState, getIO } from "../state.js";
import { GameStatus, VoteType } from "../types.js";
import { getCleanPgn } from "../utils/pgn.js";
import {
  broadcastPlayers,
  sendPrivateSystemMessage,
} from "../utils/messaging.js";
import { MSG, DEFAULT_PLAYER_NAME } from "../shared_messages.js";
import { endIfOneSided, tryFinalizeTurn } from "../game/gameLogic.js";
import { getVoteClientData } from "../voting.js";
import { leave } from "../players/playerManager.js";
import {
  handleSetName,
  handleJoinSide,
  handleResetGame,
  handlePlayMove,
  handleChatMessage,
  handleStartTeamVote,
  handleKickPlayer,
  handleCastVote,
} from "./eventHandlers.js";

export function setupConnectionHandler(): void {
  getIO().on("connection", (socket: Socket) => {
    const gameState = getGameState();
    const { pid: providedPid, name: providedName } =
      (socket.handshake.auth as { pid?: string; name?: string }) || {};

    // A kick outlives the socket it was served on: the blacklist is what keeps
    // the kicked player out when they come back with the same pid.
    if (providedPid && gameState.blacklist.has(providedPid)) {
      socket.emit("kicked", { message: MSG.youHaveBeenKicked });
      socket.disconnect(true);
      return;
    }

    const isNewPlayer = !(providedPid && sessions.has(providedPid));
    const pid =
      providedPid && sessions.has(providedPid) ? providedPid : nanoid();
    let sess = sessions.get(pid);

    if (!sess) {
      sess = {
        pid,
        name: providedName || DEFAULT_PLAYER_NAME,
        side: "spectator",
      };
      sessions.set(pid, sess);
    } else {
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

    if (gameState.status !== GameStatus.Setup) {
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
          message: gameState.endMessage,
        });
      }
    }

    // Everyone sees the banner; a late joiner is outside the frozen electorate,
    // so it reaches them with myVoteEligible: false.
    socket.emit("vote_update", getVoteClientData(pid));

    if (isNewPlayer) {
      sendPrivateSystemMessage(socket, MSG.welcomeMessage);
    }

    broadcastPlayers();
    tryFinalizeTurn();
    // A connection changes who is on a side, so the countdown is reconsidered
    // here like anywhere else: without this the seat refilled while the timer it
    // was meant to stop kept running to the forfeit. It also re-emits a countdown
    // that is still legitimately running, which is how an arriving client learns
    // about one that started before it connected.
    endIfOneSided();

    socket.on("set_name", (name: string) => handleSetName(socket, name));

    socket.on("join_side", ({ side }) => handleJoinSide(socket, side));

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

    socket.on("kick_player", (targetId: string) =>
      handleKickPlayer(socket, targetId)
    );

    socket.on("cast_vote", (vote: "yes" | "no") =>
      handleCastVote(socket, vote)
    );

    socket.on("disconnect", () => leave(socket));
  });
}
