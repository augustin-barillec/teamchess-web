import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import {
  DEFAULT_CLOCK_TIME,
  INCREMENT_THRESHOLD,
  TIME_INCREMENT,
} from "../constants.js";
import {
  shouldFinalizeTurn,
  calculateIncrement,
  detectGameOver,
  resolveSelectedMove,
} from "./turnLogic.js";
import { GameStatus } from "../shared_types.js";

describe("turnLogic", () => {
  describe("shouldFinalizeTurn", () => {
    it("returns false when status is not AwaitingProposals", () => {
      expect(
        shouldFinalizeTurn(GameStatus.Setup, new Set(["p1"]), ["p1"])
      ).toBe(false);
      expect(
        shouldFinalizeTurn(GameStatus.FinalizingTurn, new Set(["p1"]), ["p1"])
      ).toBe(false);
      expect(shouldFinalizeTurn(GameStatus.Over, new Set(["p1"]), ["p1"])).toBe(
        false
      );
    });

    it("returns false when no active team members", () => {
      expect(
        shouldFinalizeTurn(GameStatus.AwaitingProposals, new Set(), [])
      ).toBe(false);
    });

    it("returns false when not all active players have proposed", () => {
      expect(
        shouldFinalizeTurn(
          GameStatus.AwaitingProposals,
          new Set(["p1", "p2"]),
          ["p1"]
        )
      ).toBe(false);
    });

    it("returns true when all active players have proposed", () => {
      expect(
        shouldFinalizeTurn(
          GameStatus.AwaitingProposals,
          new Set(["p1", "p2"]),
          ["p1", "p2"]
        )
      ).toBe(true);
    });

    it("ignores proposals from players who have left", () => {
      // p3 proposed then left; p2 is still here and has not proposed yet
      expect(
        shouldFinalizeTurn(
          GameStatus.AwaitingProposals,
          new Set(["p1", "p2"]),
          ["p1", "p3"]
        )
      ).toBe(false);
    });
  });

  describe("calculateIncrement", () => {
    it("returns TIME_INCREMENT when time is at or below INCREMENT_THRESHOLD", () => {
      expect(calculateIncrement(INCREMENT_THRESHOLD)).toBe(TIME_INCREMENT);
      expect(calculateIncrement(30)).toBe(TIME_INCREMENT);
      expect(calculateIncrement(1)).toBe(TIME_INCREMENT);
      expect(calculateIncrement(0)).toBe(TIME_INCREMENT);
    });

    it("returns 0 when time is above INCREMENT_THRESHOLD", () => {
      expect(calculateIncrement(INCREMENT_THRESHOLD + 1)).toBe(0);
      expect(calculateIncrement(100)).toBe(0);
      expect(calculateIncrement(DEFAULT_CLOCK_TIME)).toBe(0);
    });
  });

  describe("detectGameOver", () => {
    it("returns isOver false for ongoing game", () => {
      const chess = new Chess();
      const result = detectGameOver(chess, "white");

      expect(result.isOver).toBe(false);
    });

    it("detects checkmate correctly", () => {
      // Fool's mate position - black wins
      const chess = new Chess();
      chess.move("f3");
      chess.move("e5");
      chess.move("g4");
      chess.move("Qh4"); // Checkmate!

      const result = detectGameOver(chess, "black");

      expect(result.isOver).toBe(true);
      expect(result.reason).toBe("checkmate");
      expect(result.winner).toBe("black");
    });

    it("detects stalemate correctly", () => {
      // Stalemate position - black king is trapped but not in check
      const chess = new Chess("k7/2Q5/1K6/8/8/8/8/8 b - - 0 1");
      const result = detectGameOver(chess, "white");

      expect(result.isOver).toBe(true);
      expect(result.reason).toBe("stalemate");
      expect(result.winner).toBeNull();
    });

    it("detects threefold repetition", () => {
      const chess = new Chess();
      // Repeat moves: Nf3 Nf6 Ng1 Ng8 (x2) to reach initial position 3 times
      chess.move("Nf3");
      chess.move("Nf6");
      chess.move("Ng1");
      chess.move("Ng8");
      chess.move("Nf3");
      chess.move("Nf6");
      chess.move("Ng1");
      chess.move("Ng8");

      const result = detectGameOver(chess, "white");

      expect(result.isOver).toBe(true);
      expect(result.reason).toBe("threefold repetition");
      expect(result.winner).toBeNull();
    });

    it("detects 50-move draw rule", () => {
      // Halfmove clock at 100 with sufficient material
      const chess = new Chess("k7/8/8/8/8/8/1K5R/8 w - - 100 51");
      const result = detectGameOver(chess, "white");

      expect(result.isOver).toBe(true);
      expect(result.reason).toBe("draw by rule");
      expect(result.winner).toBeNull();
    });

    it("detects insufficient material", () => {
      // King vs King
      const chess = new Chess("k7/8/8/8/8/8/8/K7 w - - 0 1");
      const result = detectGameOver(chess, "white");

      expect(result.isOver).toBe(true);
      expect(result.reason).toBe("insufficient material");
      expect(result.winner).toBeNull();
    });
  });

  describe("resolveSelectedMove", () => {
    const candidates = ["e2e4", "d2d4", "g1f3"];

    it("keeps the engine move when it is one of the candidates", () => {
      const result = resolveSelectedMove("d2d4", candidates, () => 0);

      expect(result).toEqual({ lan: "d2d4", fallback: false });
    });

    it("draws a random candidate when the engine did not answer", () => {
      const result = resolveSelectedMove(null, candidates, () => 0.5);

      expect(result).toEqual({ lan: "d2d4", fallback: true });
    });

    it("draws a random candidate when the engine answers outside the proposals", () => {
      // Includes "(none)" and any illegal or unproposed move.
      const result = resolveSelectedMove("a7a6", candidates, () => 0);

      expect(result).toEqual({ lan: "e2e4", fallback: true });
    });

    it("never indexes past the end when rng returns 1", () => {
      const result = resolveSelectedMove(null, candidates, () => 1);

      expect(result).toEqual({ lan: "g1f3", fallback: true });
    });

    it("only ever returns a candidate", () => {
      for (let i = 0; i < 50; i++) {
        const result = resolveSelectedMove(null, candidates);
        expect(candidates).toContain(result!.lan);
        expect(result!.fallback).toBe(true);
      }
    });

    it("returns null when there is nothing to play", () => {
      expect(resolveSelectedMove(null, [])).toBeNull();
      expect(resolveSelectedMove("e2e4", [])).toBeNull();
    });
  });
});
