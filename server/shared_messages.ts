import { EndReason } from "./shared_types.js";
import type { VoteType } from "./shared_types.js";

const cap = (s: string | null) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : "";

/**
 * A message per end reason. Keyed by `EndReason` rather than `string` on purpose: the
 * compiler then refuses a new reason that nobody wrote a message for, which is what
 * lets `endGame` look one up without a fallback for a case that cannot happen.
 */
export const reasonMessages: Record<
  EndReason,
  (winner: string | null) => string
> = {
  [EndReason.Checkmate]: (winner) => `🏆 Checkmate!\n${cap(winner)} wins!`,
  [EndReason.Stalemate]: () => `🤝 Game drawn by stalemate.`,
  [EndReason.Threefold]: () => `🤝 Game drawn by threefold repetition.`,
  [EndReason.Insufficient]: () => `🤝 Game drawn by insufficient material.`,
  [EndReason.DrawRule]: () => `🤝 Game drawn by rule (e.g. fifty-move).`,
  [EndReason.Resignation]: (winner) => `🏳️ Resignation!\n${cap(winner)} wins!`,
  [EndReason.DrawAgreement]: () => `🤝 Draw agreed.`,
  [EndReason.Timeout]: (winner) => `⏱️ Time!\n${cap(winner)} wins!`,
  [EndReason.Abandonment]: (winner) =>
    `🚪 Forfeit!\n${cap(winner)} wins — opposing team is empty.`,
};

export const SENDER_SYSTEM = "System";
export const DEFAULT_PLAYER_NAME = "Player";

export function formatVoteType(type: VoteType): string {
  return type.replace("_", " ");
}

export const MSG = {
  teamVoteFailed: (type: VoteType) =>
    `❌ Vote to ${formatVoteType(type)} failed.`,

  playerKicked: (name: string) => `${name} has been kicked.`,
  youHaveBeenKicked: "You have been kicked from the game.",

  gameReset: "🔄 Game has been reset.",

  welcomeMessage: `Welcome to TeamChess!\n\nHow it works:\n• Each player on a team proposes a move\n• Stockfish 18 picks the strongest proposal\n\nTime control:\n• 10 min per side\n• +10s added at the end of each turn when under 1 min\n\nJoin White or Black to play!`,

  systemError:
    "⚠️ System error: move could not be processed. Please resubmit your moves.",
  engineFallback:
    "⚠️ Stockfish could not pick a move — a proposal was played at random.",

  // Sent to one socket, never broadcast.
  errorNotEligible: "You are not eligible to vote.",
  errorTargetNotFound: "Target player not found.",
  errorVoteInProgress: "Another vote is already in progress.",
  errorLeadOnly: "Only the host can do that.",
  errorCannotKickSelf: "You cannot kick yourself.",
  errorOnlyWhiteStart: "Only the White team can start the game.",
  errorBothTeamsRequired: "Both teams must have at least one player to start.",
  errorNotAccepting: "Not accepting moves right now.",
  errorNotYourTurn: "Not your turn.",
  errorAlreadyMoved: "Already moved.",
  errorIllegalFormat: "Illegal move format.",
  errorIllegalMove: "Illegal move.",
} as const;
