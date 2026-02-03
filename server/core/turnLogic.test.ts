import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import {
  shouldFinalizeTurn,
  calculateIncrement,
  validateAndApplyMove,
  detectGameOver,
  getOppositeSide,
} from "./turnLogic.js";
import { GameStatus } from "../shared_types.js";

describe("turnLogic", () => {
  describe("shouldFinalizeTurn", () => {
    it("returns false when status is not AwaitingProposals", () => {
      const state = {
        status: GameStatus.Lobby,
        side: "white" as const,
        moveNumber: 1,
        whiteTime: 600,
        blackTime: 600,
        proposals: new Map(),
      };
      const online = { activeTeamPids: new Set(["p1"]) };

      expect(shouldFinalizeTurn(state, online)).toBe(false);
    });

    it("returns false when no active team members", () => {
      const state = {
        status: GameStatus.AwaitingProposals,
        side: "white" as const,
        moveNumber: 1,
        whiteTime: 600,
        blackTime: 600,
        proposals: new Map(),
      };
      const online = { activeTeamPids: new Set<string>() };

      expect(shouldFinalizeTurn(state, online)).toBe(false);
    });

    it("returns false when not all active players have proposed", () => {
      const proposals = new Map([
        ["p1", { lan: "e2e4", san: "e4", name: "Alice" }],
      ]);
      const state = {
        status: GameStatus.AwaitingProposals,
        side: "white" as const,
        moveNumber: 1,
        whiteTime: 600,
        blackTime: 600,
        proposals,
      };
      const online = { activeTeamPids: new Set(["p1", "p2"]) };

      expect(shouldFinalizeTurn(state, online)).toBe(false);
    });

    it("returns true when all active players have proposed", () => {
      const proposals = new Map([
        ["p1", { lan: "e2e4", san: "e4", name: "Alice" }],
        ["p2", { lan: "d2d4", san: "d4", name: "Bob" }],
      ]);
      const state = {
        status: GameStatus.AwaitingProposals,
        side: "white" as const,
        moveNumber: 1,
        whiteTime: 600,
        blackTime: 600,
        proposals,
      };
      const online = { activeTeamPids: new Set(["p1", "p2"]) };

      expect(shouldFinalizeTurn(state, online)).toBe(true);
    });

    it("ignores proposals from offline players", () => {
      const proposals = new Map([
        ["p1", { lan: "e2e4", san: "e4", name: "Alice" }],
        ["p3", { lan: "d2d4", san: "d4", name: "Charlie" }], // offline
      ]);
      const state = {
        status: GameStatus.AwaitingProposals,
        side: "white" as const,
        moveNumber: 1,
        whiteTime: 600,
        blackTime: 600,
        proposals,
      };
      // Only p1 and p2 are online, p3 is offline
      const online = { activeTeamPids: new Set(["p1", "p2"]) };

      expect(shouldFinalizeTurn(state, online)).toBe(false);
    });
  });

  describe("calculateIncrement", () => {
    it("returns 10 when time is 60 or less", () => {
      expect(calculateIncrement(60)).toBe(10);
      expect(calculateIncrement(30)).toBe(10);
      expect(calculateIncrement(1)).toBe(10);
      expect(calculateIncrement(0)).toBe(10);
    });

    it("returns 0 when time is above 60", () => {
      expect(calculateIncrement(61)).toBe(0);
      expect(calculateIncrement(100)).toBe(0);
      expect(calculateIncrement(600)).toBe(0);
    });
  });

  describe("validateAndApplyMove", () => {
    it("applies a valid move successfully", () => {
      const chess = new Chess();
      const result = validateAndApplyMove(chess, "e2e4");

      expect(result.success).toBe(true);
      expect(result.san).toBe("e4");
      expect(result.fen).toBe(chess.fen());
      // Verify pawn moved to e4 (the FEN shows this as "4P3" in the 4th rank)
      expect(chess.fen()).toContain("4P3");
    });

    it("handles promotion moves", () => {
      // Position with pawn ready to promote (kings far away, no check)
      const chess = new Chess("8/P7/8/8/8/8/7k/K7 w - - 0 1");
      const result = validateAndApplyMove(chess, "a7a8q");

      expect(result.success).toBe(true);
      expect(result.san).toBe("a8=Q");
    });

    it("returns error for illegal move", () => {
      const chess = new Chess();
      const result = validateAndApplyMove(chess, "e2e5"); // Can't move pawn 3 squares

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("returns error for invalid move format", () => {
      const chess = new Chess();
      const result = validateAndApplyMove(chess, "invalid");

      expect(result.success).toBe(false);
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

    it("detects insufficient material", () => {
      // King vs King
      const chess = new Chess("k7/8/8/8/8/8/8/K7 w - - 0 1");
      const result = detectGameOver(chess, "white");

      expect(result.isOver).toBe(true);
      expect(result.reason).toBe("insufficient material");
      expect(result.winner).toBeNull();
    });
  });

  describe("getOppositeSide", () => {
    it("returns black for white", () => {
      expect(getOppositeSide("white")).toBe("black");
    });

    it("returns white for black", () => {
      expect(getOppositeSide("black")).toBe("white");
    });
  });
});
