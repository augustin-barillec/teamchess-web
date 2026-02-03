import type { VoteType } from "../shared_types.js";
import type { PlayerSide } from "../types.js";

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
  if (
    type === "accept_draw" &&
    (!drawOffer || drawOffer === votingSide)
  ) {
    return {
      shouldAutoExecute: false,
      canStartVote: false,
      reason: "No valid draw offer",
    };
  }

  // Can't offer draw if already offered
  if (type === "offer_draw" && drawOffer) {
    return {
      shouldAutoExecute: false,
      canStartVote: false,
      reason: "Draw already offered",
    };
  }

  // Can't start vote if one is in progress
  if (existingVote) {
    return {
      shouldAutoExecute: false,
      canStartVote: false,
      reason: "Vote already in progress",
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
    return { passed: false, failed: false, reason: "Not eligible to vote" };
  }

  // No vote = rejection
  if (voteChoice === "no") {
    return { passed: false, failed: true, reason: "Vote rejected" };
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

/**
 * Formats a vote type for display.
 */
export function formatVoteType(type: VoteType): string {
  return type.replace("_", " ");
}
