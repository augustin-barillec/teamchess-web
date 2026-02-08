export interface ResetVoteState {
  initiatorId: string;
  yesVoters: Set<string>;
  noVoters: Set<string>;
  eligibleVoters: Set<string>;
  required: number;
  total: number;
}

export interface ResetVotePrerequisiteResult {
  canStart: boolean;
  reason?: string;
}

/**
 * Checks prerequisites for starting a reset vote.
 * Pure function - no side effects.
 */
export function checkResetVotePrerequisites(
  existingResetVote: ResetVoteState | undefined
): ResetVotePrerequisiteResult {
  if (existingResetVote) {
    return { canStart: false, reason: "A reset vote is already in progress" };
  }

  return { canStart: true };
}

/**
 * Creates a new reset vote state.
 * Pure function - returns new state object.
 *
 * All connected users are eligible to vote.
 * Required = strict majority (floor(N/2) + 1).
 * The initiator automatically votes yes.
 */
export function createResetVoteState(
  initiatorId: string,
  allConnectedPids: Set<string>
): ResetVoteState {
  const eligibleVoters = new Set(allConnectedPids);
  const N = eligibleVoters.size;
  const required = Math.floor(N / 2) + 1;

  const yesVoters = new Set([initiatorId]);

  return {
    initiatorId,
    yesVoters,
    noVoters: new Set(),
    eligibleVoters,
    required,
    total: eligibleVoters.size,
  };
}

export interface ResetVoteProcessResult {
  passed: boolean;
  failed: boolean;
  reason?: string;
  updatedYesVoters?: Set<string>;
  updatedNoVoters?: Set<string>;
}

/**
 * Processes a reset vote from a player.
 * Pure function - returns result without modifying input.
 *
 * Voters can change their mind (switch yes<->no).
 * Passes immediately when yesVoters >= required.
 * Fails immediately when too many no votes make passing impossible.
 */
export function processResetVote(
  vote: ResetVoteState,
  voterId: string,
  voteChoice: "yes" | "no"
): ResetVoteProcessResult {
  if (!vote.eligibleVoters.has(voterId)) {
    return { passed: false, failed: false, reason: "Not eligible to vote" };
  }

  const newYesVoters = new Set(vote.yesVoters);
  const newNoVoters = new Set(vote.noVoters);

  if (voteChoice === "yes") {
    if (newYesVoters.has(voterId)) {
      return { passed: false, failed: false, reason: "Already voted yes" };
    }
    // Switch from no if needed
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
      return { passed: false, failed: false, reason: "Already voted no" };
    }
    // Switch from yes if needed
    newYesVoters.delete(voterId);
    newNoVoters.add(voterId);

    // Check if passing is still possible
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
