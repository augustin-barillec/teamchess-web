import type { IGameContext } from "../context/GameContext.js";
import { globalContext } from "../context/GlobalContextAdapter.js";
import type { InternalKickVoteState, KickVoteState } from "../types.js";
import { KICK_VOTE_DURATION_MS } from "../constants.js";
import { sendSystemMessage, broadcastPlayers } from "../utils/messaging.js";
import {
  checkKickVotePrerequisites,
  createKickVoteState,
} from "../core/kickVoteLogic.js";
import { MSG } from "../shared_messages.js";

/**
 * Gets kick vote data formatted for a specific client.
 * Personalizes `myVoteEligible` and `amTarget` per viewer.
 */
export function getKickVoteClientData(
  viewerPid: string,
  ctx: IGameContext = globalContext
): KickVoteState {
  const { gameState, sessions } = ctx;
  const vote = gameState.kickVote;

  if (!vote) {
    return {
      isActive: false,
      targetId: null,
      targetName: "",
      initiatorName: "",
      yesVotes: [],
      noVotes: [],
      requiredVotes: 0,
      totalVoters: 0,
      endTime: 0,
      myVoteEligible: false,
      myCurrentVote: null,
      amTarget: false,
    };
  }

  const yesNames = Array.from(vote.yesVoters).map(
    (pid) => sessions.get(pid)?.name || "Unknown"
  );
  const noNames = Array.from(vote.noVoters).map(
    (pid) => sessions.get(pid)?.name || "Unknown"
  );

  const isEligible = vote.eligibleVoters.has(viewerPid);
  const myCurrentVote = vote.yesVoters.has(viewerPid)
    ? ("yes" as const)
    : vote.noVoters.has(viewerPid)
      ? ("no" as const)
      : null;

  return {
    isActive: true,
    targetId: vote.targetId,
    targetName: vote.targetName,
    initiatorName: vote.initiatorName,
    yesVotes: yesNames,
    noVotes: noNames,
    requiredVotes: vote.required,
    totalVoters: vote.total,
    endTime: vote.endTime,
    myVoteEligible: isEligible,
    myCurrentVote,
    amTarget: vote.targetId === viewerPid,
  };
}

/**
 * Broadcasts kick vote state to all connected sockets.
 * Each client gets a personalized view.
 */
export function broadcastKickVote(ctx: IGameContext = globalContext): void {
  for (const socket of ctx.getAllSockets()) {
    const pid = socket.data.pid;
    if (pid) {
      socket.emit("kick_vote_update", getKickVoteClientData(pid, ctx));
    }
  }
}

/**
 * Clears an active kick vote.
 */
export function clearKickVote(ctx: IGameContext = globalContext): void {
  const { gameState } = ctx;
  const vote = gameState.kickVote;
  if (vote) {
    clearTimeout(vote.timer);
    gameState.kickVote = undefined;
    broadcastKickVote(ctx);
  }
}

/**
 * Starts a kick vote against a target player.
 */
export function startKickVoteLogic(
  initiatorId: string,
  initiatorName: string,
  targetId: string,
  targetName: string,
  ctx: IGameContext = globalContext
): { error?: string } {
  const { gameState } = ctx;

  const prereq = checkKickVotePrerequisites(
    gameState.kickVote
      ? {
          targetId: gameState.kickVote.targetId,
          initiatorId: gameState.kickVote.initiatorId,
          yesVoters: gameState.kickVote.yesVoters,
          noVoters: gameState.kickVote.noVoters,
          eligibleVoters: gameState.kickVote.eligibleVoters,
          required: gameState.kickVote.required,
          total: gameState.kickVote.total,
        }
      : undefined,
    initiatorId,
    targetId
  );

  if (!prereq.canStart) {
    return { error: prereq.reason };
  }

  // Snapshot all connected PIDs
  const allConnectedPids = ctx.getOnlinePids();

  const pureState = createKickVoteState(
    targetId,
    initiatorId,
    allConnectedPids
  );
  const endTime = Date.now() + KICK_VOTE_DURATION_MS;

  const voteState: InternalKickVoteState = {
    ...pureState,
    targetName,
    initiatorName,
    endTime,
    timer: setTimeout(() => {
      // Vote expired — failed
      const yesCount = gameState.kickVote?.yesVoters.size ?? 0;
      const noCount = gameState.kickVote?.noVoters.size ?? 0;
      sendSystemMessage(
        MSG.kickVoteExpired(targetName, yesCount, noCount),
        ctx
      );
      gameState.kickVote = undefined;
      broadcastKickVote(ctx);
    }, KICK_VOTE_DURATION_MS),
  };

  gameState.kickVote = voteState;

  sendSystemMessage(MSG.kickVoteStarted(initiatorName, targetName), ctx);
  broadcastKickVote(ctx);

  return {};
}

/**
 * Executes a kick: adds target to blacklist, disconnects them.
 */
export function executeKick(
  targetPid: string,
  targetName: string,
  ctx: IGameContext = globalContext
): void {
  const { gameState, sessions } = ctx;

  // Add to blacklist
  gameState.blacklist.add(targetPid);

  // Find and disconnect the target's socket
  for (const socket of ctx.getAllSockets()) {
    if (socket.data.pid === targetPid) {
      socket.emit("kicked", { message: MSG.youHaveBeenKicked });
      // For real sockets, we need to disconnect them
      if ("disconnect" in socket && typeof socket.disconnect === "function") {
        (socket as unknown as { disconnect: () => void }).disconnect();
      }
    }
  }

  // Clean up session
  const sess = sessions.get(targetPid);
  if (sess) {
    if (sess.side === "white") gameState.whiteIds.delete(targetPid);
    if (sess.side === "black") gameState.blackIds.delete(targetPid);
    if (sess.reconnectTimer) clearTimeout(sess.reconnectTimer);
    sessions.delete(targetPid);
  }

  sendSystemMessage(MSG.playerKicked(targetName), ctx);
  broadcastPlayers(ctx);
}
