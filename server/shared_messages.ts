import { EndReason } from "./shared_types.js";
import type { VoteType } from "./shared_types.js";

// ============================================================
// Game End Messages
// ============================================================

const cap = (s: string | null) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : "";

export const reasonMessages: Record<string, (winner: string | null) => string> =
  {
    [EndReason.Checkmate]: (winner) => `🏆 Checkmate!\n${cap(winner)} wins!`,
    [EndReason.Stalemate]: () => `🤝 Game drawn by stalemate.`,
    [EndReason.Threefold]: () => `🤝 Game drawn by threefold repetition.`,
    [EndReason.Insufficient]: () => `🤝 Game drawn by insufficient material.`,
    [EndReason.DrawRule]: () => `🤝 Game drawn by rule (e.g. fifty-move).`,
    [EndReason.Resignation]: (winner) =>
      `🏳️ Resignation!\n${cap(winner)} wins!`,
    [EndReason.DrawAgreement]: () => `🤝 Draw agreed.`,
    [EndReason.Timeout]: (winner) => `⏱️ Time!\n${cap(winner)} wins!`,
    [EndReason.Abandonment]: (winner) =>
      `🚪 Forfeit!\n${cap(winner)} wins — opposing team is empty.`,
  };

export const gameOverFallback = (winner: string | null): string =>
  `🎉 Game over! ${cap(winner)} wins!`;

// ============================================================
// Sender Names & Defaults
// ============================================================

export const SENDER_SYSTEM = "System";
export const DEFAULT_PLAYER_NAME = "Player";

// ============================================================
// Vote Display Formatters
// ============================================================

export function formatVoteType(type: VoteType): string {
  return type.replace("_", " ");
}

// ============================================================
// Vote Reason Strings (returned by pure logic)
// ============================================================

export const VOTE_REASONS = {
  noValidDrawOffer: "No valid draw offer",
  drawAlreadyOffered: "Draw already offered",
  voteAlreadyInProgress: "Vote already in progress",
  notEligibleToVote: "Not eligible to vote",
  voteRejected: "Vote rejected",
  alreadyVotedYes: "Already voted yes",
  alreadyVotedNo: "Already voted no",
  kickVoteInProgress: "A kick vote is already in progress",
  cannotKickSelf: "You cannot vote to kick yourself",
  resetVoteInProgress: "A reset vote is already in progress",
} as const;

// ============================================================
// Server Messages (template functions for socket emits)
// ============================================================

export const MSG = {
  // Team vote failure messages (simplified — no reason details)
  teamVoteFailed: (type: VoteType) =>
    `❌ Vote to ${formatVoteType(type)} failed.`,

  // Kick vote messages
  kickVoteFailed: (target: string) => `❌ Vote to kick ${target} failed.`,
  playerKicked: (name: string) => `${name} has been kicked.`,
  youHaveBeenKicked: "You have been kicked by vote.",

  // Reset vote messages
  gameReset: "🔄 Game has been reset.",
  resetVoteFailed: "❌ Vote to reset the game failed.",

  // Welcome message for new players
  welcomeMessage: `👋 Welcome to TeamChess!\n\nHow it works:\n• Each player on a team proposes a move\n• Stockfish 16 (depth 15, ~3000 ELO) picks the strongest candidate\n\nTime control:\n• 10 min per side\n• +10s added at the end of each turn when under 1 min\n\nJoin White or Black from the Controls panel to play!`,

  // Game flow
  systemError:
    "⚠️ System error: move could not be processed. Please resubmit your moves.",

  // Error messages (sent to individual sockets)
  errorNotEligible: "You are not eligible to vote.",
  errorJoinedLate: "You cannot vote — joined late.",
  errorTargetNotFound: "Target player not found.",
  errorOnlyWhiteStart: "Only the White team can start the game.",
  errorBothTeamsRequired: "Both teams must have at least one player to start.",
  errorNotAccepting: "Not accepting moves right now.",
  errorNotYourTurn: "Not your turn.",
  errorAlreadyMoved: "Already moved.",
  errorIllegalFormat: "Illegal move format.",
  errorIllegalMove: "Illegal move.",
} as const;
