import { describe, it, expect } from "vitest";
import {
  getPlayerCounts,
  shouldEndDueToAbandonment,
  filterOnlinePlayers,
  getTeamIds,
  isPlayerOnTeam,
} from "./playerLogic.js";
import type { Session } from "../types.js";

describe("playerLogic", () => {
  describe("getPlayerCounts", () => {
    it("returns zeros for empty sessions", () => {
      const sessions = new Map<string, Session>();
      const result = getPlayerCounts(sessions);

      expect(result.white).toBe(0);
      expect(result.black).toBe(0);
      expect(result.spectators).toBe(0);
    });

    it("counts players by side correctly", () => {
      const sessions = new Map<string, Session>([
        ["p1", { pid: "p1", name: "Alice", side: "white" }],
        ["p2", { pid: "p2", name: "Bob", side: "white" }],
        ["p3", { pid: "p3", name: "Charlie", side: "black" }],
        ["p4", { pid: "p4", name: "Diana", side: "spectator" }],
        ["p5", { pid: "p5", name: "Eve", side: "spectator" }],
      ]);

      const result = getPlayerCounts(sessions);

      expect(result.white).toBe(2);
      expect(result.black).toBe(1);
      expect(result.spectators).toBe(2);
    });
  });

  describe("shouldEndDueToAbandonment", () => {
    it("returns shouldEnd false when both teams have players", () => {
      const whiteIds = new Set(["p1"]);
      const blackIds = new Set(["p2"]);

      const result = shouldEndDueToAbandonment(whiteIds, blackIds);

      expect(result.shouldEnd).toBe(false);
    });

    it("returns white as winner when black is empty", () => {
      const whiteIds = new Set(["p1"]);
      const blackIds = new Set<string>();

      const result = shouldEndDueToAbandonment(whiteIds, blackIds);

      expect(result.shouldEnd).toBe(true);
      expect(result.winner).toBe("white");
    });

    it("returns black as winner when white is empty", () => {
      const whiteIds = new Set<string>();
      const blackIds = new Set(["p1"]);

      const result = shouldEndDueToAbandonment(whiteIds, blackIds);

      expect(result.shouldEnd).toBe(true);
      expect(result.winner).toBe("black");
    });

    it("returns null winner when both teams are empty", () => {
      const whiteIds = new Set<string>();
      const blackIds = new Set<string>();

      const result = shouldEndDueToAbandonment(whiteIds, blackIds);

      expect(result.shouldEnd).toBe(true);
      expect(result.winner).toBeNull();
    });
  });

  describe("filterOnlinePlayers", () => {
    it("returns empty set when no players are online", () => {
      const playerIds = new Set(["p1", "p2", "p3"]);
      const onlinePids = new Set<string>();

      const result = filterOnlinePlayers(playerIds, onlinePids);

      expect(result.size).toBe(0);
    });

    it("returns only online players", () => {
      const playerIds = new Set(["p1", "p2", "p3"]);
      const onlinePids = new Set(["p1", "p3", "p4"]);

      const result = filterOnlinePlayers(playerIds, onlinePids);

      expect(result.size).toBe(2);
      expect(result.has("p1")).toBe(true);
      expect(result.has("p3")).toBe(true);
      expect(result.has("p2")).toBe(false);
    });

    it("returns all players when all are online", () => {
      const playerIds = new Set(["p1", "p2"]);
      const onlinePids = new Set(["p1", "p2", "p3"]);

      const result = filterOnlinePlayers(playerIds, onlinePids);

      expect(result.size).toBe(2);
    });
  });

  describe("getTeamIds", () => {
    it("returns white IDs for white side", () => {
      const whiteIds = new Set(["p1", "p2"]);
      const blackIds = new Set(["p3"]);

      const result = getTeamIds("white", whiteIds, blackIds);

      expect(result).toBe(whiteIds);
      expect(result.size).toBe(2);
    });

    it("returns black IDs for black side", () => {
      const whiteIds = new Set(["p1", "p2"]);
      const blackIds = new Set(["p3"]);

      const result = getTeamIds("black", whiteIds, blackIds);

      expect(result).toBe(blackIds);
      expect(result.size).toBe(1);
    });
  });

  describe("isPlayerOnTeam", () => {
    const whiteIds = new Set(["p1", "p2"]);
    const blackIds = new Set(["p3"]);

    it("returns true for player on white team checking white", () => {
      expect(isPlayerOnTeam("p1", "white", whiteIds, blackIds)).toBe(true);
    });

    it("returns false for player not on white team checking white", () => {
      expect(isPlayerOnTeam("p3", "white", whiteIds, blackIds)).toBe(false);
    });

    it("returns true for player on black team checking black", () => {
      expect(isPlayerOnTeam("p3", "black", whiteIds, blackIds)).toBe(true);
    });

    it("returns false for spectator", () => {
      expect(isPlayerOnTeam("p4", "spectator", whiteIds, blackIds)).toBe(false);
    });

    it("returns false for player checking spectator side", () => {
      expect(isPlayerOnTeam("p1", "spectator", whiteIds, blackIds)).toBe(false);
    });
  });
});
