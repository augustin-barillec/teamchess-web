import type { IGameContext } from "../context/GameContext.js";
import { globalContext } from "../context/GlobalContextAdapter.js";
import type { InternalVoteState, VoteType, PlayerSide } from "../types.js";
import { EndReason } from "../shared_types.js";
import { TEAM_VOTE_DURATION_MS } from "../constants.js";
import { sendSystemMessage, sendTeamMessage } from "../utils/messaging.js";
import {
  checkVotePrerequisites,
  createVoteState,
  formatVoteType,
} from "../core/voteLogic.js";

// Callback for ending the game (set by gameLogic to avoid circular dependency)
let endGameCallback: ((reason: string, winner: string | null) => void) | null =
  null;

export function setEndGameCallback(
  callback: (reason: string, winner: string | null) => void
): void {
  endGameCallback = callback;
}

/**
 * Gets vote data formatted for client display.
 * @param ctx Optional context for dependency injection (defaults to global)
 */
export function getTeamVoteClientData(
  side: PlayerSide,
  ctx: IGameContext = globalContext
) {
  const { gameState, sessions } = ctx;
  const vote = side === "white" ? gameState.whiteVote : gameState.blackVote;
  if (!vote) {
    return {
      isActive: false,
      type: null,
      initiatorName: "",
      yesVotes: [],
      requiredVotes: 0,
      endTime: 0,
    };
  }

  const yesNames = Array.from(vote.yesVoters).map(
    (pid) => sessions.get(pid)?.name || "Unknown"
  );

  return {
    isActive: true,
    type: vote.type,
    initiatorName: sessions.get(vote.initiatorId)?.name || "Unknown",
    yesVotes: yesNames,
    requiredVotes: vote.required,
    endTime: vote.endTime,
  };
}

/**
 * Broadcasts vote state to all team members.
 * @param ctx Optional context for dependency injection (defaults to global)
 */
export function broadcastTeamVote(
  side: PlayerSide,
  ctx: IGameContext = globalContext
): void {
  const data = getTeamVoteClientData(side, ctx);
  for (const socket of ctx.getSocketsBySide(side)) {
    socket.emit("team_vote_update", data);
  }
}

/**
 * Clears an active team vote.
 * @param ctx Optional context for dependency injection (defaults to global)
 */
export function clearTeamVote(
  side: PlayerSide,
  ctx: IGameContext = globalContext
): void {
  const { gameState } = ctx;
  const vote = side === "white" ? gameState.whiteVote : gameState.blackVote;
  if (vote) {
    clearTimeout(vote.timer);
    if (side === "white") gameState.whiteVote = undefined;
    else gameState.blackVote = undefined;
    broadcastTeamVote(side, ctx);
  }
}

/**
 * Starts or auto-executes a team vote.
 * @param ctx Optional context for dependency injection (defaults to global)
 */
export function startTeamVoteLogic(
  side: PlayerSide,
  type: VoteType,
  initiatorId: string,
  initiatorName: string,
  ctx: IGameContext = globalContext
): void {
  const { gameState, io } = ctx;

  const currentVote =
    side === "white" ? gameState.whiteVote : gameState.blackVote;
  const isSystemTriggered = initiatorId === "system";

  // Get connected team members
  const connectedTeamPids = ctx.getActiveTeamPids(side);
  const N = connectedTeamPids.size;

  // Use pure logic to check prerequisites
  const prereqResult = checkVotePrerequisites(
    type,
    N,
    isSystemTriggered,
    currentVote
      ? {
          type: currentVote.type,
          initiatorId: currentVote.initiatorId,
          yesVoters: currentVote.yesVoters,
          eligibleVoters: currentVote.eligibleVoters,
          required: currentVote.required,
        }
      : undefined,
    gameState.drawOffer,
    side
  );

  if (!prereqResult.canStartVote && !prereqResult.shouldAutoExecute) {
    return;
  }

  // AUTO-EXECUTE for single player
  if (prereqResult.shouldAutoExecute) {
    if (type === "resign") {
      const winner = side === "white" ? "black" : "white";
      sendSystemMessage(`${initiatorName} resigns.`, ctx);
      if (endGameCallback) endGameCallback(EndReason.Resignation, winner);
    } else if (type === "offer_draw") {
      gameState.drawOffer = side;
      io.emit("draw_offer_update", { side });
      sendSystemMessage(`${initiatorName} offers a draw.`, ctx);

      // Trigger vote for other side
      const otherSide = side === "white" ? "black" : "white";
      startTeamVoteLogic(otherSide, "accept_draw", "system", "System", ctx);
    } else if (type === "accept_draw") {
      sendSystemMessage(`${initiatorName} accepts the draw.`, ctx);
      if (endGameCallback) endGameCallback(EndReason.DrawAgreement, null);
    }
    return;
  }

  // START VOTE using pure logic
  const endTime = Date.now() + TEAM_VOTE_DURATION_MS;
  const pureVoteState = createVoteState(
    type,
    initiatorId,
    connectedTeamPids,
    isSystemTriggered
  );

  const voteState: InternalVoteState = {
    ...pureVoteState,
    endTime,
    timer: setTimeout(() => {
      sendTeamMessage(
        side,
        `❌ Vote to ${formatVoteType(type)} failed: Time expired.`,
        ctx
      );
      if (side === "white") gameState.whiteVote = undefined;
      else gameState.blackVote = undefined;
      broadcastTeamVote(side, ctx);

      // If accept_draw fails by timeout, reject the offer
      if (type === "accept_draw") {
        gameState.drawOffer = undefined;
        io.emit("draw_offer_update", { side: null });
        sendSystemMessage("Draw offer rejected (timeout).", ctx);
      }
    }, TEAM_VOTE_DURATION_MS),
  };

  if (side === "white") gameState.whiteVote = voteState;
  else gameState.blackVote = voteState;

  if (isSystemTriggered) {
    sendTeamMessage(side, `🗳️ Draw offered! Vote to accept draw.`, ctx);
  } else {
    sendTeamMessage(
      side,
      `🗳️ ${initiatorName} started a vote to ${formatVoteType(type)}.`,
      ctx
    );
  }
  broadcastTeamVote(side, ctx);
}
