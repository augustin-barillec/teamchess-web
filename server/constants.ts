import path from "path";

export const DISCONNECT_GRACE_MS = 20000;
export const STOCKFISH_SEARCH_DEPTH = 15;
export const TEAM_VOTE_DURATION_MS = 20000;
export const KICK_VOTE_DURATION_MS = 20000;
export const RESET_VOTE_DURATION_MS = 20000;
export const DEFAULT_TIME = 600;

export const stockfishPath = path.join(
  process.cwd(),
  "node_modules",
  "stockfish",
  "src",
  "stockfish-nnue-16.js"
);
