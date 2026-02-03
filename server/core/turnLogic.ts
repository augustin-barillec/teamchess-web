import { Chess } from "chess.js";
import { GameStatus, EndReason } from "../shared_types.js";
import type { PlayerSide } from "../types.js";

export interface TurnState {
  status: GameStatus;
  side: PlayerSide;
  moveNumber: number;
  whiteTime: number;
  blackTime: number;
  proposals: Map<string, { lan: string; san: string; name: string }>;
}

export interface OnlinePlayerInfo {
  activeTeamPids: Set<string>;
}

/**
 * Determines if a turn should be finalized based on current state.
 * Pure function - no side effects.
 */
export function shouldFinalizeTurn(
  state: TurnState,
  online: OnlinePlayerInfo
): boolean {
  if (state.status !== GameStatus.AwaitingProposals) return false;
  if (online.activeTeamPids.size === 0) return false;

  const onlineProposalCount = [...state.proposals.keys()].filter((pid) =>
    online.activeTeamPids.has(pid)
  ).length;

  return onlineProposalCount === online.activeTeamPids.size;
}

/**
 * Calculates time increment based on current time.
 * Returns 10 seconds if time is 60 or less, 0 otherwise.
 */
export function calculateIncrement(currentTime: number): number {
  return currentTime <= 60 ? 10 : 0;
}

export interface MoveResult {
  success: boolean;
  error?: string;
  san?: string;
  fen?: string;
}

/**
 * Validates and applies a move to a chess instance.
 * Pure function - operates on provided chess instance.
 */
export function validateAndApplyMove(chess: Chess, lan: string): MoveResult {
  try {
    const from = lan.slice(0, 2);
    const to = lan.slice(2, 4);
    const params: { from: string; to: string; promotion?: string } = {
      from,
      to,
    };
    if (lan.length === 5) params.promotion = lan[4];

    const move = chess.move(params);
    if (!move) {
      return { success: false, error: "Illegal move" };
    }
    return { success: true, san: move.san, fen: chess.fen() };
  } catch {
    return { success: false, error: "Move error" };
  }
}

export interface GameOverResult {
  isOver: boolean;
  reason?: string;
  winner?: PlayerSide | null;
}

/**
 * Detects if the game is over and determines the reason/winner.
 * Pure function - only reads from chess instance.
 */
export function detectGameOver(
  chess: Chess,
  currentSide: PlayerSide
): GameOverResult {
  if (!chess.isGameOver()) return { isOver: false };

  if (chess.isCheckmate()) {
    return { isOver: true, reason: EndReason.Checkmate, winner: currentSide };
  }
  if (chess.isStalemate()) {
    return { isOver: true, reason: EndReason.Stalemate, winner: null };
  }
  if (chess.isThreefoldRepetition()) {
    return { isOver: true, reason: EndReason.Threefold, winner: null };
  }
  if (chess.isInsufficientMaterial()) {
    return { isOver: true, reason: EndReason.Insufficient, winner: null };
  }
  return { isOver: true, reason: EndReason.DrawRule, winner: null };
}

/**
 * Gets the opposite side.
 */
export function getOppositeSide(side: PlayerSide): PlayerSide {
  return side === "white" ? "black" : "white";
}
