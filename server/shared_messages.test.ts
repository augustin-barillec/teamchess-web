import { describe, it, expect } from "vitest";
import {
  gameOverFallback,
  formatVoteType,
  VOTE_REASONS,
  MSG,
} from "./shared_messages.js";

describe("shared_messages", () => {
  describe("gameOverFallback", () => {
    it("generates fallback message with winner", () => {
      const msg = gameOverFallback("white");
      expect(msg).toContain("White");
      expect(msg).toContain("wins");
    });

    it("generates fallback message with null winner", () => {
      const msg = gameOverFallback(null);
      expect(msg).toContain("Game over");
    });
  });

  describe("MSG", () => {
    it("has a welcome message", () => {
      expect(MSG.welcomeMessage).toBeDefined();
      expect(typeof MSG.welcomeMessage).toBe("string");
      expect(MSG.welcomeMessage.length).toBeGreaterThan(0);
    });

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

  describe("VOTE_REASONS", () => {
    it("has all required reason strings", () => {
      expect(VOTE_REASONS.noValidDrawOffer).toBeDefined();
      expect(VOTE_REASONS.drawAlreadyOffered).toBeDefined();
      expect(VOTE_REASONS.voteAlreadyInProgress).toBeDefined();
      expect(VOTE_REASONS.notEligibleToVote).toBeDefined();
      expect(VOTE_REASONS.voteRejected).toBeDefined();
      expect(VOTE_REASONS.alreadyVotedYes).toBeDefined();
      expect(VOTE_REASONS.alreadyVotedNo).toBeDefined();
      expect(VOTE_REASONS.kickVoteInProgress).toBeDefined();
      expect(VOTE_REASONS.cannotKickSelf).toBeDefined();
      expect(VOTE_REASONS.resetVoteInProgress).toBeDefined();
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
