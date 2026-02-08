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
