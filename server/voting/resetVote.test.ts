import { describe, it, expect, vi } from "vitest";
import { startResetVoteLogic } from "./resetVote.js";
import { MockGameContext } from "../context/MockGameContext.js";

describe("startResetVoteLogic", () => {
  it("returns passedImmediately for a solo player", () => {
    const ctx = new MockGameContext();
    ctx.addPlayer("p1", "Alice", "white");

    const result = startResetVoteLogic("p1", "Alice", ctx);

    expect(result.passedImmediately).toBe(true);
    expect(ctx.gameState.resetVote).toBeUndefined();
  });

  it("starts a vote when 2+ players online", () => {
    const ctx = new MockGameContext();
    ctx.addPlayer("p1", "Alice", "white");
    ctx.addPlayer("p2", "Bob", "black");

    const result = startResetVoteLogic("p1", "Alice", ctx);

    expect(result.passedImmediately).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(ctx.gameState.resetVote).toBeDefined();

    clearTimeout(ctx.gameState.resetVote!.timer);
  });

  it("clears the vote and emits a failed chat_message after the 20s timeout", () => {
    vi.useFakeTimers();
    try {
      const ctx = new MockGameContext();
      ctx.addPlayer("p1", "Alice", "white");
      ctx.addPlayer("p2", "Bob", "black");
      ctx.addPlayer("p3", "Carol", "black");

      startResetVoteLogic("p1", "Alice", ctx);

      expect(ctx.gameState.resetVote).toBeDefined();

      vi.advanceTimersByTime(20_000);

      expect(ctx.gameState.resetVote).toBeUndefined();
      const chats = ctx.getEmittedData<{ message: string }>("chat_message");
      expect(
        chats.some((c) => c.message.includes("Vote to reset the game failed"))
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
