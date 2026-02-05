import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const videoDir = "test-results/multiplayer-videos";

// Start Docker container before each test
test.beforeEach(async () => {
  // Stop any existing container first
  execSync("docker compose down", { stdio: "ignore" });

  // Start fresh container
  execSync("docker compose up -d", { stdio: "ignore" });

  // Wait for server to be ready
  await new Promise((resolve) => setTimeout(resolve, 2000));
});

// Stop Docker container after each test
test.afterEach(async () => {
  execSync("docker compose down", { stdio: "ignore" });
});

// Helper to rename video file after page closes
async function saveVideo(
  page: import("@playwright/test").Page,
  testName: string,
  playerName: string
) {
  const video = page.video();
  if (video) {
    const videoPath = await video.path();
    const newPath = path.join(videoDir, `${testName}_${playerName}.webm`);
    await page.close();
    fs.renameSync(videoPath, newPath);
  } else {
    await page.close();
  }
}

test("three_players_stockfish", async ({ browser }) => {
  // Create 3 browser contexts for 3 players with video recording
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

  // Close pages and save videos with descriptive names
  await saveVideo(player1, "three_players_stockfish", "player1_white");
  await saveVideo(player2, "three_players_stockfish", "player2_black");
  await saveVideo(player3, "three_players_stockfish", "player3_black");

  // Close all contexts
  await context1.close();
  await context2.close();
  await context3.close();
});

test("name_change", async ({ browser }) => {
  // Create 2 browser contexts for 2 players with video recording
  const context1 = await browser.newContext({
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  });
  const context2 = await browser.newContext({
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  });

  const player1 = await context1.newPage();
  const player2 = await context2.newPage();

  // Both players join the website
  await player1.goto("/");
  await player2.goto("/");

  // Wait for app to load
  await player1.waitForSelector(".app-container");
  await player2.waitForSelector(".app-container");

  // Player 1 clicks on their name to open the name change modal
  await player1.click("button.clickable-name");
  await player1.waitForSelector(".name-modal-dialog");

  // Player 1 clears the input and types "toto1"
  const nameInput = player1.locator('.name-modal-dialog input[type="text"]');
  await nameInput.clear();
  await nameInput.fill("toto1");

  // Player 1 clicks Save
  await player1.click('.name-modal-dialog button:has-text("Save")');
  await player1.waitForTimeout(500);

  // Assert: Player 1 sees their new name "toto1"
  await expect(player1.locator("button.clickable-name")).toHaveText("toto1");

  // Assert: Player 2 sees "toto1" in the players list
  await expect(player2.locator(".players-panel")).toContainText("toto1");

  // Close pages and save videos with descriptive names
  await saveVideo(player1, "name_change", "player1");
  await saveVideo(player2, "name_change", "player2");

  // Close all contexts
  await context1.close();
  await context2.close();
});

// Helper function for drag and drop move
async function makeMove(
  page: import("@playwright/test").Page,
  from: string,
  to: string
) {
  const fromSquare = page.locator(`[data-square="${from}"]`);
  const toSquare = page.locator(`[data-square="${to}"]`);

  const fromBox = await fromSquare.boundingBox();
  const toBox = await toSquare.boundingBox();

  if (!fromBox || !toBox) {
    throw new Error(`Could not find squares ${from} or ${to}`);
  }

  await page.mouse.move(
    fromBox.x + fromBox.width / 2,
    fromBox.y + fromBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
}

test("chat_message", async ({ browser }) => {
  // Create 2 browser contexts for 2 players with video recording
  const context1 = await browser.newContext({
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  });
  const context2 = await browser.newContext({
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  });

  const player1 = await context1.newPage();
  const player2 = await context2.newPage();

  // Both players join the website
  await player1.goto("/");
  await player2.goto("/");

  // Wait for app to load
  await player1.waitForSelector(".app-container");
  await player2.waitForSelector(".app-container");

  // Player 1 types "hello1" in the chat input and presses Enter
  const chatInput = player1.locator('.chat-panel input[type="text"]');
  await chatInput.fill("hello1");
  await chatInput.press("Enter");
  await player1.waitForTimeout(500);

  // Assert: Player 1 sees "hello1" in chat messages
  await expect(player1.locator(".chat-messages")).toContainText("hello1");

  // Assert: Player 2 sees "hello1" in chat messages
  await expect(player2.locator(".chat-messages")).toContainText("hello1");

  // Close pages and save videos with descriptive names
  await saveVideo(player1, "chat_message", "player1");
  await saveVideo(player2, "chat_message", "player2");

  // Close all contexts
  await context1.close();
  await context2.close();
});

test("pawn_promotion_to_queen", async ({ browser }) => {
  // Create 2 browser contexts for 2 players with video recording
  const context1 = await browser.newContext({
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  });
  const context2 = await browser.newContext({
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  });

  const player1 = await context1.newPage();
  const player2 = await context2.newPage();

  // Both players join the website
  await player1.goto("/");
  await player2.goto("/");

  // Wait for app to load
  await player1.waitForSelector(".app-container");
  await player2.waitForSelector(".app-container");

  // Player 1 joins White team
  await player1.click('button:has-text("Join White")');
  await player1.waitForTimeout(500);

  // Player 2 joins Black team
  await player2.click('button:has-text("Join Black")');
  await player2.waitForTimeout(500);

  // Sequence of moves to get white pawn to h8:
  // 1. g2-g4 (white)
  // 2. h7-h5 (black)
  // 3. g4xh5 (white captures)
  // 4. g7-g6 (black)
  // 5. h5xg6 (white captures)
  // 6. Ng8-f6 (black moves knight)
  // 7. g6-g7 (white)
  // 8. a7-a6 (black)
  // 9. g7xh8=Q (white promotes to queen)

  // Move 1: g2-g4 (white)
  await makeMove(player1, "g2", "g4");
  await player1.waitForTimeout(1000);

  // Move 2: h7-h5 (black)
  await makeMove(player2, "h7", "h5");
  await player2.waitForTimeout(1000);

  // Move 3: g4xh5 (white captures)
  await makeMove(player1, "g4", "h5");
  await player1.waitForTimeout(1000);

  // Move 4: g7-g6 (black)
  await makeMove(player2, "g7", "g6");
  await player2.waitForTimeout(1000);

  // Move 5: h5xg6 (white captures)
  await makeMove(player1, "h5", "g6");
  await player1.waitForTimeout(1000);

  // Move 6: Ng8-f6 (black moves knight)
  await makeMove(player2, "g8", "f6");
  await player2.waitForTimeout(1000);

  // Move 7: g6-g7 (white)
  await makeMove(player1, "g6", "g7");
  await player1.waitForTimeout(1000);

  // Move 8: a7-a6 (black)
  await makeMove(player2, "a7", "a6");
  await player2.waitForTimeout(1000);

  // Move 9: g7xh8 (white captures rook, triggers promotion)
  await makeMove(player1, "g7", "h8");
  await player1.waitForTimeout(500);

  // Select Queen in promotion dialog (first button)
  await player1.click(".promotion-choices button:first-child");
  await player1.waitForTimeout(1000);

  // Assert: There is a white queen on h8
  await expect(
    player1.locator('[data-square="h8"] [data-piece="wQ"]')
  ).toBeVisible();

  // Close pages and save videos with descriptive names
  await saveVideo(player1, "pawn_promotion", "player1_white");
  await saveVideo(player2, "pawn_promotion", "player2_black");

  // Close all contexts
  await context1.close();
  await context2.close();
});
