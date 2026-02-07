import { describe, it, expect } from "vitest";
import {
  checkResetVotePrerequisites,
  createResetVoteState,
  processResetVote,
} from "./resetVoteLogic.js";

describe("resetVoteLogic", () => {
  describe("checkResetVotePrerequisites", () => {
    it("allows reset vote when no vote in progress", () => {
      const result = checkResetVotePrerequisites(undefined);
      expect(result.canStart).toBe(true);
    });

    it("rejects when a reset vote is already in progress", () => {
      const existingVote = {
        initiatorId: "p1",
        yesVoters: new Set(["p1"]),
        noVoters: new Set<string>(),
        eligibleVoters: new Set(["p1", "p2"]),
        required: 2,
        total: 2,
      };

      const result = checkResetVotePrerequisites(existingVote);
      expect(result.canStart).toBe(false);
      expect(result.reason).toBe("A reset vote is already in progress");
    });
  });

  describe("createResetVoteState", () => {
    it("sets required to total eligible voters (unanimous)", () => {
      const allPids = new Set(["p1", "p2", "p3"]);
      const result = createResetVoteState("p1", allPids);

      expect(result.required).toBe(3);
      expect(result.total).toBe(3);
    });

    it("includes all connected PIDs as eligible", () => {
      const allPids = new Set(["p1", "p2", "p3"]);
      const result = createResetVoteState("p1", allPids);

      expect(result.eligibleVoters.size).toBe(3);
      expect(result.eligibleVoters.has("p1")).toBe(true);
      expect(result.eligibleVoters.has("p2")).toBe(true);
      expect(result.eligibleVoters.has("p3")).toBe(true);
    });

    it("auto-votes yes for initiator", () => {
      const allPids = new Set(["p1", "p2", "p3"]);
      const result = createResetVoteState("p1", allPids);

      expect(result.yesVoters.has("p1")).toBe(true);
      expect(result.yesVoters.size).toBe(1);
    });

    it("initializes noVoters as empty", () => {
      const allPids = new Set(["p1", "p2", "p3"]);
      const result = createResetVoteState("p1", allPids);

      expect(result.noVoters.size).toBe(0);
    });

    it("creates independent copies (mutation safety)", () => {
      const allPids = new Set(["p1", "p2"]);
      const result = createResetVoteState("p1", allPids);

      allPids.add("p3");
      expect(result.eligibleVoters.size).toBe(2);
    });

    it("passes immediately when initiator is the only connected user", () => {
      const allPids = new Set(["p1"]);
      const result = createResetVoteState("p1", allPids);

      expect(result.required).toBe(1);
      expect(result.yesVoters.size).toBe(1);
      // The caller checks yesVoters.size >= required
      expect(result.yesVoters.size >= result.required).toBe(true);
    });
  });

  describe("processResetVote", () => {
    function makeVote(
      overrides?: Partial<ReturnType<typeof createResetVoteState>>
    ) {
      return {
        initiatorId: "p1",
        yesVoters: new Set(["p1"]),
        noVoters: new Set<string>(),
        eligibleVoters: new Set(["p1", "p2", "p3"]),
        required: 3,
        total: 3,
        ...overrides,
      };
    }

    it("rejects vote from ineligible voter", () => {
      const vote = makeVote();
      const result = processResetVote(vote, "p4", "yes");
      expect(result.passed).toBe(false);
      expect(result.failed).toBe(false);
      expect(result.reason).toBe("Not eligible to vote");
    });

    it("rejects duplicate yes vote", () => {
      const vote = makeVote();
      const result = processResetVote(vote, "p1", "yes");
      expect(result.reason).toBe("Already voted yes");
    });

    it("rejects duplicate no vote", () => {
      const vote = makeVote({ noVoters: new Set(["p2"]) });
      const result = processResetVote(vote, "p2", "no");
      expect(result.reason).toBe("Already voted no");
    });

    it("records yes vote without passing when below threshold", () => {
      const vote = makeVote();
      const result = processResetVote(vote, "p2", "yes");
      expect(result.passed).toBe(false);
      expect(result.failed).toBe(false);
      expect(result.updatedYesVoters?.size).toBe(2);
      expect(result.updatedYesVoters?.has("p2")).toBe(true);
    });

    it("passes vote when all voters say yes", () => {
      const vote = makeVote({
        yesVoters: new Set(["p1", "p2"]),
      });
      const result = processResetVote(vote, "p3", "yes");
      expect(result.passed).toBe(true);
      expect(result.failed).toBe(false);
      expect(result.updatedYesVoters?.size).toBe(3);
    });

    it("fails immediately on any no vote", () => {
      const vote = makeVote();
      const result = processResetVote(vote, "p2", "no");
      expect(result.passed).toBe(false);
      expect(result.failed).toBe(true);
      expect(result.updatedNoVoters?.has("p2")).toBe(true);
    });

    it("does not mutate original vote state", () => {
      const originalYesVoters = new Set(["p1"]);
      const originalNoVoters = new Set<string>();
      const vote = makeVote({
        yesVoters: originalYesVoters,
        noVoters: originalNoVoters,
      });

      processResetVote(vote, "p2", "yes");
      expect(originalYesVoters.size).toBe(1);
      expect(originalNoVoters.size).toBe(0);
    });

    it("allows switching from yes to no (fails immediately)", () => {
      const vote = makeVote({
        yesVoters: new Set(["p1", "p2"]),
      });
      const result = processResetVote(vote, "p2", "no");
      expect(result.passed).toBe(false);
      expect(result.failed).toBe(true);
      expect(result.updatedYesVoters?.has("p2")).toBe(false);
      expect(result.updatedNoVoters?.has("p2")).toBe(true);
    });

    it("allows switching from no to yes", () => {
      const vote = makeVote({
        noVoters: new Set(["p2"]),
      });
      const result = processResetVote(vote, "p2", "yes");
      expect(result.passed).toBe(false);
      expect(result.failed).toBe(false);
      expect(result.updatedYesVoters?.has("p2")).toBe(true);
      expect(result.updatedNoVoters?.has("p2")).toBe(false);
    });

    it("switching from no to yes can trigger pass", () => {
      // p1, p3 voted yes; p2 voted no → p2 switches to yes → 3/3 → pass
      const vote = makeVote({
        yesVoters: new Set(["p1", "p3"]),
        noVoters: new Set(["p2"]),
      });
      const result = processResetVote(vote, "p2", "yes");
      expect(result.passed).toBe(true);
      expect(result.updatedYesVoters?.size).toBe(3);
      expect(result.updatedNoVoters?.size).toBe(0);
    });
  });
});
