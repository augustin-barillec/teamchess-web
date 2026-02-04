import { test, expect } from "@playwright/test";

test.describe("TeamChess App", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for the app to fully load
    await page.waitForSelector(".app-container");
  });

  test("should load the application and display the chessboard", async ({
    page,
  }) => {
    // Check that the app container is visible
    await expect(page.locator(".app-container")).toBeVisible();

    // Check that the chessboard is rendered
    await expect(page.locator(".board-wrapper")).toBeVisible();
  });

  test("should display all panels on desktop", async ({ page }) => {
    // On desktop (>900px), all panels are visible side by side
    await expect(page.locator(".players-panel")).toBeVisible();
    await expect(page.locator(".moves-panel")).toBeVisible();
    await expect(page.locator(".chat-panel")).toBeVisible();
    await expect(page.locator(".controls-panel")).toBeVisible();
  });

  test("should display player lists in players panel", async ({ page }) => {
    const playersPanel = page.locator(".players-panel");
    await expect(playersPanel).toBeVisible();

    // Check for team headers
    await expect(playersPanel.locator("text=White")).toBeVisible();
    await expect(playersPanel.locator("text=Black")).toBeVisible();
  });

  test("should display clock boxes", async ({ page }) => {
    // There should be clock elements for both players
    const clockBoxes = page.locator(".clock-box");
    await expect(clockBoxes.first()).toBeVisible();
  });

  test("should have controls panel with game options", async ({ page }) => {
    const controlsPanel = page.locator(".controls-panel");
    await expect(controlsPanel).toBeVisible();

    // Should have Controls header
    await expect(
      controlsPanel.locator('h3:has-text("Controls")')
    ).toBeVisible();
  });

  test("should display chat panel with input", async ({ page }) => {
    const chatPanel = page.locator(".chat-panel");
    await expect(chatPanel).toBeVisible();

    // Chat should have an input field
    const chatInput = chatPanel.locator('input[type="text"]');
    await expect(chatInput).toBeVisible();
  });
});

test.describe("TeamChess Game Interactions", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".app-container");
  });

  test("should allow typing in chat", async ({ page }) => {
    const chatInput = page.locator('.chat-panel input[type="text"]');
    await chatInput.fill("Hello, team!");
    await expect(chatInput).toHaveValue("Hello, team!");
  });

  test("should have team join buttons available", async ({ page }) => {
    const controlsPanel = page.locator(".controls-panel");

    // Look for join/team related buttons
    const hasTeamButtons = await controlsPanel.locator("button").count();
    expect(hasTeamButtons).toBeGreaterThan(0);
  });
});
