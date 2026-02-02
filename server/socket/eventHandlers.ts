import { Socket } from "socket.io";
import { Chess } from "chess.js";
import { sessions, getGameState, setGameState, getIO } from "../state.js";
import { GameStatus, VoteType, EndReason } from "../types.js";
import {
  broadcastPlayers,
  sendSystemMessage,
  sendTeamMessage,
} from "../utils/messaging.js";
import { tryFinalizeTurn, endIfOneSided, endGame } from "../game/gameLogic.js";
import { startClock } from "../game/clock.js";
import {
  getTeamVoteClientData,
  broadcastTeamVote,
  clearTeamVote,
  startTeamVoteLogic,
} from "../voting/teamVote.js";
import { createEngine } from "../engine/stockfish.js";

export function handleSetName(socket: Socket, name: string): void {
  const pid = socket.data.pid;
  const newName = name.trim().slice(0, 30);
  if (newName) {
    const sess = sessions.get(pid);
    if (sess) {
      sess.name = newName;
      socket.data.name = newName;
      broadcastPlayers();
      socket.emit("session", { id: pid, name: sess.name });
    }
  }
}

export function handleJoinSide(
  socket: Socket,
  side: "white" | "black" | "spectator",
  cb?: (res: { success?: boolean; error?: string }) => void
): void {
  const pid = socket.data.pid;
  const gameState = getGameState();
  const currentSess = sessions.get(pid);
  if (!currentSess) return;

  const prevSide = currentSess.side;
  currentSess.side = side;
  socket.data.side = side;

  if (gameState.status !== GameStatus.Lobby) {
    if (prevSide === "white") gameState.whiteIds.delete(pid);
    else if (prevSide === "black") gameState.blackIds.delete(pid);

    if (side === "white") gameState.whiteIds.add(pid);
    else if (side === "black") gameState.blackIds.add(pid);

    endIfOneSided();
  }

  broadcastPlayers();
  tryFinalizeTurn();

  // UPDATE CLIENT VOTE UI
  if (side === "white" || side === "black") {
    socket.emit("team_vote_update", getTeamVoteClientData(side));
  } else {
    socket.emit("team_vote_update", {
      isActive: false,
      type: null,
      initiatorName: "",
      yesVotes: [],
      requiredVotes: 0,
      endTime: 0,
    });
  }

  cb?.({ success: true });
}

export function handleResetGame(
  socket: Socket,
  cb?: (res: { success?: boolean; error?: string }) => void
): void {
  const gameState = getGameState();
  const io = getIO();

  if (gameState.timerInterval) clearInterval(gameState.timerInterval);
  const engine = createEngine();

  setGameState({
    ...gameState,
    whiteIds: new Set(),
    blackIds: new Set(),
    moveNumber: 1,
    side: "white",
    proposals: new Map(),
    whiteTime: 600,
    blackTime: 600,
    timerInterval: undefined,
    engine,
    chess: new Chess(),
    status: GameStatus.Lobby,
    endReason: undefined,
    endWinner: undefined,
    drawOffer: undefined,
    whiteVote: undefined,
    blackVote: undefined,
  });

  io.emit("game_reset");
  io.emit("clock_update", {
    whiteTime: 600,
    blackTime: 600,
  });
  broadcastTeamVote("white");
  broadcastTeamVote("black");

  sendSystemMessage(`${socket.data.name} has reset the game.`);
  cb?.({ success: true });
}

