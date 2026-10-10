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

/** A piece type one side has more of, and how many more. */
export interface MaterialGroup {
  figurine: string;
  count: number;
}

export interface MaterialResult {
  whiteMaterialDiff: MaterialGroup[];
  blackMaterialDiff: MaterialGroup[];
  materialBalance: number;
}

/**
 * Calculates material difference between white and black pieces.
 * Returns, for each side, the piece types it is up on, and the numeric balance.
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

  const whiteDiff: MaterialGroup[] = [];
  const blackDiff: MaterialGroup[] = [];

  for (const type of PIECE_ORDER) {
    const diff = wCounts[type] - bCounts[type];
    const figurine = pieceToFigurine[type.toUpperCase()];

    if (diff !== 0) {
      const targetList = diff > 0 ? whiteDiff : blackDiff;
      targetList.push({ figurine, count: Math.abs(diff) });
    }
  }

  return {
    whiteMaterialDiff: whiteDiff,
    blackMaterialDiff: blackDiff,
    materialBalance: balance,
  };
}
