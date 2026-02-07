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
 * Required = total eligible voters (unanimous).
 * The initiator automatically votes yes.
 */
export function createResetVoteState(
  initiatorId: string,
  allConnectedPids: Set<string>
): ResetVoteState {
  const eligibleVoters = new Set(allConnectedPids);
  const required = eligibleVoters.size;

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
 * Since the vote is unanimous:
 * - Any "no" vote immediately fails the vote.
 * - Vote passes when yesVoters.size >= required.
 * - Voters can change their mind (switch yes<->no).
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

    // Unanimous: any no vote makes passing impossible
    return {
      passed: false,
      failed: true,
      updatedYesVoters: newYesVoters,
      updatedNoVoters: newNoVoters,
    };
  }

  return {
    passed: false,
    failed: false,
    updatedYesVoters: newYesVoters,
    updatedNoVoters: newNoVoters,
  };
}
