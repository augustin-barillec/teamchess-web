import { Chess } from "chess.js";
import { GameStatus, EndReason } from "../shared_types.js";
import type { PlayerSide } from "../types.js";
import { INCREMENT_THRESHOLD, TIME_INCREMENT } from "../constants.js";

/**
 * Every member of the team to move has proposed. A proposal from someone who has
 * since left still exists — nothing purges it, and it stays playable — but it must
 * not count toward the threshold: otherwise the turn would finalize on their move
 * without ever waiting for the teammates still here.
 */
export function shouldFinalizeTurn(
  status: GameStatus,
  activeTeamPids: ReadonlySet<string>,
  proposalPids: Iterable<string>
): boolean {
  if (status !== GameStatus.AwaitingProposals) return false;
  if (activeTeamPids.size === 0) return false;

  let activeProposalCount = 0;
  for (const pid of proposalPids) {
    if (activeTeamPids.has(pid)) activeProposalCount++;
  }
  return activeProposalCount === activeTeamPids.size;
}

export function calculateIncrement(currentTime: number): number {
  return currentTime <= INCREMENT_THRESHOLD ? TIME_INCREMENT : 0;
}

export interface SelectedMove {
  lan: string;
  /** True when the engine could not be trusted and a candidate was drawn at random. */
  fallback: boolean;
}

/**
 * Decides which candidate to play from the engine's answer.
 *
 * The engine is only an adviser: candidates were validated as legal when submitted, so any
 * of them can be played. When its answer is unusable — no engine, no answer in time, or a
 * move that is not one of the proposals — a candidate is drawn at random and `fallback` is
 * set so the caller can warn the players. Returns null when there is nothing to play.
 *
 * `rng` is injected so a test can pin which candidate the fallback draws.
 */
export function resolveSelectedMove(
  engineMove: string | null,
  candidates: string[],
  rng: () => number = Math.random
): SelectedMove | null {
  if (candidates.length === 0) return null;

  if (engineMove && candidates.includes(engineMove)) {
    return { lan: engineMove, fallback: false };
  }

  // Math.min guards against an rng returning exactly 1.
  const index = Math.min(
    Math.floor(rng() * candidates.length),
    candidates.length - 1
  );
  return { lan: candidates[index], fallback: true };
}

export interface GameOverResult {
  isOver: boolean;
  reason?: EndReason;
  winner?: PlayerSide | null;
}

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
