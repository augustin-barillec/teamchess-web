import type { PlayerSide } from "../types.js";

export interface AbandonmentResult {
  shouldEnd: boolean;
  winner?: PlayerSide | null;
}

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
