import path from "path";

/**
 * How long an empty team has to get someone back before it loses.
 *
 * This is the whole safety net, and it is deliberately the only one: disconnecting
 * gives up the seat at once, so this window is what makes a blink survivable. A
 * client that comes back inside it claims its side again by itself, and anyone else
 * is free to take the seat meanwhile — counted down in front of everyone.
 */
export const TEAM_EMPTY_FORFEIT_MS = 30000;
export const STOCKFISH_SEARCH_DEPTH = 15;
/** How long a search may run before the engine is considered unusable for this turn. */
export const ENGINE_MOVE_TIMEOUT_MS = 10000;
export const TEAM_VOTE_DURATION_MS = 20000;
/** Actions the server takes from one player per second; the rest are dropped unanswered. */
export const MAX_ACTIONS_PER_SECOND = 10;

// Re-exported so server code has a single constants module to import from; the
// definitions live next door where the browser client can reach them too.
export {
  DEFAULT_CLOCK_TIME,
  INCREMENT_THRESHOLD,
  TIME_INCREMENT,
  MAX_PLAYER_NAME_LENGTH,
  MAX_CHAT_MESSAGE_LENGTH,
} from "./shared_constants.js";

export const stockfishPath = path.join(
  process.cwd(),
  "node_modules",
  "stockfish",
  "bin",
  "stockfish-18.js"
);
