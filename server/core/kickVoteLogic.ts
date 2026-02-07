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
    return { canStart: false, reason: "A kick vote is already in progress" };
  }

  if (initiatorId === targetId) {
    return { canStart: false, reason: "You cannot vote to kick yourself" };
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

export interface KickVoteProcessResult {
  passed: boolean;
  failed: boolean;
  reason?: string;
  updatedYesVoters?: Set<string>;
  updatedNoVoters?: Set<string>;
}

/**
 * Processes a kick vote from a player.
 * Pure function - returns result without modifying input.
 *
 * Voters can change their mind (switch yes<->no).
 * Passes immediately when yesVoters >= required.
 * Fails immediately when too many no votes make passing impossible.
 */
export function processKickVote(
  vote: KickVoteState,
  voterId: string,
  voteChoice: "yes" | "no"
): KickVoteProcessResult {
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

    // Check pass
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
    // Max possible yes = eligible voters who haven't voted no
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
