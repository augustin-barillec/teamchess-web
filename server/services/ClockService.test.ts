import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClockService } from "./ClockService.js";
import { MockGameContext } from "../context/MockGameContext.js";
import { MockClock } from "../interfaces/MockClock.js";
import { GameStatus, EndReason } from "../shared_types.js";

describe("ClockService", () => {
  let context: MockGameContext;
  let clock: MockClock;
  let clockService: ClockService;

  beforeEach(() => {
    context = new MockGameContext({
      status: GameStatus.AwaitingProposals,
      whiteTime: 600,
      blackTime: 600,
      side: "white",
    });
    clock = new MockClock();
    clockService = new ClockService(context, clock);
  });

  describe("start", () => {
    it("does not start when status is not AwaitingProposals", () => {
      context.gameState.status = GameStatus.Lobby;

      clockService.start();

      expect(clock.isIntervalRunning).toBe(false);
    });

    it("starts interval when status is AwaitingProposals", () => {
      clockService.start();

      expect(clock.isIntervalRunning).toBe(true);
    });

    it("emits initial clock_update on start", () => {
      clockService.start();

      expect(context.hasEmitted("clock_update")).toBe(true);
      const data = context.getLastEmittedData<{
        whiteTime: number;
        blackTime: number;
      }>("clock_update");
      expect(data?.whiteTime).toBe(600);
      expect(data?.blackTime).toBe(600);
    });

    it("decrements white time when white is playing", () => {
      context.gameState.side = "white";
      clockService.start();
      context.clearEmittedEvents();

      clock.tick(1);

      expect(context.gameState.whiteTime).toBe(599);
      expect(context.gameState.blackTime).toBe(600);
    });

    it("decrements black time when black is playing", () => {
      context.gameState.side = "black";
      clockService.start();
      context.clearEmittedEvents();

      clock.tick(1);

      expect(context.gameState.whiteTime).toBe(600);
      expect(context.gameState.blackTime).toBe(599);
    });

    it("emits clock_update on each tick", () => {
      clockService.start();
      context.clearEmittedEvents();

      clock.tick(3);

      const updates = context.getEmittedData<{
        whiteTime: number;
        blackTime: number;
      }>("clock_update");
      expect(updates.length).toBe(3);
    });
  });

  describe("timeout", () => {
    it("calls timeout callback when white time reaches 0", () => {
      const timeoutCallback = vi.fn();
      clockService.setTimeoutCallback(timeoutCallback);
      context.gameState.whiteTime = 2;
      context.gameState.side = "white";

      clockService.start();
      clock.tick(2);

      expect(timeoutCallback).toHaveBeenCalledWith(EndReason.Timeout, "black");
    });

    it("calls timeout callback when black time reaches 0", () => {
      const timeoutCallback = vi.fn();
      clockService.setTimeoutCallback(timeoutCallback);
      context.gameState.blackTime = 1;
      context.gameState.side = "black";

      clockService.start();
      clock.tick(1);

      expect(timeoutCallback).toHaveBeenCalledWith(EndReason.Timeout, "white");
    });
  });

  describe("stop", () => {
    it("stops the interval", () => {
      clockService.start();
      expect(clock.isIntervalRunning).toBe(true);

      clockService.stop();
      expect(clock.isIntervalRunning).toBe(false);
    });

    it("prevents further time decrements after stop", () => {
      clockService.start();
      clock.tick(1);
      const timeAfterOneTick = context.gameState.whiteTime;

      clockService.stop();
      clock.tick(5);

      expect(context.gameState.whiteTime).toBe(timeAfterOneTick);
    });
  });
});
