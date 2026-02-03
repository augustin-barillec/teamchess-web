import { describe, it, expect } from "vitest";
import { groupPiecesToStrings, calculateMaterial } from "./materialCalc.js";

describe("materialCalc", () => {
  describe("groupPiecesToStrings", () => {
    it("returns empty array for empty input", () => {
      expect(groupPiecesToStrings([])).toEqual([]);
    });

    it("returns single piece without count", () => {
      const pieces = [{ type: "q", figurine: "♕" }];
      expect(groupPiecesToStrings(pieces)).toEqual(["♕"]);
    });

    it("groups consecutive same pieces with count", () => {
      const pieces = [
        { type: "q", figurine: "♕" },
        { type: "q", figurine: "♕" },
      ];
      expect(groupPiecesToStrings(pieces)).toEqual(["♕x2"]);
    });

    it("handles multiple different pieces", () => {
      const pieces = [
        { type: "q", figurine: "♕" },
        { type: "r", figurine: "♖" },
        { type: "n", figurine: "♘" },
      ];
      expect(groupPiecesToStrings(pieces)).toEqual(["♕", "♖", "♘"]);
    });

    it("groups consecutive pieces and separates different ones", () => {
      const pieces = [
        { type: "r", figurine: "♖" },
        { type: "r", figurine: "♖" },
        { type: "n", figurine: "♘" },
        { type: "p", figurine: "♙" },
        { type: "p", figurine: "♙" },
        { type: "p", figurine: "♙" },
      ];
      expect(groupPiecesToStrings(pieces)).toEqual(["♖x2", "♘", "♙x3"]);
    });
  });

  describe("calculateMaterial", () => {
    // Helper to create a board piece
    const wp = (type: string) => ({ type, color: "w" as const });
    const bp = (type: string) => ({ type, color: "b" as const });

    it("returns zero balance for starting position", () => {
      // Simplified starting position - equal material
      const board = [
        [
          wp("r"),
          wp("n"),
          wp("b"),
          wp("q"),
          wp("k"),
          wp("b"),
          wp("n"),
          wp("r"),
        ],
        [
          wp("p"),
          wp("p"),
          wp("p"),
          wp("p"),
          wp("p"),
          wp("p"),
          wp("p"),
          wp("p"),
        ],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [
          bp("p"),
          bp("p"),
          bp("p"),
          bp("p"),
          bp("p"),
          bp("p"),
          bp("p"),
          bp("p"),
        ],
        [
          bp("r"),
          bp("n"),
          bp("b"),
          bp("q"),
          bp("k"),
          bp("b"),
          bp("n"),
          bp("r"),
        ],
      ];

      const result = calculateMaterial(board);
      expect(result.materialBalance).toBe(0);
      expect(result.whiteMaterialDiff).toEqual([]);
      expect(result.blackMaterialDiff).toEqual([]);
    });

    it("calculates positive balance when white has extra queen", () => {
      const board = [
        [wp("k"), wp("q"), null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [bp("k"), null, null, null, null, null, null, null],
      ];

      const result = calculateMaterial(board);
      expect(result.materialBalance).toBe(9); // Queen = 9
      expect(result.whiteMaterialDiff).toEqual(["♕"]);
      expect(result.blackMaterialDiff).toEqual([]);
    });

    it("calculates negative balance when black has extra material", () => {
      const board = [
        [wp("k"), null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [bp("k"), bp("r"), bp("r"), null, null, null, null, null],
      ];

      const result = calculateMaterial(board);
      expect(result.materialBalance).toBe(-10); // 2 rooks = -10
      expect(result.whiteMaterialDiff).toEqual([]);
      expect(result.blackMaterialDiff).toEqual(["♜x2"]);
    });

    it("shows piece differences in correct order (q, r, b, n, p)", () => {
      const board = [
        [wp("k"), wp("p"), wp("n"), wp("q"), null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [bp("k"), null, null, null, null, null, null, null],
      ];

      const result = calculateMaterial(board);
      // White has: Q(9) + N(3) + P(1) = 13
      expect(result.materialBalance).toBe(13);
      // Order should be: q, r, b, n, p (but only pieces with diff shown)
      expect(result.whiteMaterialDiff).toEqual(["♕", "♘", "♙"]);
    });

    it("handles complex material imbalance", () => {
      // White: K, Q, R (total: 9 + 5 = 14)
      // Black: K, B, B, N, N (total: 3 + 3 + 3 + 3 = 12)
      // Balance: 14 - 12 = 2
      const board = [
        [wp("k"), wp("q"), wp("r"), null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [bp("k"), bp("b"), bp("b"), bp("n"), bp("n"), null, null, null],
      ];

      const result = calculateMaterial(board);
      expect(result.materialBalance).toBe(2);
      // White has extra Q and R
      expect(result.whiteMaterialDiff).toEqual(["♕", "♖"]);
      // Black has extra 2 bishops and 2 knights
      expect(result.blackMaterialDiff).toEqual(["♝x2", "♞x2"]);
    });

    it("handles empty board with just kings", () => {
      const board = [
        [wp("k"), null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [bp("k"), null, null, null, null, null, null, null],
      ];

      const result = calculateMaterial(board);
      expect(result.materialBalance).toBe(0);
      expect(result.whiteMaterialDiff).toEqual([]);
      expect(result.blackMaterialDiff).toEqual([]);
    });

    it("counts multiple pawns correctly", () => {
      const board = [
        [wp("k"), wp("p"), wp("p"), wp("p"), null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [bp("k"), bp("p"), null, null, null, null, null, null],
      ];

      const result = calculateMaterial(board);
      expect(result.materialBalance).toBe(2); // 3 - 1 = 2 pawns
      expect(result.whiteMaterialDiff).toEqual(["♙x2"]);
      expect(result.blackMaterialDiff).toEqual([]);
    });
  });
});
