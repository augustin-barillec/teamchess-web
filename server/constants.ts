import path from "path";

/**
 * How long a team with nobody connected has to get someone back before it loses.
 *
 * This is the whole safety net, and it is deliberately the only one: a player is
 * never dropped from their team for going quiet, so a dropped connection cannot
 * cost anything by itself. Only an empty team is a problem, and it gets this long
 * — counted down in front of everyone — for the missing player to return or for
 * anyone else to take the seat.
 */
export const TEAM_EMPTY_FORFEIT_MS = 30000;
export const STOCKFISH_SEARCH_DEPTH = 15;
/** How long a search may run before the engine is considered unusable for this turn. */
export const ENGINE_MOVE_TIMEOUT_MS = 10000;
export const TEAM_VOTE_DURATION_MS = 20000;

// Re-exported so server code has a single constants module to import from; the
// definitions live next door where the browser client can reach them too.
export {
  DEFAULT_CLOCK_TIME,
  INCREMENT_THRESHOLD,
  TIME_INCREMENT,
} from "./shared_constants.js";

export const stockfishPath = path.join(
  process.cwd(),
  "node_modules",
  "stockfish",
  "bin",
  "stockfish-18.js"
);
