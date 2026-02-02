import path from "path";
import { EndReason } from "./shared_types.js";

export const DISCONNECT_GRACE_MS = 20000;
export const STOCKFISH_SEARCH_DEPTH = 15;
export const TEAM_VOTE_DURATION_MS = 20000;
export const DEFAULT_TIME = 600;

export const stockfishPath = path.join(
  process.cwd(),
  "node_modules",
  "stockfish",
  "src",
  "stockfish-nnue-16.js"
);

export const reasonMessages: Record<string, (winner: string | null) => string> =
  {
    [EndReason.Checkmate]: (winner) =>
      `☑️ Checkmate!\n${
        winner ? winner.charAt(0).toUpperCase() + winner.slice(1) : ""
      } wins!`,
    [EndReason.Stalemate]: () => `🤝 Game drawn by stalemate.`,
    [EndReason.Threefold]: () => `🤝 Game drawn by threefold repetition.`,
    [EndReason.Insufficient]: () => `🤝 Game drawn by insufficient material.`,
    [EndReason.DrawRule]: () => `🤝 Game drawn by rule (e.g. fifty-move).`,
    [EndReason.Resignation]: (winner) =>
      `🏳️ Resignation!\n${
        winner ? winner.charAt(0).toUpperCase() + winner.slice(1) : ""
      } wins!`,
    [EndReason.DrawAgreement]: () => `🤝 Draw agreed.`,
    [EndReason.Timeout]: (winner) =>
      `⏱️ Time!\n${
        winner ? winner.charAt(0).toUpperCase() + winner.slice(1) : ""
      } wins!`,
    [EndReason.Abandonment]: (winner) =>
      `🚫 Forfeit!\n${
        winner ? winner.charAt(0).toUpperCase() + winner.slice(1) : ""
      } wins as the opposing team is empty.`,
  };
