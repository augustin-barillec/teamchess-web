import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { getCleanPgn } from "./pgn.js";

describe("getCleanPgn", () => {
  it("strips all header tags", () => {
    const chess = new Chess();
    chess.move("e4");
    const pgn = getCleanPgn(chess);
    expect(pgn).not.toMatch(/^\[/m);
  });

  it("returns only the move text", () => {
    const chess = new Chess();
    chess.move("e4");
    chess.move("Nc6");
    const pgn = getCleanPgn(chess);
    expect(pgn).toBe("1. e4 Nc6 *");
  });
});
