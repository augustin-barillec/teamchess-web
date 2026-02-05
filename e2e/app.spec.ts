import { test, expect } from "@playwright/test";

test("three players join and make moves, stockfish selects best move", async ({
  browser,
}) => {
  // Create 3 browser contexts for 3 players with video recording
  const videoDir = "test-results/multiplayer-videos";
  const context1 = await browser.newContext({
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  });
  const context2 = await browser.newContext({
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  });
  const context3 = await browser.newContext({
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  });

  const player1 = await context1.newPage();
  const player2 = await context2.newPage();
  const player3 = await context3.newPage();

  // All players join the website
  await player1.goto("/");
  await player2.goto("/");
  await player3.goto("/");

  // Wait for app to load for all players
  await player1.waitForSelector(".app-container");
  await player2.waitForSelector(".app-container");
  await player3.waitForSelector(".app-container");

  // Player 1 joins White team
  await player1.click('button:has-text("Join White")');
  await player1.waitForTimeout(500);

  // Player 2 joins Black team
  await player2.click('button:has-text("Join Black")');
  await player2.waitForTimeout(500);

  // Player 3 joins Black team
  await player3.click('button:has-text("Join Black")');
  await player3.waitForTimeout(500);

  // Helper function for drag and drop move
  async function makeMove(
    page: import("@playwright/test").Page,
    from: string,
    to: string
  ) {
    const fromSquare = page.locator(`[data-square="${from}"]`);
    const toSquare = page.locator(`[data-square="${to}"]`);

    // Get bounding boxes for precise drag
    const fromBox = await fromSquare.boundingBox();
    const toBox = await toSquare.boundingBox();

    if (!fromBox || !toBox) {
      throw new Error(`Could not find squares ${from} or ${to}`);
    }

    // Drag from center of source to center of target
    await page.mouse.move(
      fromBox.x + fromBox.width / 2,
      fromBox.y + fromBox.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      toBox.x + toBox.width / 2,
      toBox.y + toBox.height / 2,
      { steps: 5 }
    );
    await page.mouse.up();
  }

  // Player 1 (White) plays e2-e4
  await makeMove(player1, "e2", "e4");
  await player1.waitForTimeout(1000);

  // Assert: After white's turn, e4 has a white pawn and e2 is empty
  await expect(
    player1.locator('[data-square="e4"] [data-piece="wP"]')
  ).toBeVisible();
  await expect(
    player1.locator('[data-square="e2"] [data-piece]')
  ).not.toBeVisible();

  // Player 2 (Black) proposes e7-e5 (good move)
  await makeMove(player2, "e7", "e5");
  await player2.waitForTimeout(500);

  // Player 3 (Black) proposes b8-a6 (bad move)
  await makeMove(player3, "b8", "a6");
  await player3.waitForTimeout(500);

  // Wait for Stockfish to evaluate and select the best move (e7-e5)
  await player1.waitForTimeout(3000);

  // Assert: After black's turn, e5 has a black pawn and e7 is empty
  // (Stockfish should have selected e7-e5 as the best move)
  await expect(
    player1.locator('[data-square="e5"] [data-piece="bP"]')
  ).toBeVisible();
  await expect(
    player1.locator('[data-square="e7"] [data-piece]')
  ).not.toBeVisible();

  // Close pages first to finalize video recording
  await player1.close();
  await player2.close();
  await player3.close();

  // Close all contexts
  await context1.close();
  await context2.close();
  await context3.close();
});
