import { pieceToFigurine } from "./constants";

type Piece = { type: string; color: "w" | "b" } | null;

const PIECE_VALUES: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

const PIECE_ORDER = ["q", "r", "b", "n", "p"];

export interface MaterialResult {
  whiteMaterialDiff: string[];
  blackMaterialDiff: string[];
  materialBalance: number;
}

/**
 * Groups consecutive pieces of the same type into display strings.
 * e.g., [♕, ♕, ♖] -> ["♕x2", "♖"]
 */
export function groupPiecesToStrings(
  pieces: { type: string; figurine: string }[]
): string[] {
  if (pieces.length === 0) return [];

  const groupedStrings: string[] = [];
  let currentFigurine = pieces[0].figurine;
  let currentCount = 0;

  for (const piece of pieces) {
    if (piece.figurine === currentFigurine) {
      currentCount++;
    } else {
      groupedStrings.push(
        `${currentFigurine}${currentCount > 1 ? `x${currentCount}` : ""}`
      );
      currentFigurine = piece.figurine;
      currentCount = 1;
    }
  }
  groupedStrings.push(
    `${currentFigurine}${currentCount > 1 ? `x${currentCount}` : ""}`
  );

  return groupedStrings;
}

/**
 * Calculates material difference between white and black pieces.
 * Returns display strings for captured pieces and the numeric balance.
 */
export function calculateMaterial(board: Piece[][]): MaterialResult {
  const wCounts: Record<string, number> = {
    p: 0,
    n: 0,
    b: 0,
    r: 0,
    q: 0,
    k: 0,
  };
  const bCounts: Record<string, number> = {
    p: 0,
    n: 0,
    b: 0,
    r: 0,
    q: 0,
    k: 0,
  };

  board.flat().forEach((piece) => {
    if (piece) {
      if (piece.color === "w") wCounts[piece.type]++;
      else bCounts[piece.type]++;
    }
  });

  let wScore = 0;
  let bScore = 0;
  for (const type of Object.keys(PIECE_VALUES)) {
    wScore += wCounts[type] * PIECE_VALUES[type];
    bScore += bCounts[type] * PIECE_VALUES[type];
  }
  const balance = wScore - bScore;

  const whiteDiff: { type: string; figurine: string }[] = [];
  const blackDiff: { type: string; figurine: string }[] = [];

  for (const type of PIECE_ORDER) {
    const diff = wCounts[type] - bCounts[type];
    const absDiff = Math.abs(diff);
    const figurine = pieceToFigurine[type.toUpperCase()];

    if (diff !== 0) {
      const targetList = diff > 0 ? whiteDiff : blackDiff;

      for (let i = 0; i < absDiff; i++) {
        targetList.push({ type, figurine });
      }
    }
  }

  return {
    whiteMaterialDiff: groupPiecesToStrings(whiteDiff),
    blackMaterialDiff: groupPiecesToStrings(blackDiff),
    materialBalance: balance,
  };
}
