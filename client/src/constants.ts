import { EndReason } from "../../server/shared_types";

export const STORAGE_KEYS = {
  pid: "tc:pid",
  name: "tc:name",
  side: "tc:side",
} as const;

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
