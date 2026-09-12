import { Chess } from "chess.js";

/** Movetext only — `[Tag "..."]` headers stripped. The form sent in game_over payloads. */
export function getCleanPgn(chess: Chess): string {
  const fullPgn = chess.pgn();
  return fullPgn.replace(/^\[.*\]\n/gm, "").trim();
}
