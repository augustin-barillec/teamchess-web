import type { InternalTeamVote, PlayerSide, VoteType } from "./types.js";
import type { TeamVoteState } from "./shared_types.js";
import { EndReason } from "./shared_types.js";
import { TEAM_VOTE_DURATION_MS } from "./constants.js";
import {
  sessions,
  getGameState,
  getIO,
  getAllSockets,
  getTeamPids,
} from "./state.js";
import { sendSystemMessage } from "./utils/messaging.js";
import { MSG } from "./shared_messages.js";
import { endGame } from "./game/gameLogic.js";

/**
 * Team votes (resign / offer_draw / accept_draw) — the only votes in the game:
 * kicking and resetting are lead powers, not votes.
 *
 * Only one vote can run at a time. The electorate is frozen when the vote is
 * created: `eligibleVoters` maps every voter to the name they had at that
 * instant, and neither it nor `required` changes afterwards, whoever joins or
 * leaves. A voter who leaves mid-vote keeps both their recorded ballot and the
 * name the vote recorded for them.
 *
 * The rule is unanimity, yes-only — a single "no" fails the vote instantly.
 */

/** Snapshots pids as pid -> name, to freeze a vote's electorate at creation. */
function rosterOf(pids: Set<string>): Map<string, string> {
  return new Map(
    [...pids].map((pid) => [pid, sessions.get(pid)?.name || "Unknown"])
  );
}

/**
 * Resolves voter names from the vote's own frozen roster, not from live
 * sessions: a voter who has since disconnected or been kicked is still
 * displayed under the name they voted with.
 */
function voterNames(
  pids: Set<string>,
  roster: ReadonlyMap<string, string>
): string[] {
  return [...pids].map((pid) => roster.get(pid) || "Unknown");
}

/**
 * Gets the active vote formatted for a specific client, or null when no vote is
 * running. Personalizes `myVoteEligible` and `myCurrentVote`.
 */
export function getVoteClientData(viewerPid: string): TeamVoteState | null {
  const vote = getGameState().activeVote;
  if (!vote) return null;

  return {
    side: vote.side,
    type: vote.type,
    yesVotes: voterNames(vote.yesVoters, vote.eligibleVoters),
    requiredVotes: vote.required,
    endTime: vote.endTime,
    myVoteEligible: vote.eligibleVoters.has(viewerPid),
    myCurrentVote: vote.yesVoters.has(viewerPid) ? "yes" : null,
  };
}

/**
 * Broadcasts the active vote (or its absence) to all connected sockets.
 * Each client gets a personalized view.
 */
export function broadcastVote(): void {
  for (const socket of getAllSockets()) {
    const pid = socket.data.pid;
    if (pid) {
      socket.emit("vote_update", getVoteClientData(pid));
    }
  }
}

/**
 * Clears the active vote.
 */
export function clearActiveVote(): void {
  const gameState = getGameState();
  const vote = gameState.activeVote;
  if (vote) {
    clearTimeout(vote.timer);
    gameState.activeVote = undefined;
    broadcastVote();
  }
}

/**
 * Fails the active vote (an explicit "no", or a timeout): clears it, announces
 * it, and rejects a pending draw offer.
 */
function failVote(vote: InternalTeamVote): void {
  const gameState = getGameState();
  clearTimeout(vote.timer);
  gameState.activeVote = undefined;

  sendSystemMessage(MSG.teamVoteFailed(vote.type));

  if (vote.type === "accept_draw") {
    gameState.drawOffer = undefined;
    getIO().emit("draw_offer_update", { side: null });
  }

  broadcastVote();
}

/**
 * Installs a vote in the single active-vote slot: arms its expiration timer and
 * broadcasts it. The caller must have checked the slot is free.
 */
function installVote(
  vote: Omit<InternalTeamVote, "timer" | "endTime">,
  durationMs: number
): void {
  const fullVote: InternalTeamVote = {
    ...vote,
    endTime: Date.now() + durationMs,
    timer: setTimeout(() => failVote(fullVote), durationMs),
  };

  getGameState().activeVote = fullVote;
  broadcastVote();
}

function executeTeamVoteResult(side: PlayerSide, type: VoteType): void {
  const gameState = getGameState();
  const otherSide = side === "white" ? "black" : "white";

  if (type === "resign") {
    endGame(EndReason.Resignation, otherSide);
  } else if (type === "offer_draw") {
    gameState.drawOffer = side;
    getIO().emit("draw_offer_update", { side });
    // The other side now votes on accepting
    startTeamVote(otherSide, "accept_draw", "system");
  } else if (type === "accept_draw") {
    endGame(EndReason.DrawAgreement, null);
  }
}

/**
 * Starts or auto-executes a team vote (resign / offer_draw / accept_draw).
 * Solo teams skip the vote and execute directly, except when system-triggered.
 */
export function startTeamVote(
  side: PlayerSide,
  type: VoteType,
  initiatorId: string
): { error?: string } {
  const gameState = getGameState();
  const isSystemTriggered = initiatorId === "system";

  if (gameState.activeVote) {
    return { error: MSG.errorVoteInProgress };
  }

  // Prerequisites: a draw can only be accepted against a live offer from the
  // other side, and only offered once.
  if (
    type === "accept_draw" &&
    (!gameState.drawOffer || gameState.drawOffer === side)
  ) {
    return {};
  }
  if (type === "offer_draw" && gameState.drawOffer) {
    return {};
  }

  // Snapshot the team (pid -> name) as the vote's frozen electorate
  const teamRoster = rosterOf(getTeamPids(side));

  // Solo team: skip the vote and execute directly
  if (teamRoster.size <= 1 && !isSystemTriggered) {
    executeTeamVoteResult(side, type);
    return {};
  }

  installVote(
    {
      side,
      type,
      yesVoters: isSystemTriggered ? new Set() : new Set([initiatorId]),
      eligibleVoters: teamRoster,
      required: teamRoster.size,
    },
    TEAM_VOTE_DURATION_MS
  );

  return {};
}

/**
 * Applies a yes/no ballot to the active vote. Eligibility is decided solely by
 * the vote's frozen electorate. Unanimity is required, so a single "no" fails
 * the vote outright; the last missing "yes" executes it.
 */
export function castVote(
  voterId: string,
  choice: "yes" | "no"
): { error?: string } {
  const vote = getGameState().activeVote;
  if (!vote) return {};

  if (!vote.eligibleVoters.has(voterId)) {
    return { error: MSG.errorNotEligible };
  }

  if (choice === "no") {
    failVote(vote);
    return {};
  }

  if (vote.yesVoters.has(voterId)) return {};
  vote.yesVoters.add(voterId);

  if (vote.yesVoters.size >= vote.required) {
    clearActiveVote();
    executeTeamVoteResult(vote.side, vote.type);
  } else {
    broadcastVote();
  }
  return {};
}
