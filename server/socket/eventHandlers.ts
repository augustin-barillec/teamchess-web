import { Socket } from "socket.io";
import { Chess } from "chess.js";
import type { IGameContext } from "../context/GameContext.js";
import { globalContext } from "../context/GlobalContextAdapter.js";
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
import { processVote } from "../core/voteLogic.js";
import { processKickVote } from "../core/kickVoteLogic.js";
import { processResetVote } from "../core/resetVoteLogic.js";
import {
  startKickVoteLogic,
  clearKickVote,
  broadcastKickVote,
  executeKick,
} from "../voting/kickVote.js";
import {
  startResetVoteLogic,
  clearResetVote,
  broadcastResetVote,
} from "../voting/resetVote.js";
import { DEFAULT_TIME } from "../constants.js";
import { MSG, VOTE_REASONS } from "../shared_messages.js";

export function handleSetName(
  socket: Socket,
  name: string,
  ctx: IGameContext = globalContext
): void {
  const pid = socket.data.pid;
  const newName = name.trim().slice(0, 30);
  if (newName) {
    const sess = ctx.sessions.get(pid);
    if (sess) {
      sess.name = newName;
      socket.data.name = newName;
      broadcastPlayers(ctx);
      socket.emit("session", { id: pid, name: sess.name });
    }
  }
}

export function handleJoinSide(
  socket: Socket,
  side: "white" | "black" | "spectator",
  cb?: (res: { success?: boolean; error?: string }) => void,
  ctx: IGameContext = globalContext
): void {
  const pid = socket.data.pid;
  const { gameState, sessions } = ctx;
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

    endIfOneSided(ctx);
  }

  broadcastPlayers(ctx);
  tryFinalizeTurn(ctx);

  // UPDATE CLIENT VOTE UI
  if (side === "white" || side === "black") {
    socket.emit("team_vote_update", getTeamVoteClientData(side, ctx));
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
  cb?: (res: { success?: boolean; error?: string }) => void,
  ctx: IGameContext = globalContext
): void {
  const result = startResetVoteLogic(socket.data.pid, socket.data.name, ctx);

  if (result.error) {
    return cb?.({ error: result.error });
  }

  if (result.passedImmediately) {
    sendSystemMessage(MSG.playerResetGame(socket.data.name), ctx);
    executeGameReset(ctx);
  }

  cb?.({ success: true });
}

export function executeGameReset(ctx: IGameContext = globalContext): void {
  const { gameState, io } = ctx;

  if (gameState.timerInterval) clearInterval(gameState.timerInterval);
  const engine = createEngine();

  ctx.resetGame(engine);

  io.emit("game_reset");
  io.emit("clock_update", {
    whiteTime: DEFAULT_TIME,
    blackTime: DEFAULT_TIME,
  });
  broadcastTeamVote("white", ctx);
  broadcastTeamVote("black", ctx);
  broadcastKickVote(ctx);
  broadcastResetVote(ctx);
}

export function handleVoteReset(
  socket: Socket,
  vote: "yes" | "no",
  ctx: IGameContext = globalContext
): void {
  const pid = socket.data.pid;
  const { gameState } = ctx;

  const currentVote = gameState.resetVote;
  if (!currentVote) return;

  const voteResult = processResetVote(
    {
      initiatorId: currentVote.initiatorId,
      yesVoters: currentVote.yesVoters,
      noVoters: currentVote.noVoters,
      eligibleVoters: currentVote.eligibleVoters,
      required: currentVote.required,
      total: currentVote.total,
    },
    pid,
    vote
  );

  if (voteResult.reason === VOTE_REASONS.notEligibleToVote) {
    socket.emit("error", { message: MSG.errorNotEligible });
    return;
  }

  if (voteResult.reason) return;

  if (voteResult.updatedYesVoters)
    currentVote.yesVoters = voteResult.updatedYesVoters;
  if (voteResult.updatedNoVoters)
    currentVote.noVoters = voteResult.updatedNoVoters;

  if (voteResult.passed) {
    clearResetVote(ctx);
    sendSystemMessage(MSG.resetVotePassed, ctx);
    executeGameReset(ctx);
  } else if (voteResult.failed) {
    clearResetVote(ctx);
    sendSystemMessage(MSG.resetVoteFailed(socket.data.name), ctx);
  } else {
    broadcastResetVote(ctx);
  }
}

