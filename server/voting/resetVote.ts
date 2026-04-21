import type { IGameContext } from "../context/GameContext.js";
import { globalContext } from "../context/GlobalContextAdapter.js";
import type { InternalResetVoteState, ResetVoteState } from "../types.js";
import { RESET_VOTE_DURATION_MS } from "../constants.js";
import { sendSystemMessage } from "../utils/messaging.js";
import {
  checkResetVotePrerequisites,
  createResetVoteState,
} from "../core/resetVoteLogic.js";
import { MSG } from "../shared_messages.js";
import { voterNames, currentVoteOf } from "./voteHelpers.js";

/**
 * Gets reset vote data formatted for a specific client.
 * Personalizes `myVoteEligible` and `myCurrentVote` per viewer.
 */
export function getResetVoteClientData(
  viewerPid: string,
  ctx: IGameContext = globalContext
): ResetVoteState {
  const { gameState, sessions } = ctx;
  const vote = gameState.resetVote;

  if (!vote) {
    return {
      isActive: false,
      initiatorName: "",
      yesVotes: [],
      noVotes: [],
      requiredVotes: 0,
      totalVoters: 0,
      endTime: 0,
      myVoteEligible: false,
      myCurrentVote: null,
    };
  }

  return {
    isActive: true,
    initiatorName: vote.initiatorName,
    yesVotes: voterNames(vote.yesVoters, sessions),
    noVotes: voterNames(vote.noVoters, sessions),
    requiredVotes: vote.required,
    totalVoters: vote.total,
    endTime: vote.endTime,
    myVoteEligible: vote.eligibleVoters.has(viewerPid),
    myCurrentVote: currentVoteOf(viewerPid, vote.yesVoters, vote.noVoters),
  };
}

/**
 * Broadcasts reset vote state to all connected sockets.
 * Each client gets a personalized view.
 */
export function broadcastResetVote(ctx: IGameContext = globalContext): void {
  for (const socket of ctx.getAllSockets()) {
    const pid = socket.data.pid;
    if (pid) {
      socket.emit("reset_vote_update", getResetVoteClientData(pid, ctx));
    }
  }
}

/**
 * Clears an active reset vote.
 */
export function clearResetVote(ctx: IGameContext = globalContext): void {
  const { gameState } = ctx;
  const vote = gameState.resetVote;
  if (vote) {
    clearTimeout(vote.timer);
    gameState.resetVote = undefined;
    broadcastResetVote(ctx);
  }
}

/**
 * Starts a reset vote.
 * Returns { passedImmediately: true } when solo player (1/1 majority).
 */
export function startResetVoteLogic(
  initiatorId: string,
  initiatorName: string,
  ctx: IGameContext = globalContext
): { error?: string; passedImmediately?: boolean } {
  const { gameState } = ctx;

  const prereq = checkResetVotePrerequisites(
    gameState.resetVote
      ? {
          initiatorId: gameState.resetVote.initiatorId,
          yesVoters: gameState.resetVote.yesVoters,
          noVoters: gameState.resetVote.noVoters,
          eligibleVoters: gameState.resetVote.eligibleVoters,
          required: gameState.resetVote.required,
          total: gameState.resetVote.total,
        }
      : undefined
  );

  if (!prereq.canStart) {
    return { error: prereq.reason };
  }

  const allConnectedPids = ctx.getOnlinePids();
  const pureState = createResetVoteState(initiatorId, allConnectedPids);

  // Solo player: 1/1 = majority, pass immediately
  if (pureState.yesVoters.size >= pureState.required) {
    return { passedImmediately: true };
  }

  const endTime = Date.now() + RESET_VOTE_DURATION_MS;

  const voteState: InternalResetVoteState = {
    ...pureState,
    initiatorName,
    endTime,
    timer: setTimeout(() => {
      sendSystemMessage(MSG.resetVoteFailed, ctx);
      gameState.resetVote = undefined;
      broadcastResetVote(ctx);
    }, RESET_VOTE_DURATION_MS),
  };

  gameState.resetVote = voteState;
  broadcastResetVote(ctx);

  return {};
}
