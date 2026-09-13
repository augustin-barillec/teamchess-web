import { describe, it, expect } from "vitest";
import { reasonMessages, formatVoteType, MSG } from "./shared_messages.js";
import { EndReason } from "./shared_types.js";

describe("shared_messages", () => {
  describe("reasonMessages", () => {
    it("generates correct checkmate message with winner", () => {
      const message = reasonMessages[EndReason.Checkmate]("white");
      expect(message).toContain("Checkmate");
      expect(message).toContain("White wins");
    });

    it("generates correct stalemate message", () => {
      const message = reasonMessages[EndReason.Stalemate](null);
      expect(message).toContain("stalemate");
    });

    it("generates correct threefold repetition message", () => {
      const message = reasonMessages[EndReason.Threefold](null);
      expect(message).toContain("threefold repetition");
    });

    it("generates correct insufficient material message", () => {
      const message = reasonMessages[EndReason.Insufficient](null);
      expect(message).toContain("insufficient material");
    });

    it("generates correct draw rule message", () => {
      const message = reasonMessages[EndReason.DrawRule](null);
      expect(message).toContain("fifty-move");
    });

    it("generates correct resignation message with winner", () => {
      const message = reasonMessages[EndReason.Resignation]("black");
      expect(message).toContain("Resignation");
      expect(message).toContain("Black wins");
    });

    it("generates correct draw agreement message", () => {
      const message = reasonMessages[EndReason.DrawAgreement](null);
      expect(message).toContain("Draw agreed");
    });

    it("generates correct timeout message with winner", () => {
      const message = reasonMessages[EndReason.Timeout]("white");
      expect(message).toContain("Time");
      expect(message).toContain("White wins");
    });

    it("generates correct abandonment message with winner", () => {
      const message = reasonMessages[EndReason.Abandonment]("black");
      expect(message).toContain("Forfeit");
      expect(message).toContain("Black wins");
    });

    it("capitalizes winner name correctly", () => {
      const message = reasonMessages[EndReason.Checkmate]("white");
      expect(message).toContain("White");
      expect(message).not.toContain("white wins");
    });
  });

  describe("MSG", () => {
    it("generates team vote failed message", () => {
      const msg = MSG.teamVoteFailed("resign");
      expect(msg).toContain("resign");
      expect(msg).toContain("failed");
    });

    it("generates team vote failed message with underscore type", () => {
      const msg = MSG.teamVoteFailed("offer_draw");
      expect(msg).toContain("offer draw");
      expect(msg).toContain("failed");
    });
  });

  describe("formatVoteType", () => {
    it("formats resign", () => {
      expect(formatVoteType("resign")).toBe("resign");
    });

    it("formats offer_draw", () => {
      expect(formatVoteType("offer_draw")).toBe("offer draw");
    });

    it("formats accept_draw", () => {
      expect(formatVoteType("accept_draw")).toBe("accept draw");
    });
  });
});
