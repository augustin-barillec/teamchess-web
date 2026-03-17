import { describe, it, expect } from "vitest";
import { getTeamVoteClientData, broadcastTeamVote } from "./teamVote.js";
import { MockGameContext } from "../context/MockGameContext.js";

describe("teamVote", () => {
  describe("getTeamVoteClientData", () => {
    it("returns myVoteEligible false when no active vote", () => {
      const ctx = new MockGameContext();
      ctx.addPlayer("p1", "Alice", "white");

      const data = getTeamVoteClientData("white", "p1", ctx);

      expect(data.isActive).toBe(false);
      expect(data.myVoteEligible).toBe(false);
    });

    it("returns myVoteEligible true for eligible voter", () => {
      const ctx = new MockGameContext({
        whiteVote: {
          type: "resign",
          initiatorId: "p1",
          yesVoters: new Set(["p1"]),
          eligibleVoters: new Set(["p1", "p2"]),
          required: 2,
          timer: setTimeout(() => {}, 0),
          endTime: Date.now() + 20000,
        },
      });
      ctx.addPlayer("p1", "Alice", "white");
      ctx.addPlayer("p2", "Bob", "white");

      const data = getTeamVoteClientData("white", "p1", ctx);

      expect(data.isActive).toBe(true);
      expect(data.myVoteEligible).toBe(true);

      clearTimeout(ctx.gameState.whiteVote!.timer);
    });

    it("returns myVoteEligible false for late joiner (ineligible voter)", () => {
      const ctx = new MockGameContext({
        whiteVote: {
          type: "resign",
          initiatorId: "p1",
          yesVoters: new Set(["p1"]),
          eligibleVoters: new Set(["p1", "p2"]),
          required: 2,
          timer: setTimeout(() => {}, 0),
          endTime: Date.now() + 20000,
        },
      });
      ctx.addPlayer("p1", "Alice", "white");
      ctx.addPlayer("p2", "Bob", "white");
      ctx.addPlayer("p3", "Charlie", "white");

      const data = getTeamVoteClientData("white", "p3", ctx);

      expect(data.isActive).toBe(true);
      expect(data.myVoteEligible).toBe(false);

      clearTimeout(ctx.gameState.whiteVote!.timer);
    });
  });

  describe("broadcastTeamVote", () => {
    it("sends personalized myVoteEligible per socket", () => {
      const ctx = new MockGameContext({
        whiteVote: {
          type: "resign",
          initiatorId: "p1",
          yesVoters: new Set(["p1"]),
          eligibleVoters: new Set(["p1", "p2"]),
          required: 2,
          timer: setTimeout(() => {}, 0),
          endTime: Date.now() + 20000,
        },
      });
      const s1 = ctx.addPlayer("p1", "Alice", "white");
      ctx.addPlayer("p2", "Bob", "white");
      const s3 = ctx.addPlayer("p3", "Charlie", "white");

      broadcastTeamVote("white", ctx);

      const p1Event = s1.emittedEvents.find(
        (e) => e.event === "team_vote_update"
      );
      const p3Event = s3.emittedEvents.find(
        (e) => e.event === "team_vote_update"
      );

      expect(p1Event).toBeDefined();
      expect(
        (p1Event!.data as { myVoteEligible: boolean }).myVoteEligible
      ).toBe(true);

      expect(p3Event).toBeDefined();
      expect(
        (p3Event!.data as { myVoteEligible: boolean }).myVoteEligible
      ).toBe(false);

      clearTimeout(ctx.gameState.whiteVote!.timer);
    });
  });
});
