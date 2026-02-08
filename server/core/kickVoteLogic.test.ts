import { describe, it, expect } from "vitest";
import {
  checkKickVotePrerequisites,
  createKickVoteState,
  processKickVote,
} from "./kickVoteLogic.js";
import { VOTE_REASONS } from "../shared_messages.js";

describe("kickVoteLogic", () => {
  describe("checkKickVotePrerequisites", () => {
    it("allows kick vote when no vote in progress", () => {
      const result = checkKickVotePrerequisites(undefined, "p1", "p2");
      expect(result.canStart).toBe(true);
    });

    it("rejects when a kick vote is already in progress", () => {
      const existingVote = {
        targetId: "p3",
        initiatorId: "p1",
        yesVoters: new Set(["p1"]),
        noVoters: new Set<string>(),
        eligibleVoters: new Set(["p1", "p2"]),
        required: 2,
        total: 3,
      };

      const result = checkKickVotePrerequisites(existingVote, "p2", "p4");
      expect(result.canStart).toBe(false);
      expect(result.reason).toBe(VOTE_REASONS.kickVoteInProgress);
    });

    it("rejects self-kick", () => {
      const result = checkKickVotePrerequisites(undefined, "p1", "p1");
      expect(result.canStart).toBe(false);
      expect(result.reason).toBe(VOTE_REASONS.cannotKickSelf);
    });
  });

  describe("createKickVoteState", () => {
    it("calculates strict majority threshold for odd N", () => {
      // N=5 → threshold = floor(5/2) + 1 = 3
      const allPids = new Set(["p1", "p2", "p3", "p4", "p5"]);
      const result = createKickVoteState("p5", "p1", allPids);

      expect(result.required).toBe(3);
      expect(result.total).toBe(5);
    });

    it("calculates strict majority threshold for even N", () => {
      // N=4 → threshold = floor(4/2) + 1 = 3
      const allPids = new Set(["p1", "p2", "p3", "p4"]);
      const result = createKickVoteState("p4", "p1", allPids);

      expect(result.required).toBe(3);
      expect(result.total).toBe(4);
    });

    it("calculates threshold for N=2", () => {
      // N=2 → threshold = floor(2/2) + 1 = 2
      const allPids = new Set(["p1", "p2"]);
      const result = createKickVoteState("p2", "p1", allPids);

      expect(result.required).toBe(2);
      expect(result.total).toBe(2);
    });

    it("calculates threshold for N=3", () => {
      // N=3 → threshold = floor(3/2) + 1 = 2
      const allPids = new Set(["p1", "p2", "p3"]);
      const result = createKickVoteState("p3", "p1", allPids);

      expect(result.required).toBe(2);
      expect(result.total).toBe(3);
    });

    it("excludes target from eligible voters", () => {
      const allPids = new Set(["p1", "p2", "p3"]);
      const result = createKickVoteState("p3", "p1", allPids);

      expect(result.eligibleVoters.has("p3")).toBe(false);
      expect(result.eligibleVoters.has("p1")).toBe(true);
      expect(result.eligibleVoters.has("p2")).toBe(true);
      expect(result.eligibleVoters.size).toBe(2);
    });

    it("auto-votes yes for initiator", () => {
      const allPids = new Set(["p1", "p2", "p3"]);
      const result = createKickVoteState("p3", "p1", allPids);

      expect(result.yesVoters.has("p1")).toBe(true);
      expect(result.yesVoters.size).toBe(1);
    });

    it("initializes noVoters as empty", () => {
      const allPids = new Set(["p1", "p2", "p3"]);
      const result = createKickVoteState("p3", "p1", allPids);

      expect(result.noVoters.size).toBe(0);
    });

    it("target contributes to total N but not eligible", () => {
      const allPids = new Set(["p1", "p2", "p3"]);
      const result = createKickVoteState("p3", "p1", allPids);

      expect(result.total).toBe(3);
      expect(result.eligibleVoters.size).toBe(2);
    });

    it("creates independent copy of eligible voters", () => {
      const allPids = new Set(["p1", "p2", "p3"]);
      const result = createKickVoteState("p3", "p1", allPids);

      allPids.add("p4");
      expect(result.eligibleVoters.size).toBe(2);
    });
  });

  describe("processKickVote", () => {
    function makeVote(
      overrides?: Partial<ReturnType<typeof createKickVoteState>>
    ) {
      return {
        targetId: "p5",
        initiatorId: "p1",
        yesVoters: new Set(["p1"]),
        noVoters: new Set<string>(),
        eligibleVoters: new Set(["p1", "p2", "p3", "p4"]),
        required: 3,
        total: 5,
        ...overrides,
      };
    }

    it("rejects vote from ineligible voter", () => {
      const vote = makeVote();
      const result = processKickVote(vote, "p6", "yes");
      expect(result.passed).toBe(false);
      expect(result.failed).toBe(false);
      expect(result.reason).toBe(VOTE_REASONS.notEligibleToVote);
    });

    it("rejects vote from target player", () => {
      const vote = makeVote();
      const result = processKickVote(vote, "p5", "yes");
      expect(result.reason).toBe(VOTE_REASONS.notEligibleToVote);
    });

    it("rejects duplicate yes vote", () => {
      const vote = makeVote();
      const result = processKickVote(vote, "p1", "yes");
      expect(result.reason).toBe(VOTE_REASONS.alreadyVotedYes);
    });

    it("rejects duplicate no vote", () => {
      const vote = makeVote({ noVoters: new Set(["p2"]) });
      const result = processKickVote(vote, "p2", "no");
      expect(result.reason).toBe(VOTE_REASONS.alreadyVotedNo);
    });

    it("records yes vote without passing when below threshold", () => {
      const vote = makeVote();
      const result = processKickVote(vote, "p2", "yes");
      expect(result.passed).toBe(false);
      expect(result.failed).toBe(false);
      expect(result.updatedYesVoters?.size).toBe(2);
      expect(result.updatedYesVoters?.has("p2")).toBe(true);
    });

    it("records no vote", () => {
      const vote = makeVote();
      const result = processKickVote(vote, "p2", "no");
      expect(result.passed).toBe(false);
      expect(result.failed).toBe(false);
      expect(result.updatedNoVoters?.size).toBe(1);
      expect(result.updatedNoVoters?.has("p2")).toBe(true);
    });

    it("passes vote when threshold reached", () => {
      const vote = makeVote({
        yesVoters: new Set(["p1", "p2"]),
      });
      const result = processKickVote(vote, "p3", "yes");
      expect(result.passed).toBe(true);
      expect(result.failed).toBe(false);
      expect(result.updatedYesVoters?.size).toBe(3);
    });

    it("allows switching from no to yes", () => {
      const vote = makeVote({
        noVoters: new Set(["p2"]),
      });
      const result = processKickVote(vote, "p2", "yes");
      expect(result.passed).toBe(false);
      expect(result.failed).toBe(false);
      expect(result.updatedYesVoters?.has("p2")).toBe(true);
      expect(result.updatedNoVoters?.has("p2")).toBe(false);
    });

    it("allows switching from yes to no", () => {
      const vote = makeVote({
        yesVoters: new Set(["p1", "p2"]),
      });
      const result = processKickVote(vote, "p2", "no");
      expect(result.passed).toBe(false);
      expect(result.updatedYesVoters?.has("p2")).toBe(false);
      expect(result.updatedNoVoters?.has("p2")).toBe(true);
    });

    it("switching from no to yes can trigger pass", () => {
      // N=5, required=3, eligible=4 (p1,p2,p3,p4)
      // p1,p3 voted yes; p2 voted no → p2 switches to yes → 3 yes → pass
      const vote = makeVote({
        yesVoters: new Set(["p1", "p3"]),
        noVoters: new Set(["p2"]),
      });
      const result = processKickVote(vote, "p2", "yes");
      expect(result.passed).toBe(true);
      expect(result.updatedYesVoters?.size).toBe(3);
      expect(result.updatedNoVoters?.size).toBe(0);
    });

    it("fails early when too many no votes make passing impossible", () => {
      // N=5, required=3, eligible=4 (p1,p2,p3,p4)
      // p1 yes, p2 no → p3 votes no → 2 no voters
      // maxPossibleYes = 4 - 2 = 2 < 3 → fail
      const vote = makeVote({
        noVoters: new Set(["p2"]),
      });
      const result = processKickVote(vote, "p3", "no");
      expect(result.passed).toBe(false);
      expect(result.failed).toBe(true);
    });

    it("does not fail early when passing is still possible", () => {
      // N=5, required=3, eligible=4 (p1,p2,p3,p4)
      // p1 yes → p2 votes no → 1 no voter
      // maxPossibleYes = 4 - 1 = 3 >= 3 → still possible
      const vote = makeVote();
      const result = processKickVote(vote, "p2", "no");
      expect(result.passed).toBe(false);
      expect(result.failed).toBe(false);
    });

    it("switching from yes to no can trigger fail", () => {
      // N=5, required=3, eligible=4 (p1,p2,p3,p4)
      // p1 yes, p2 no → p1 switches to no → 2 no, 0 yes
      // maxPossibleYes = 4 - 2 = 2 < 3 → fail
      const vote = makeVote({
        noVoters: new Set(["p2"]),
      });
      const result = processKickVote(vote, "p1", "no");
      expect(result.passed).toBe(false);
      expect(result.failed).toBe(true);
      expect(result.updatedYesVoters?.size).toBe(0);
      expect(result.updatedNoVoters?.size).toBe(2);
    });

    it("does not mutate original vote state", () => {
      const originalYesVoters = new Set(["p1"]);
      const originalNoVoters = new Set<string>();
      const vote = makeVote({
        yesVoters: originalYesVoters,
        noVoters: originalNoVoters,
      });

      processKickVote(vote, "p2", "yes");
      expect(originalYesVoters.size).toBe(1);
      expect(originalNoVoters.size).toBe(0);
    });
  });
});