export function handlePlayMove(
  socket: Socket,
  lan: string,
  cb?: (res: { error?: string }) => void
): void {
  const pid = socket.data.pid;
  const gameState = getGameState();
  const io = getIO();

  if (gameState.status === GameStatus.Lobby) {
    if (socket.data.side !== "white") {
      return cb?.({ error: "Only the White team can start the game." });
    }

    const whites = new Set<string>();
    const blacks = new Set<string>();
    for (const s of sessions.values()) {
      if (s.side === "white") whites.add(s.pid);
      else if (s.side === "black") blacks.add(s.pid);
    }

    if (blacks.size === 0) {
      return cb?.({
        error: "Both teams must have at least one player to start.",
      });
    }

    gameState.status = GameStatus.AwaitingProposals;
    gameState.whiteIds = whites;
    gameState.blackIds = blacks;

    io.emit("game_started", {
      moveNumber: 1,
      side: "white",
      proposals: [],
    });
    io.emit("position_update", { fen: gameState.chess.fen() });
    startClock();
    sendSystemMessage(
      `${socket.data.name} has started the game by playing the first move.`
    );
  } else if (gameState.status !== GameStatus.AwaitingProposals) {
    return cb?.({ error: "Not accepting proposals right now." });
  }

  const active =
    gameState.side === "white" ? gameState.whiteIds : gameState.blackIds;
  if (!active.has(pid)) return cb?.({ error: "Not your turn." });
  if (gameState.proposals.has(pid)) return cb?.({ error: "Already moved." });

  let move;
  try {
    const tempChess = new Chess(gameState.chess.fen());
    move = tempChess.move(lan);
  } catch (_e) {
    return cb?.({ error: "Illegal move format." });
  }

  if (!move) return cb?.({ error: "Illegal move." });

  gameState.proposals.set(pid, {
    lan,
    san: move.san,
    name: socket.data.name,
  });

  io.emit("move_submitted", {
    id: pid,
    name: socket.data.name,
    moveNumber: gameState.moveNumber,
    side: gameState.side,
    lan,
    san: move.san,
  });

  tryFinalizeTurn();
  cb?.({});
}

export function handleChatMessage(socket: Socket, message: string): void {
  const pid = socket.data.pid;
  const io = getIO();

  if (!message.trim()) return;
  io.emit("chat_message", {
    sender: socket.data.name,
    senderId: pid,
    message: message.trim(),
  });
}

export function handleStartTeamVote(socket: Socket, type: VoteType): void {
  const gameState = getGameState();

  if (socket.data.side !== "white" && socket.data.side !== "black") return;
  if (gameState.status !== GameStatus.AwaitingProposals) return;

  startTeamVoteLogic(socket.data.side, type, socket.data.pid, socket.data.name);
}

export function handleVoteTeam(socket: Socket, vote: "yes" | "no"): void {
  const pid = socket.data.pid;
  const side = socket.data.side;
  const gameState = getGameState();
  const io = getIO();

  if (side !== "white" && side !== "black") return;

  const currentVote =
    side === "white" ? gameState.whiteVote : gameState.blackVote;
  if (!currentVote) return;

  // CHECK ELIGIBILITY
  if (!currentVote.eligibleVoters.has(pid)) {
    socket.emit("error", { message: "You cannot vote (joined late)." });
    return;
  }

  if (vote === "no") {
    clearTeamVote(side);
    sendTeamMessage(
      side,
      `❌ Vote to ${currentVote.type.replace(
        "_",
        " "
      )} failed: ${socket.data.name} voted No.`
    );

    // Explicitly reject draw if it was an accept_draw vote
    if (currentVote.type === "accept_draw") {
      gameState.drawOffer = undefined;
      io.emit("draw_offer_update", { side: null });
      sendSystemMessage(`${socket.data.name} rejected the draw offer.`);
    }
  } else {
    if (!currentVote.yesVoters.has(pid)) {
      currentVote.yesVoters.add(pid);

      if (currentVote.yesVoters.size >= currentVote.required) {
        clearTeamVote(side);
        sendTeamMessage(
          side,
          `✅ Vote passed! Executing ${currentVote.type.replace("_", " ")}.`
        );

        if (currentVote.type === "resign") {
          const winner = side === "white" ? "black" : "white";
          sendSystemMessage(`${side} team resigns.`);
          endGame(EndReason.Resignation, winner);
        } else if (currentVote.type === "offer_draw") {
          gameState.drawOffer = side;
          io.emit("draw_offer_update", { side });
          sendSystemMessage(`${side} team offers a draw.`);

          // Trigger vote for other side
          const otherSide = side === "white" ? "black" : "white";
          startTeamVoteLogic(otherSide, "accept_draw", "system", "System");
        } else if (currentVote.type === "accept_draw") {
          sendSystemMessage(`${side} team accepts the draw.`);
          endGame(EndReason.DrawAgreement, null);
        }
      } else {
        broadcastTeamVote(side);
      }
    }
  }
}
