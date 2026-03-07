import { describe, it, expect } from "vitest";
import { UI } from "./messages.js";

describe("messages", () => {
  it("btnSwitchTo includes the side name", () => {
    expect(UI.btnSwitchTo("Black")).toBe("🔁 Switch to Black");
  });

  it("toastDrawOffer includes the team name", () => {
    expect(UI.toastDrawOffer("White")).toBe("Draw offer from the White team.");
  });

  it("kickVoteTooltip includes the player name", () => {
    expect(UI.kickVoteTooltip("Alice")).toBe("Vote to kick Alice");
  });
});
