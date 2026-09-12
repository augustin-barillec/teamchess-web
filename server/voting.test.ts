import { describe, it, expect, afterEach, vi } from "vitest";
import { GameStatus, EndReason } from "./shared_types.js";
import type { TeamVoteState } from "./shared_types.js";
import { MSG } from "./shared_messages.js";
import { TestGame } from "./testUtils.js";
import {
  getVoteClientData,
  broadcastVote,
  clearActiveVote,
  startTeamVote,
  castVote,
} from "./voting.js";

/** Frozen-electorate fixture: the pid -> name snapshot a vote carries. */
const roster = (...pids: string[]): Map<string, string> =>
  new Map(pids.map((pid) => [pid, `name-${pid}`]));

/** In-flight team vote fixture for seeding initial state. */
const teamVoteFixture = (eligible: Map<string, string>) => ({
  side: "white" as const,
  type: "resign" as const,
  yesVoters: new Set(["p1"]),
  eligibleVoters: eligible,
  required: eligible.size,
  timer: setTimeout(() => {}, 0),
  endTime: Date.now() + 20000,
});

let game: TestGame;

afterEach(() => {
  game?.cleanup();
});

describe("voting", () => {
  describe("getVoteClientData", () => {
    it("returns null when no vote is active", () => {
      game = new TestGame();
      game.addPlayer("p1", "Alice", "white");

      expect(getVoteClientData("p1")).toBeNull();
    });

    it("personalizes eligibility and current vote per viewer", () => {
      game = new TestGame({
        activeVote: teamVoteFixture(roster("p1", "p2")),
      });
      game.addPlayer("p1", "Alice", "white");
      game.addPlayer("p2", "Bob", "white");
      game.addPlayer("p3", "Charlie", "white"); // late joiner, not in electorate

      const p1Data = getVoteClientData("p1");
      const p3Data = getVoteClientData("p3");

      expect(p1Data?.myVoteEligible).toBe(true);
      expect(p1Data?.myCurrentVote).toBe("yes"); // initiator auto-voted
      expect(p3Data?.myVoteEligible).toBe(false);
      expect(p3Data?.myCurrentVote).toBeNull();
    });

    it("still names a yes voter whose session is gone", () => {
      // Alice opens the vote (auto-yes) then vanishes — she left, or was kicked.
      // Her yes still counts, so she must still be named: the electorate is frozen,
      // and names come from it rather than from the live sessions map.
      game = new TestGame();
      game.addPlayer("p1", "Alice", "white");
      game.addPlayer("p2", "Bob", "white");
      game.addPlayer("b1", "Carol", "black");

      startTeamVote("white", "resign", "p1");
      game.removePlayer("p1");

      const data = getVoteClientData("p2");

      expect(data?.yesVotes).toEqual(["Alice"]);
      expect(data?.requiredVotes).toBe(2);
    });
  });

  describe("broadcastVote", () => {
    it("sends a personalized vote_update to every connected socket", () => {
      game = new TestGame({
        activeVote: teamVoteFixture(roster("p1", "p2")),
      });
      const s1 = game.addPlayer("p1", "Alice", "white");
      game.addPlayer("p2", "Bob", "white");
      const spec = game.addPlayer("s1", "Sam", "spectator");

      broadcastVote();

      const p1Event = s1.emittedEvents.find((e) => e.event === "vote_update");
      const specEvent = spec.emittedEvents.find(
        (e) => e.event === "vote_update"
      );

      expect((p1Event!.data as TeamVoteState).myVoteEligible).toBe(true);
      // Spectators see the vote too (single shared banner) but cannot vote
      expect((specEvent!.data as TeamVoteState).myVoteEligible).toBe(false);
    });
  });

  describe("single-slot mutex", () => {
    it("rejects a second vote — even a solo auto-execute — while one is active", () => {
      game = new TestGame();
      game.addPlayer("p1", "Alice", "white"); // solo white: resign would auto-execute
      game.addPlayer("p2", "Bob", "black");
      game.addPlayer("p3", "Charlie", "black");

      startTeamVote("black", "resign", "p2");
      const result = startTeamVote("white", "resign", "p1");

      expect(result.error).toBe(MSG.errorVoteInProgress);
      // The auto-execute did not fire: no game end happened
      expect(game.hasEmitted("game_over")).toBe(false);
      expect(game.gameState.status).not.toBe(GameStatus.Over);
      expect(game.gameState.activeVote?.side).toBe("black");
    });

    it("frees the slot for a new vote once cleared", () => {
      game = new TestGame();
      game.addPlayer("p1", "Alice", "white");
      game.addPlayer("p2", "Bob", "white");
      game.addPlayer("p3", "Charlie", "black");
      game.addPlayer("p4", "Dana", "black");

      startTeamVote("black", "resign", "p3");
      clearActiveVote();

      const result = startTeamVote("white", "resign", "p1");

      expect(result.error).toBeUndefined();
      expect(game.gameState.activeVote?.side).toBe("white");
    });
  });

  describe("startTeamVote", () => {
    it("does not start accept_draw when no draw offer exists", () => {
      game = new TestGame();
      game.addPlayer("p1", "Alice", "white");
      game.addPlayer("p2", "Bob", "white");

      startTeamVote("white", "accept_draw", "p1");

      expect(game.gameState.activeVote).toBeUndefined();
    });

    it("does not start accept_draw when the offer is from the same side", () => {
      game = new TestGame({ drawOffer: "white" });
      game.addPlayer("p1", "Alice", "white");
      game.addPlayer("p2", "Bob", "white");

      startTeamVote("white", "accept_draw", "p1");

      expect(game.gameState.activeVote).toBeUndefined();
    });

    it("starts accept_draw when the offer is from the opposite side", () => {
      game = new TestGame({ drawOffer: "white" });
      game.addPlayer("p1", "Alice", "black");
      game.addPlayer("p2", "Bob", "black");

      startTeamVote("black", "accept_draw", "p1");

      expect(game.gameState.activeVote?.type).toBe("accept_draw");
    });

    it("does not start offer_draw when a draw is already offered", () => {
      game = new TestGame({ drawOffer: "black" });
      game.addPlayer("p1", "Alice", "white");
      game.addPlayer("p2", "Bob", "white");

      startTeamVote("white", "offer_draw", "p1");

      expect(game.gameState.activeVote).toBeUndefined();
    });

    it("auto-executes resign for a solo player instead of voting", () => {
      game = new TestGame({ status: GameStatus.AwaitingProposals });
      game.addPlayer("p1", "Alice", "white");
      game.addPlayer("b1", "Bob", "black");
      game.addPlayer("b2", "Carol", "black");

      startTeamVote("white", "resign", "p1");

      expect(game.gameState.activeVote).toBeUndefined();
      expect(game.gameState.status).toBe(GameStatus.Over);
      const over = game.getLastEmittedData<{ reason: string; winner: string }>(
        "game_over"
      );
      expect(over?.reason).toBe(EndReason.Resignation);
      expect(over?.winner).toBe("black");
    });

    it("does not auto-execute a system-triggered vote for a solo team", () => {
      game = new TestGame({ drawOffer: "white" });
      game.addPlayer("p1", "Alice", "black"); // solo black

      startTeamVote("black", "accept_draw", "system");

      const vote = game.gameState.activeVote;
      expect(vote?.yesVoters.size).toBe(0); // system does not auto-yes
      expect(vote?.required).toBe(1);
    });

    it("auto-votes yes for a player initiator", () => {
      game = new TestGame();
      game.addPlayer("p1", "Alice", "white");
      game.addPlayer("p2", "Bob", "white");

      startTeamVote("white", "resign", "p1");

      expect(game.gameState.activeVote?.yesVoters.has("p1")).toBe(true);
      expect(game.gameState.activeVote?.required).toBe(2);
    });
  });

  describe("castVote (unanimity)", () => {
    it("rejects a ballot from an ineligible voter", () => {
      game = new TestGame();
      game.addPlayer("p1", "Alice", "white");
      game.addPlayer("p2", "Bob", "white");
      game.addPlayer("s1", "Sam", "spectator");

      startTeamVote("white", "resign", "p1");
      const result = castVote("s1", "yes");

      expect(result.error).toBe(MSG.errorNotEligible);
      expect(game.gameState.activeVote).toBeDefined();
    });

    it("fails the vote instantly on a single no", () => {
      game = new TestGame();
      game.addPlayer("p1", "Alice", "white");
      game.addPlayer("p2", "Bob", "white");
      game.addPlayer("p3", "Carol", "white");

      startTeamVote("white", "resign", "p1");
      castVote("p2", "no");

      expect(game.gameState.activeVote).toBeUndefined();
      const chats = game.getEmittedData<{ message: string }>("chat_message");
      expect(
        chats.some((c) => c.message === MSG.teamVoteFailed("resign"))
      ).toBe(true);
    });

    it("rejects the draw offer when accept_draw is voted down", () => {
      game = new TestGame({ drawOffer: "white" });
      game.addPlayer("p1", "Alice", "black");
      game.addPlayer("p2", "Bob", "black");

      startTeamVote("black", "accept_draw", "p1");
      castVote("p2", "no");

      expect(game.gameState.drawOffer).toBeUndefined();
      const offers = game.getEmittedData<{ side: string | null }>(
        "draw_offer_update"
      );
      expect(offers.some((o) => o.side === null)).toBe(true);
    });

    it("ignores a duplicate yes (no-op)", () => {
      game = new TestGame();
      game.addPlayer("p1", "Alice", "white");
      game.addPlayer("p2", "Bob", "white");
      game.addPlayer("p3", "Carol", "white");

      startTeamVote("white", "resign", "p1");
      castVote("p1", "yes");

      expect(game.gameState.activeVote?.yesVoters.size).toBe(1);
      expect(game.gameState.activeVote).toBeDefined();
    });

    it("records a yes below the threshold without passing", () => {
      game = new TestGame();
      game.addPlayer("p1", "Alice", "white");
      game.addPlayer("p2", "Bob", "white");
      game.addPlayer("p3", "Carol", "white");

      startTeamVote("white", "resign", "p1");
      castVote("p2", "yes");

      expect(game.gameState.activeVote).toBeDefined();
      expect(game.gameState.activeVote?.yesVoters.size).toBe(2);
      expect(game.gameState.status).not.toBe(GameStatus.Over);
    });

    it("resigns the game when unanimity is reached", () => {
      game = new TestGame({ status: GameStatus.AwaitingProposals });
      game.addPlayer("p1", "Alice", "white");
      game.addPlayer("p2", "Bob", "white");
      game.addPlayer("b1", "Carl", "black");

      startTeamVote("white", "resign", "p1");
      castVote("p2", "yes");

      expect(game.gameState.activeVote).toBeUndefined();
      expect(game.gameState.status).toBe(GameStatus.Over);
      const over = game.getLastEmittedData<{ reason: string; winner: string }>(
        "game_over"
      );
      expect(over?.reason).toBe(EndReason.Resignation);
      expect(over?.winner).toBe("black");
    });

    it("chains a passed offer_draw into a system accept_draw vote for the other side", () => {
      game = new TestGame({ status: GameStatus.AwaitingProposals });
      game.addPlayer("p1", "Alice", "white");
      game.addPlayer("p2", "Bob", "white");
      game.addPlayer("b1", "Carl", "black");
      game.addPlayer("b2", "Dave", "black");

      startTeamVote("white", "offer_draw", "p1");
      castVote("p2", "yes");

      expect(game.gameState.drawOffer).toBe("white");
      const vote = game.gameState.activeVote;
      expect(vote?.type).toBe("accept_draw");
      expect(vote?.side).toBe("black");
      expect(vote?.yesVoters.size).toBe(0); // system-triggered
    });

    it("ends the game in a draw when accept_draw passes", () => {
      game = new TestGame({
        status: GameStatus.AwaitingProposals,
        drawOffer: "white",
      });
      game.addPlayer("b1", "Carl", "black");
      game.addPlayer("b2", "Dave", "black");

      startTeamVote("black", "accept_draw", "b1");
      castVote("b2", "yes");

      expect(game.gameState.status).toBe(GameStatus.Over);
      const over = game.getLastEmittedData<{ reason: string }>("game_over");
      expect(over?.reason).toBe(EndReason.DrawAgreement);
    });
  });

  describe("vote expiration", () => {
    it("clears a team vote and emits a failed chat_message after the 20s timeout", () => {
      vi.useFakeTimers();
      try {
        game = new TestGame();
        game.addPlayer("p1", "Alice", "black");
        game.addPlayer("p2", "Bob", "black");
        game.addPlayer("w1", "Charlie", "white");

        startTeamVote("black", "resign", "p1");

        expect(game.gameState.activeVote).toBeDefined();

        vi.advanceTimersByTime(20_000);

        expect(game.gameState.activeVote).toBeUndefined();
        const chats = game.getEmittedData<{ message: string }>("chat_message");
        expect(chats.some((c) => c.message.includes("failed"))).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("clears the draw offer when accept_draw vote times out", () => {
      vi.useFakeTimers();
      try {
        game = new TestGame({ drawOffer: "white" });
        game.addPlayer("p1", "Alice", "black");
        game.addPlayer("p2", "Bob", "black");

        startTeamVote("black", "accept_draw", "p1");

        expect(game.gameState.activeVote).toBeDefined();

        vi.advanceTimersByTime(20_000);

        expect(game.gameState.drawOffer).toBeUndefined();
        const offerEvents = game.getEmittedData<{ side: string | null }>(
          "draw_offer_update"
        );
        expect(offerEvents.some((e) => e.side === null)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