export function handlePlayMove(
  socket: Socket,
  lan: string,
  cb?: (res: { error?: string }) => void,
  ctx: IGameContext = globalContext
): void {
  const pid = socket.data.pid;
  const { gameState, io, sessions } = ctx;

  if (gameState.status === GameStatus.Lobby) {
    if (socket.data.side !== "white") {
      return cb?.({ error: MSG.errorOnlyWhiteStart });
    }

    const whites = new Set<string>();
    const blacks = new Set<string>();
    for (const s of sessions.values()) {
      if (s.side === "white") whites.add(s.pid);
      else if (s.side === "black") blacks.add(s.pid);
    }

    if (blacks.size === 0) {
      return cb?.({ error: MSG.errorBothTeamsRequired });
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
    startClock(ctx);
    sendSystemMessage(MSG.gameStarted(socket.data.name), ctx);
  } else if (gameState.status !== GameStatus.AwaitingProposals) {
    return cb?.({ error: MSG.errorNotAccepting });
  }

  const active =
    gameState.side === "white" ? gameState.whiteIds : gameState.blackIds;
  if (!active.has(pid)) return cb?.({ error: MSG.errorNotYourTurn });
  if (gameState.proposals.has(pid))
    return cb?.({ error: MSG.errorAlreadyMoved });

  let move;
  try {
    const tempChess = new Chess(gameState.chess.fen());
    move = tempChess.move(lan);
  } catch (_e) {
    return cb?.({ error: MSG.errorIllegalFormat });
  }

  if (!move) return cb?.({ error: MSG.errorIllegalMove });

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

  tryFinalizeTurn(ctx);
  cb?.({});
}

export function handleChatMessage(
  socket: Socket,
  message: string,
  ctx: IGameContext = globalContext
): void {
  const pid = socket.data.pid;

  if (!message.trim()) return;
  ctx.io.emit("chat_message", {
    sender: socket.data.name,
    senderId: pid,
    message: message.trim(),
  });
}

export function handleStartTeamVote(
  socket: Socket,
  type: VoteType,
  ctx: IGameContext = globalContext
): void {
  const { gameState } = ctx;

  if (socket.data.side !== "white" && socket.data.side !== "black") return;
  if (gameState.status !== GameStatus.AwaitingProposals) return;

  startTeamVoteLogic(
    socket.data.side,
    type,
    socket.data.pid,
    socket.data.name,
    ctx
  );
}

export function handleVoteTeam(
  socket: Socket,
  vote: "yes" | "no",
  ctx: IGameContext = globalContext
): void {
  const pid = socket.data.pid;
  const side = socket.data.side;
  const { gameState, io } = ctx;

  if (side !== "white" && side !== "black") return;

  const currentVote =
    side === "white" ? gameState.whiteVote : gameState.blackVote;
  if (!currentVote) return;

  // Use pure logic to process vote
  const voteResult = processVote(
    {
      type: currentVote.type,
      initiatorId: currentVote.initiatorId,
      yesVoters: currentVote.yesVoters,
      eligibleVoters: currentVote.eligibleVoters,
      required: currentVote.required,
    },
    pid,
    vote
  );

  if (voteResult.reason === VOTE_REASONS.notEligibleToVote) {
    socket.emit("error", { message: MSG.errorJoinedLate });
    return;
  }

  if (voteResult.failed) {
    clearTeamVote(side, ctx);
    sendTeamMessage(
      side,
      MSG.teamVoteFailed(currentVote.type, socket.data.name),
      ctx
    );

    // Explicitly reject draw if it was an accept_draw vote
    if (currentVote.type === "accept_draw") {
      gameState.drawOffer = undefined;
      io.emit("draw_offer_update", { side: null });
      sendSystemMessage(MSG.playerRejectedDraw(socket.data.name), ctx);
    }
  } else if (voteResult.updatedYesVoters) {
    // Update the yes voters
    currentVote.yesVoters = voteResult.updatedYesVoters;

    if (voteResult.passed) {
      clearTeamVote(side, ctx);
      sendTeamMessage(side, MSG.teamVotePassed(currentVote.type), ctx);

      if (currentVote.type === "resign") {
        const winner = side === "white" ? "black" : "white";
        sendSystemMessage(MSG.teamResigns(side), ctx);
        endGame(EndReason.Resignation, winner, ctx);
      } else if (currentVote.type === "offer_draw") {
        gameState.drawOffer = side;
        io.emit("draw_offer_update", { side });
        sendSystemMessage(MSG.teamOffersDraw(side), ctx);

        // Trigger vote for other side
        const otherSide = side === "white" ? "black" : "white";
        startTeamVoteLogic(otherSide, "accept_draw", "system", "System", ctx);
      } else if (currentVote.type === "accept_draw") {
        sendSystemMessage(MSG.teamAcceptsDraw(side), ctx);
        endGame(EndReason.DrawAgreement, null, ctx);
      }
    } else {
      broadcastTeamVote(side, ctx);
    }
  }
}

export function handleStartKickVote(
  socket: Socket,
  targetId: string,
  ctx: IGameContext = globalContext
): void {
  const { sessions } = ctx;
  const initiatorPid = socket.data.pid;

  // Validate target exists
  const targetSess = sessions.get(targetId);
  if (!targetSess) {
    socket.emit("error", { message: MSG.errorTargetNotFound });
    return;
  }

  const result = startKickVoteLogic(
    initiatorPid,
    socket.data.name,
    targetId,
    targetSess.name,
    ctx
  );

  if (result.error) {
    socket.emit("error", { message: result.error });
  }
}

export function handleKickVote(
  socket: Socket,
  vote: "yes" | "no",
  ctx: IGameContext = globalContext
): void {
  const pid = socket.data.pid;
  const { gameState } = ctx;

  const currentVote = gameState.kickVote;
  if (!currentVote) return;

  const voteResult = processKickVote(
    {
      targetId: currentVote.targetId,
      initiatorId: currentVote.initiatorId,
      yesVoters: currentVote.yesVoters,
      noVoters: currentVote.noVoters,
      eligibleVoters: currentVote.eligibleVoters,
      required: currentVote.required,
      total: currentVote.total,
    },
    pid,
    vote
  );

  if (voteResult.reason === VOTE_REASONS.notEligibleToVote) {
    socket.emit("error", { message: MSG.errorNotEligible });
    return;
  }

  // "Already voted yes" / "Already voted no" — silently ignore (no-op)
  if (voteResult.reason) return;

  // Update internal state
  if (voteResult.updatedYesVoters)
    currentVote.yesVoters = voteResult.updatedYesVoters;
  if (voteResult.updatedNoVoters)
    currentVote.noVoters = voteResult.updatedNoVoters;

  if (voteResult.passed) {
    const targetName = currentVote.targetName;
    const targetPid = currentVote.targetId;
    clearKickVote(ctx);
    sendSystemMessage(MSG.kickVotePassed(targetName), ctx);
    executeKick(targetPid, targetName, ctx);
  } else if (voteResult.failed) {
    const targetName = currentVote.targetName;
    const yesCount = currentVote.yesVoters.size;
    const noCount = currentVote.noVoters.size;
    clearKickVote(ctx);
    sendSystemMessage(MSG.kickVoteFailed(targetName, yesCount, noCount), ctx);
  } else {
    broadcastKickVote(ctx);
  }
}
