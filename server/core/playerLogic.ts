import type { Session, Side, PlayerSide } from "../types.js";

export interface PlayerCounts {
  white: number;
  black: number;
  spectators: number;
}

/**
 * Counts players by side from sessions map.
 * Pure function - no side effects.
 */
export function getPlayerCounts(sessions: Map<string, Session>): PlayerCounts {
  let white = 0;
  let black = 0;
  let spectators = 0;

  for (const sess of sessions.values()) {
    if (sess.side === "white") white++;
    else if (sess.side === "black") black++;
    else spectators++;
  }

  return { white, black, spectators };
}

export interface AbandonmentResult {
  shouldEnd: boolean;
  winner?: PlayerSide | null;
}

/**
 * Determines if the game should end due to team abandonment.
 * Pure function - no side effects.
 */
export function shouldEndDueToAbandonment(
  whiteIds: Set<string>,
  blackIds: Set<string>
): AbandonmentResult {
  const whiteAlive = whiteIds.size > 0;
  const blackAlive = blackIds.size > 0;

  if (whiteAlive && blackAlive) {
    return { shouldEnd: false };
  }

  const winner = whiteAlive ? "white" : blackAlive ? "black" : null;
  return { shouldEnd: true, winner };
}

/**
 * Filters a set of player IDs to only include those currently online.
 * Pure function - no side effects.
 */
export function filterOnlinePlayers(
  playerIds: Set<string>,
  onlinePids: Set<string>
): Set<string> {
  return new Set([...playerIds].filter((pid) => onlinePids.has(pid)));
}

/**
 * Gets team IDs for a specific side.
 */
export function getTeamIds(
  side: PlayerSide,
  whiteIds: Set<string>,
  blackIds: Set<string>
): Set<string> {
  return side === "white" ? whiteIds : blackIds;
}

/**
 * Checks if a player is on a specific team.
 */
export function isPlayerOnTeam(
  pid: string,
  side: Side,
  whiteIds: Set<string>,
  blackIds: Set<string>
): boolean {
  if (side === "white") return whiteIds.has(pid);
  if (side === "black") return blackIds.has(pid);
  return false;
}
