import path from "path";

export const DISCONNECT_GRACE_MS = 20000;
export const STOCKFISH_SEARCH_DEPTH = 15;
export const TEAM_VOTE_DURATION_MS = 20000;
export const KICK_VOTE_DURATION_MS = 20000;
export const RESET_VOTE_DURATION_MS = 20000;
export const DEFAULT_CLOCK_TIME = 600;
/** Time threshold (seconds) at or below which increment is awarded */
export const INCREMENT_THRESHOLD = 60;
/** Seconds added per move when time is at or below INCREMENT_THRESHOLD */
export const TIME_INCREMENT = 10;

export const stockfishPath = path.join(
  process.cwd(),
  "node_modules",
  "stockfish",
  "src",
  "stockfish-nnue-16.js"
);
