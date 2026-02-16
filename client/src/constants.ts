export const STORAGE_KEYS = {
  pid: "tc:pid",
  name: "tc:name",
  side: "tc:side",
} as const;

export const pieceToFigurineWhite: Record<string, string> = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
};

export const pieceToFigurineBlack: Record<string, string> = {
  K: "♚",
  Q: "♛",
  R: "♜",
  B: "♝",
  N: "♞",
  P: "♟",
};

/** Neutral filled glyphs for material display (theme-independent) */
export const pieceToFigurine: Record<string, string> = {
  K: "♚",
  Q: "♛",
  R: "♜",
  B: "♝",
  N: "♞",
  P: "♟",
};
