import type { VoteType } from "../shared_types.js";
import type { PlayerSide } from "../types.js";
import { VOTE_REASONS } from "../shared_messages.js";

export interface VoteState {
  type: VoteType;
  initiatorId: string;
  yesVoters: Set<string>;
  eligibleVoters: Set<string>;
  required: number;
}

export interface VotePrerequisiteResult {
  canStartVote: boolean;
  shouldAutoExecute: boolean;
  reason?: string;
}

/**
 * Checks prerequisites for starting a vote.
 * Pure function - no side effects.
 */
export function checkVotePrerequisites(
  type: VoteType,
  connectedTeamCount: number,
  isSystemTriggered: boolean,
  existingVote: VoteState | undefined,
  drawOffer: PlayerSide | undefined,
  votingSide: PlayerSide
): VotePrerequisiteResult {
  // Can't accept draw if no valid offer
  if (type === "accept_draw" && (!drawOffer || drawOffer === votingSide)) {
    return {
      shouldAutoExecute: false,
      canStartVote: false,
      reason: VOTE_REASONS.noValidDrawOffer,
    };
  }

  // Can't offer draw if already offered
  if (type === "offer_draw" && drawOffer) {
    return {
      shouldAutoExecute: false,
      canStartVote: false,
      reason: VOTE_REASONS.drawAlreadyOffered,
    };
  }

  // Can't start vote if one is in progress
  if (existingVote) {
    return {
      shouldAutoExecute: false,
      canStartVote: false,
      reason: VOTE_REASONS.voteAlreadyInProgress,
    };
  }

  // Auto-execute for single player (or no players) when not system triggered
  if (connectedTeamCount <= 1 && !isSystemTriggered) {
    return { shouldAutoExecute: true, canStartVote: false };
  }

  return { shouldAutoExecute: false, canStartVote: true };
}

export interface VoteProcessResult {
  passed: boolean;
  failed: boolean;
  reason?: string;
  updatedYesVoters?: Set<string>;
}

/**
 * Processes a vote from a player.
 * Pure function - returns result without modifying input.
 */
export function processVote(
  vote: VoteState,
  voterId: string,
  voteChoice: "yes" | "no"
): VoteProcessResult {
  // Check eligibility
  if (!vote.eligibleVoters.has(voterId)) {
    return {
      passed: false,
      failed: false,
      reason: VOTE_REASONS.notEligibleToVote,
    };
  }

  // No vote = rejection
  if (voteChoice === "no") {
    return { passed: false, failed: true, reason: VOTE_REASONS.voteRejected };
  }

  // Yes vote - create new set with voter added
  const newYesVoters = new Set(vote.yesVoters);
  newYesVoters.add(voterId);

  // Check if passed
  if (newYesVoters.size >= vote.required) {
    return { passed: true, failed: false, updatedYesVoters: newYesVoters };
  }

  // Vote recorded but not yet passed
  return { passed: false, failed: false, updatedYesVoters: newYesVoters };
}

export interface MajorityVoteInput {
  yesVoters: Set<string>;
  noVoters: Set<string>;
  eligibleVoters: Set<string>;
  required: number;
}

export interface MajorityVoteResult {
  passed: boolean;
  failed: boolean;
  reason?: string;
  updatedYesVoters?: Set<string>;
  updatedNoVoters?: Set<string>;
}

/**
 * Processes a majority vote with yes/no switching.
 * Used by kick votes and reset votes.
 * Pure function - returns result without modifying input.
 */
export function processMajorityVote(
  vote: MajorityVoteInput,
  voterId: string,
  voteChoice: "yes" | "no"
): MajorityVoteResult {
  if (!vote.eligibleVoters.has(voterId)) {
    return {
      passed: false,
      failed: false,
      reason: VOTE_REASONS.notEligibleToVote,
    };
  }

  const newYesVoters = new Set(vote.yesVoters);
  const newNoVoters = new Set(vote.noVoters);

  if (voteChoice === "yes") {
    if (newYesVoters.has(voterId)) {
      return {
        passed: false,
        failed: false,
        reason: VOTE_REASONS.alreadyVotedYes,
      };
    }
    newNoVoters.delete(voterId);
    newYesVoters.add(voterId);

    if (newYesVoters.size >= vote.required) {
      return {
        passed: true,
        failed: false,
        updatedYesVoters: newYesVoters,
        updatedNoVoters: newNoVoters,
      };
    }
  } else {
    if (newNoVoters.has(voterId)) {
      return {
        passed: false,
        failed: false,
        reason: VOTE_REASONS.alreadyVotedNo,
      };
    }
    newYesVoters.delete(voterId);
    newNoVoters.add(voterId);

    const maxPossibleYes = vote.eligibleVoters.size - newNoVoters.size;
    if (maxPossibleYes < vote.required) {
      return {
        passed: false,
        failed: true,
        updatedYesVoters: newYesVoters,
        updatedNoVoters: newNoVoters,
      };
    }
  }

  return {
    passed: false,
    failed: false,
    updatedYesVoters: newYesVoters,
    updatedNoVoters: newNoVoters,
  };
}

/**
 * Creates a new vote state.
 * Pure function - returns new state object.
 */
export function createVoteState(
  type: VoteType,
  initiatorId: string,
  eligibleVoters: Set<string>,
  isSystemTriggered: boolean
): Omit<VoteState, "required"> & { required: number } {
  const initialYes = isSystemTriggered
    ? new Set<string>()
    : new Set([initiatorId]);

  return {
    type,
    initiatorId,
    yesVoters: initialYes,
    eligibleVoters: new Set(eligibleVoters),
    required: eligibleVoters.size,
  };
}
