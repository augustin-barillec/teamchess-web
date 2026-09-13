import { describe, it, expect } from "vitest";
import { shouldConfirmTeamAction } from "./confirmUtils";
import type { Player } from "./types";

const player = (): Player => ({
  id: Math.random().toString(),
  name: "Player",
  side: "white",
});

describe("shouldConfirmTeamAction", () => {
  it("returns true when alone on the team", () => {
    expect(shouldConfirmTeamAction([player()])).toBe(true);
  });

  it("returns false with a teammate, since the vote then waits for them", () => {
    expect(shouldConfirmTeamAction([player(), player()])).toBe(false);
  });

  it("returns false for a bigger team", () => {
    expect(shouldConfirmTeamAction([player(), player(), player()])).toBe(false);
  });

  it("returns false for an empty team", () => {
    expect(shouldConfirmTeamAction([])).toBe(false);
  });
});
