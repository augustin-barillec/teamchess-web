import { VOTE_REASONS } from "../shared_messages.js";
import { processMajorityVote, type MajorityVoteResult } from "./voteLogic.js";

export interface KickVoteState {
  targetId: string;
  initiatorId: string;
  yesVoters: Set<string>;
  noVoters: Set<string>;
  eligibleVoters: Set<string>;
  required: number;
  total: number;
}

export interface KickVotePrerequisiteResult {
  canStart: boolean;
  reason?: string;
}

/**
 * Checks prerequisites for starting a kick vote.
 * Pure function - no side effects.
 */
export function checkKickVotePrerequisites(
  existingKickVote: KickVoteState | undefined,
  initiatorId: string,
  targetId: string
): KickVotePrerequisiteResult {
  if (existingKickVote) {
    return { canStart: false, reason: VOTE_REASONS.kickVoteInProgress };
  }

  if (initiatorId === targetId) {
    return { canStart: false, reason: VOTE_REASONS.cannotKickSelf };
  }

  return { canStart: true };
}

/**
 * Creates a new kick vote state.
 * Pure function - returns new state object.
 *
 * The target is included in total N (contributes to threshold)
 * but excluded from eligible voters (cannot vote).
 * The initiator automatically votes yes.
 */
export function createKickVoteState(
  targetId: string,
  initiatorId: string,
  allConnectedPids: Set<string>
): KickVoteState {
  const N = allConnectedPids.size;
  const required = Math.floor(N / 2) + 1;

  // Eligible = all connected except the target
  const eligibleVoters = new Set(allConnectedPids);
  eligibleVoters.delete(targetId);

  // Initiator automatically votes yes
  const yesVoters = new Set([initiatorId]);

  return {
    targetId,
    initiatorId,
    yesVoters,
    noVoters: new Set(),
    eligibleVoters,
    required,
    total: N,
  };
}

export type KickVoteProcessResult = MajorityVoteResult;

/**
 * Processes a kick vote from a player.
 * Delegates to shared majority vote logic.
 */
export function processKickVote(
  vote: KickVoteState,
  voterId: string,
  voteChoice: "yes" | "no"
): KickVoteProcessResult {
  return processMajorityVote(vote, voterId, voteChoice);
}
