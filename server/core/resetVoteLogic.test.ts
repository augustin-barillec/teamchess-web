import { describe, it, expect } from "vitest";
import {
  checkResetVotePrerequisites,
  createResetVoteState,
  processResetVote,
} from "./resetVoteLogic.js";
import { VOTE_REASONS } from "../shared_messages.js";

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
      expect(result.reason).toBe(VOTE_REASONS.resetVoteInProgress);
    });
  });

  describe("createResetVoteState", () => {
    it("sets required to strict majority (floor(N/2) + 1)", () => {
      const allPids = new Set(["p1", "p2", "p3"]);
      const result = createResetVoteState("p1", allPids);

      expect(result.required).toBe(2);
      expect(result.total).toBe(3);
    });

    it("computes majority correctly for even number of voters", () => {
      const allPids = new Set(["p1", "p2", "p3", "p4"]);
      const result = createResetVoteState("p1", allPids);

      expect(result.required).toBe(3);
      expect(result.total).toBe(4);
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
        required: 2,
        total: 3,
        ...overrides,
      };
    }

    it("rejects vote from ineligible voter", () => {
      const vote = makeVote();
      const result = processResetVote(vote, "p4", "yes");
      expect(result.passed).toBe(false);
      expect(result.failed).toBe(false);
      expect(result.reason).toBe(VOTE_REASONS.notEligibleToVote);
    });

    it("rejects duplicate yes vote", () => {
      const vote = makeVote();
      const result = processResetVote(vote, "p1", "yes");
      expect(result.reason).toBe(VOTE_REASONS.alreadyVotedYes);
    });

    it("rejects duplicate no vote", () => {
      const vote = makeVote({ noVoters: new Set(["p2"]) });
      const result = processResetVote(vote, "p2", "no");
      expect(result.reason).toBe(VOTE_REASONS.alreadyVotedNo);
    });

    it("records yes vote without passing when below threshold", () => {
      // 4 voters, required=3, p1 voted yes → p2 votes yes → 2/3 → not enough
      const vote = makeVote({
        eligibleVoters: new Set(["p1", "p2", "p3", "p4"]),
        required: 3,
        total: 4,
      });
      const result = processResetVote(vote, "p2", "yes");
      expect(result.passed).toBe(false);
      expect(result.failed).toBe(false);
      expect(result.updatedYesVoters?.size).toBe(2);
      expect(result.updatedYesVoters?.has("p2")).toBe(true);
    });

    it("passes vote when majority reached", () => {
      const vote = makeVote(); // p1 voted yes, required=2
      const result = processResetVote(vote, "p2", "yes");
      expect(result.passed).toBe(true);
      expect(result.failed).toBe(false);
      expect(result.updatedYesVoters?.size).toBe(2);
    });

    it("does not fail on a single no vote when majority is still possible", () => {
      const vote = makeVote(); // 3 voters, required=2, p1 voted yes
      const result = processResetVote(vote, "p2", "no");
      expect(result.passed).toBe(false);
      expect(result.failed).toBe(false);
      expect(result.updatedNoVoters?.has("p2")).toBe(true);
    });

    it("fails when too many no votes make passing impossible", () => {
      const vote = makeVote({
        noVoters: new Set(["p2"]),
      }); // 3 voters, required=2, p2 already voted no
      const result = processResetVote(vote, "p3", "no");
      expect(result.passed).toBe(false);
      expect(result.failed).toBe(true);
      expect(result.updatedNoVoters?.size).toBe(2);
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

    it("allows switching from yes to no", () => {
      const vote = makeVote({
        yesVoters: new Set(["p1", "p2"]),
      });
      const result = processResetVote(vote, "p2", "no");
      expect(result.passed).toBe(false);
      expect(result.failed).toBe(false);
      expect(result.updatedYesVoters?.has("p2")).toBe(false);
      expect(result.updatedNoVoters?.has("p2")).toBe(true);
    });

    it("allows switching from no to yes", () => {
      // 4 voters, required=3, p1 voted yes, p2 voted no → p2 switches to yes → 2/3 → not pass yet
      const vote = makeVote({
        eligibleVoters: new Set(["p1", "p2", "p3", "p4"]),
        required: 3,
        total: 4,
        noVoters: new Set(["p2"]),
      });
      const result = processResetVote(vote, "p2", "yes");
      expect(result.passed).toBe(false);
      expect(result.failed).toBe(false);
      expect(result.updatedYesVoters?.has("p2")).toBe(true);
      expect(result.updatedNoVoters?.has("p2")).toBe(false);
    });

    it("switching from no to yes can trigger pass", () => {
      // p1 voted yes; p2 voted no → p2 switches to yes → 2/3 → pass
      const vote = makeVote({
        yesVoters: new Set(["p1"]),
        noVoters: new Set(["p2"]),
      });
      const result = processResetVote(vote, "p2", "yes");
      expect(result.passed).toBe(true);
      expect(result.updatedYesVoters?.size).toBe(2);
      expect(result.updatedNoVoters?.size).toBe(0);
    });
  });
});
