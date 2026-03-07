import { describe, it, expect } from "vitest";
import {
  shouldConfirmTeamAction,
  shouldConfirmResetGame,
} from "./confirmUtils";
import type { Player } from "./types";

const player = (connected: boolean): Player => ({
  id: Math.random().toString(),
  name: "Player",
  connected,
});

describe("shouldConfirmTeamAction", () => {
  it("returns true when solo connected player", () => {
    expect(shouldConfirmTeamAction([player(true)])).toBe(true);
  });

  it("returns false when 2 connected players", () => {
    expect(shouldConfirmTeamAction([player(true), player(true)])).toBe(false);
  });

  it("returns true when 1 connected + 1 disconnected (ad264df regression)", () => {
    expect(shouldConfirmTeamAction([player(true), player(false)])).toBe(true);
  });

  it("returns true when 3 players but only 1 connected", () => {
    expect(
      shouldConfirmTeamAction([player(true), player(false), player(false)])
    ).toBe(true);
  });

  it("returns false when 0 connected players", () => {
    expect(shouldConfirmTeamAction([player(false), player(false)])).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(shouldConfirmTeamAction([])).toBe(false);
  });
});

describe("shouldConfirmResetGame", () => {
  it("returns true when solo connected player", () => {
    expect(shouldConfirmResetGame([player(true)])).toBe(true);
  });

  it("returns false when 2 connected players", () => {
    expect(shouldConfirmResetGame([player(true), player(true)])).toBe(false);
  });

  it("returns true when 1 connected + 1 disconnected (ad264df regression)", () => {
    expect(shouldConfirmResetGame([player(true), player(false)])).toBe(true);
  });

  it("returns false when 0 connected players", () => {
    expect(shouldConfirmResetGame([player(false)])).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(shouldConfirmResetGame([])).toBe(false);
  });
});
