import { describe, it, expect } from "vitest";
import {
  checkVotePrerequisites,
  processVote,
  createVoteState,
  formatVoteType,
} from "./voteLogic.js";

describe("voteLogic", () => {
  describe("checkVotePrerequisites", () => {
    it("rejects accept_draw when no draw offer exists", () => {
      const result = checkVotePrerequisites(
        "accept_draw",
        3,
        false,
        undefined,
        undefined,
        "white"
      );

      expect(result.canStartVote).toBe(false);
      expect(result.shouldAutoExecute).toBe(false);
      expect(result.reason).toBe("No valid draw offer");
    });

    it("rejects accept_draw when offer is from same side", () => {
      const result = checkVotePrerequisites(
        "accept_draw",
        3,
        false,
        undefined,
        "white", // white offered
        "white" // white trying to accept
      );

      expect(result.canStartVote).toBe(false);
      expect(result.shouldAutoExecute).toBe(false);
    });

    it("allows accept_draw when offer is from opposite side", () => {
      const result = checkVotePrerequisites(
        "accept_draw",
        3,
        false,
        undefined,
        "white", // white offered
        "black" // black trying to accept
      );

      expect(result.canStartVote).toBe(true);
      expect(result.shouldAutoExecute).toBe(false);
    });

    it("rejects offer_draw when draw already offered", () => {
      const result = checkVotePrerequisites(
        "offer_draw",
        3,
        false,
        undefined,
        "black",
        "white"
      );

      expect(result.canStartVote).toBe(false);
      expect(result.reason).toBe("Draw already offered");
    });

    it("rejects when vote already in progress", () => {
      const existingVote = {
        type: "resign" as const,
        initiatorId: "p1",
        yesVoters: new Set(["p1"]),
        eligibleVoters: new Set(["p1", "p2"]),
        required: 2,
      };

      const result = checkVotePrerequisites(
        "resign",
        3,
        false,
        existingVote,
        undefined,
        "white"
      );

      expect(result.canStartVote).toBe(false);
      expect(result.reason).toBe("Vote already in progress");
    });

    it("auto-executes for single player when not system triggered", () => {
      const result = checkVotePrerequisites(
        "resign",
        1,
        false,
        undefined,
        undefined,
        "white"
      );

      expect(result.shouldAutoExecute).toBe(true);
      expect(result.canStartVote).toBe(false);
    });

    it("does not auto-execute when system triggered", () => {
      const result = checkVotePrerequisites(
        "accept_draw",
        1,
        true, // system triggered
        undefined,
        "white",
        "black"
      );

      expect(result.shouldAutoExecute).toBe(false);
      expect(result.canStartVote).toBe(true);
    });

    it("allows vote when all prerequisites met", () => {
      const result = checkVotePrerequisites(
        "resign",
        3,
        false,
        undefined,
        undefined,
        "white"
      );

      expect(result.canStartVote).toBe(true);
      expect(result.shouldAutoExecute).toBe(false);
    });
  });

  describe("processVote", () => {
    it("rejects vote from ineligible voter", () => {
      const vote = {
        type: "resign" as const,
        initiatorId: "p1",
        yesVoters: new Set(["p1"]),
        eligibleVoters: new Set(["p1", "p2"]),
        required: 2,
      };

      const result = processVote(vote, "p3", "yes"); // p3 not eligible

      expect(result.passed).toBe(false);
      expect(result.failed).toBe(false);
      expect(result.reason).toBe("Not eligible to vote");
    });

    it("fails vote when player votes no", () => {
      const vote = {
        type: "resign" as const,
        initiatorId: "p1",
        yesVoters: new Set(["p1"]),
        eligibleVoters: new Set(["p1", "p2"]),
        required: 2,
      };

      const result = processVote(vote, "p2", "no");

      expect(result.passed).toBe(false);
      expect(result.failed).toBe(true);
      expect(result.reason).toBe("Vote rejected");
    });

    it("records yes vote without passing when below threshold", () => {
      const vote = {
        type: "resign" as const,
        initiatorId: "p1",
        yesVoters: new Set(["p1"]),
        eligibleVoters: new Set(["p1", "p2", "p3"]),
        required: 3,
      };

      const result = processVote(vote, "p2", "yes");

      expect(result.passed).toBe(false);
      expect(result.failed).toBe(false);
      expect(result.updatedYesVoters?.size).toBe(2);
      expect(result.updatedYesVoters?.has("p2")).toBe(true);
    });

    it("passes vote when threshold reached", () => {
      const vote = {
        type: "resign" as const,
        initiatorId: "p1",
        yesVoters: new Set(["p1"]),
        eligibleVoters: new Set(["p1", "p2"]),
        required: 2,
      };

      const result = processVote(vote, "p2", "yes");

      expect(result.passed).toBe(true);
      expect(result.failed).toBe(false);
      expect(result.updatedYesVoters?.size).toBe(2);
    });

    it("does not mutate original vote state", () => {
      const originalYesVoters = new Set(["p1"]);
      const vote = {
        type: "resign" as const,
        initiatorId: "p1",
        yesVoters: originalYesVoters,
        eligibleVoters: new Set(["p1", "p2"]),
        required: 2,
      };

      processVote(vote, "p2", "yes");

      expect(originalYesVoters.size).toBe(1); // Original not modified
      expect(vote.yesVoters.size).toBe(1);
    });
  });

  describe("createVoteState", () => {
    it("creates vote state with initiator yes vote when player triggered", () => {
      const eligible = new Set(["p1", "p2", "p3"]);
      const result = createVoteState("resign", "p1", eligible, false);

      expect(result.type).toBe("resign");
      expect(result.initiatorId).toBe("p1");
      expect(result.yesVoters.size).toBe(1);
      expect(result.yesVoters.has("p1")).toBe(true);
      expect(result.eligibleVoters.size).toBe(3);
      expect(result.required).toBe(3);
    });

    it("creates vote state with no initial yes votes when system triggered", () => {
      const eligible = new Set(["p1", "p2", "p3"]);
      const result = createVoteState("accept_draw", "system", eligible, true);

      expect(result.yesVoters.size).toBe(0);
      expect(result.initiatorId).toBe("system");
    });

    it("creates independent copy of eligible voters", () => {
      const eligible = new Set(["p1", "p2"]);
      const result = createVoteState("resign", "p1", eligible, false);

      eligible.add("p3"); // Modify original

      expect(result.eligibleVoters.size).toBe(2); // Copy not affected
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
