import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const BASE_PORT = 8080;
function workerPort(workerIndex: number) {
  return BASE_PORT + workerIndex;
}
function workerProject(workerIndex: number) {
  return `teamchess-test-${workerIndex}`;
}

const VIDEO_DIR = "test-results/videos";
let trackedPages: import("@playwright/test").Page[] = [];
let trackedContexts: import("@playwright/test").BrowserContext[] = [];

async function createPlayer(
  browser: import("@playwright/test").Browser,
  baseURL: string
): Promise<import("@playwright/test").Page> {
  const context = await browser.newContext({
    baseURL,
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  trackedPages.push(page);
  trackedContexts.push(context);
  return page;
}

// Start Docker container before each test
test.beforeEach(async () => {
  const { workerIndex } = test.info();
  const port = workerPort(workerIndex);
  const project = workerProject(workerIndex);
  execSync(`docker compose -p ${project} down`, { stdio: "ignore" });
  execSync(`docker compose -p ${project} up -d`, {
    stdio: "ignore",
    env: { ...process.env, HOST_PORT: String(port) },
  });
  await new Promise((resolve) => setTimeout(resolve, 2000));
});

// Save videos and stop Docker container after each test
// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, testInfo) => {
  const safeName = testInfo.title
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "");

  // Collect video paths before closing contexts
  const videoPaths: (string | undefined)[] = [];
  for (const page of trackedPages) {
    try {
      const video = page.video();
      videoPaths.push(video ? await video.path() : undefined);
    } catch {
      videoPaths.push(undefined);
    }
  }

  // Close all contexts (finalizes videos)
  for (const context of trackedContexts) {
    try {
      await context.close();
    } catch {
      /* context may already be closed */
    }
  }

  // Rename hash files to {safeName}_player{i+1}.webm
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  for (let i = 0; i < videoPaths.length; i++) {
    const videoPath = videoPaths[i];
    if (videoPath && fs.existsSync(videoPath)) {
      const newPath = path.join(VIDEO_DIR, `${safeName}_player${i + 1}.webm`);
      try {
        fs.renameSync(videoPath, newPath);
      } catch {
        /* rename may fail */
      }
    }
  }

  // Reset arrays
  trackedPages = [];
  trackedContexts = [];

  // Docker cleanup
  const { workerIndex } = test.info();
  const project = workerProject(workerIndex);
  execSync(`docker compose -p ${project} down`, { stdio: "ignore" });
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

// ---------------------------------------------------------------------------
// 1. Game and Social
// ---------------------------------------------------------------------------

test.describe("Game and Social", () => {
  test("auto_assign_balances_teams", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 clicks Auto Assign — should join Black (balancing teams)
    await player2.click('button:has-text("Auto Assign")');
    await player2.waitForTimeout(500);

    // Assert: Black team has 1 player
    const blackPlayers = player1.locator(
      '.players-panel h3:has-text("Black") + ul.player-list li'
    );
    await expect(blackPlayers).toHaveCount(1);

    // Assert: White team has 1 player
    const whitePlayers = player1.locator(
      '.players-panel h3:has-text("White") + ul.player-list li'
    );
    await expect(whitePlayers).toHaveCount(1);
  });

  test("name_change", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);

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
  });

  test("chat_message", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);

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
  });

  test("kick_vote_and_blacklist", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);
    const player3 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");
    await player3.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");
    await player3.waitForSelector(".app-container");

    // Wait for all 3 players to appear in player 1's spectators list
    const kickButtons = player1.locator(
      '.players-panel button:has-text("Kick")'
    );
    await expect(kickButtons).toHaveCount(2, { timeout: 5000 });

    // Player 1 clicks "Kick" on the last player (player 3)
    await kickButtons.nth(1).click();
    await player1.waitForTimeout(500);

    // Player 2 clicks "Yes" to vote kick player 3
    await player2.click('button:has-text("Yes")');
    await player2.waitForTimeout(1000);

    // Assert: Player 3 sees the offline banner (disconnected after kick)
    await expect(player3.locator(".offline-banner")).toBeVisible({
      timeout: 5000,
    });

    // Assert: Chat shows the kick system message
    await expect(player1.locator(".chat-messages")).toContainText(
      "has been kicked"
    );

    // Player 3 tries to reconnect by navigating to the website
    await player3.goto("/");
    await player3.waitForSelector(".app-container");
    await player3.waitForTimeout(1000);

    // Assert: Player 3 is still disconnected (blacklisted — server rejects immediately)
    await expect(player3.locator(".offline-banner")).toBeVisible({
      timeout: 5000,
    });
  });

  test("spectator_cannot_move", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);
    const spectator = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");
    await spectator.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");
    await spectator.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 joins Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);

    // Spectator stays as spectator (default)

    // Player 1 (White) plays e2-e4 to start the game
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Spectator tries to drag e7-e5 — should be rejected client-side
    await makeMove(spectator, "e7", "e5");
    await spectator.waitForTimeout(500);

    // Assert: Board unchanged for spectator — e7 still has a black pawn
    await expect(
      spectator.locator('[data-square="e7"] [data-piece="bP"]')
    ).toBeVisible();

    // Assert: e5 is empty (move was blocked)
    await expect(
      spectator.locator('[data-square="e5"] [data-piece]')
    ).not.toBeVisible();
  });

  test("kick_vote_rejected", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    test.setTimeout(60000);

    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);
    const player3 = await createPlayer(browser, baseURL);
    const player4 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");
    await player3.goto("/");
    await player4.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");
    await player3.waitForSelector(".app-container");
    await player4.waitForSelector(".app-container");

    // Wait for all 4 players to appear — P1 sees 3 kick buttons
    const kickButtons = player1.locator(
      '.players-panel button:has-text("Kick")'
    );
    await expect(kickButtons).toHaveCount(3, { timeout: 5000 });

    // Player 1 clicks "Kick" on the last player (player 4)
    await kickButtons.nth(2).click();
    await player1.waitForTimeout(500);

    // Player 2 votes No — vote fails immediately (not enough yes votes possible)
    await player2.click('button:has-text("No")');
    await player2.waitForTimeout(1000);

    // Assert: Chat shows kick vote failure
    await expect(player1.locator(".chat-messages")).toContainText(
      "Not enough votes possible"
    );

    // Assert: Player 4 is still connected (no offline banner)
    await expect(player4.locator(".offline-banner")).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. Gameplay Mechanics
// ---------------------------------------------------------------------------

test.describe("Gameplay Mechanics", () => {
  test("three_players_stockfish", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);
    const player3 = await createPlayer(browser, baseURL);

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
  });

  test("late_joiner_best_move_wins", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);
    const player3 = await createPlayer(browser, baseURL);

    // Player 1, 2, 3 join the website
    await player1.goto("/");
    await player2.goto("/");
    await player3.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");
    await player3.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 joins Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);

    // Player 3 joins Black
    await player3.click('button:has-text("Join Black")');
    await player3.waitForTimeout(500);

    // Player 1 (White) plays e2-e4
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Assert: e4 has a white pawn
    await expect(
      player1.locator('[data-square="e4"] [data-piece="wP"]')
    ).toBeVisible();

    // Player 2 (Black) proposes a bad move: b8-a6
    await makeMove(player2, "b8", "a6");
    await player2.waitForTimeout(500);

    // Player 4 arrives late and joins Black
    const player4 = await createPlayer(browser, baseURL);
    await player4.goto("/");
    await player4.waitForSelector(".app-container");
    await player4.click('button:has-text("Join Black")');
    await player4.waitForTimeout(500);

    // Player 4 (Black) proposes the best move: e7-e5
    await makeMove(player4, "e7", "e5");
    await player4.waitForTimeout(500);

    // Player 3 (Black) proposes a bad move: h7-h6
    await makeMove(player3, "h7", "h6");
    await player3.waitForTimeout(500);

    // Wait for Stockfish to evaluate and select the best move (e7-e5)
    await player1.waitForTimeout(3000);

    // Assert: Stockfish picked player 4's move — e5 has a black pawn, e7 is empty
    await expect(
      player1.locator('[data-square="e5"] [data-piece="bP"]')
    ).toBeVisible();
    await expect(
      player1.locator('[data-square="e7"] [data-piece]')
    ).not.toBeVisible();
  });

  test("pawn_promotion_to_queen", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);

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
  });

  test("pawn_promotion_to_knight", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");

    // Player 1 joins White team
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 joins Black team
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);

    // Same sequence as pawn_promotion_to_queen:
    // 1. g2-g4  2. h7-h5  3. g4xh5  4. g7-g6
    // 5. h5xg6  6. Ng8-f6  7. g6-g7  8. a7-a6
    // 9. g7xh8 → promotion dialog

    await makeMove(player1, "g2", "g4");
    await player1.waitForTimeout(1000);

    await makeMove(player2, "h7", "h5");
    await player2.waitForTimeout(1000);

    await makeMove(player1, "g4", "h5");
    await player1.waitForTimeout(1000);

    await makeMove(player2, "g7", "g6");
    await player2.waitForTimeout(1000);

    await makeMove(player1, "h5", "g6");
    await player1.waitForTimeout(1000);

    await makeMove(player2, "g8", "f6");
    await player2.waitForTimeout(1000);

    await makeMove(player1, "g6", "g7");
    await player1.waitForTimeout(1000);

    await makeMove(player2, "a7", "a6");
    await player2.waitForTimeout(1000);

    // Move 9: g7xh8 (triggers promotion)
    await makeMove(player1, "g7", "h8");
    await player1.waitForTimeout(500);

    // Select Knight in promotion dialog (4th button: Q, R, B, N)
    await player1.click(".promotion-choices button:nth-child(4)");
    await player1.waitForTimeout(1000);

    // Assert: There is a white knight on h8 (not a queen)
    await expect(
      player1.locator('[data-square="h8"] [data-piece="wN"]')
    ).toBeVisible();
  });

  test("illegal_move_rejected", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 joins Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);

    // Player 1 (White) plays e2-e4 — starts game, now it's Black's turn
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 1 tries to play d2-d4 (not their turn) — client-side rejection
    await makeMove(player1, "d2", "d4");
    await player1.waitForTimeout(500);

    // Assert: d2 still has a white pawn (move was blocked)
    await expect(
      player1.locator('[data-square="d2"] [data-piece="wP"]')
    ).toBeVisible();

    // Assert: d4 is empty
    await expect(
      player1.locator('[data-square="d4"] [data-piece]')
    ).not.toBeVisible();
  });

  test("multiple_move_rejection", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);
    const player3 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");
    await player3.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");
    await player3.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 and Player 3 join Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);
    await player3.click('button:has-text("Join Black")');
    await player3.waitForTimeout(500);

    // Player 1 (White) plays e2-e4 — starts game, Black's turn
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 2 proposes e7-e5 (valid first move)
    await makeMove(player2, "e7", "e5");
    await player2.waitForTimeout(500);

    // Player 2 tries to submit a second move d7-d5 — server should reject
    await makeMove(player2, "d7", "d5");
    await player2.waitForTimeout(500);

    // Assert: Toast shows "Already moved." error
    await expect(player2.getByText("Already moved")).toBeVisible();
  });

  test("black_tries_to_start_game", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 joins Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);

    // Player 2 (Black) tries to play e7-e5 — should be blocked (only White can start)
    await makeMove(player2, "e7", "e5");
    await player2.waitForTimeout(500);

    // Assert: e7 still has a black pawn (move was rejected client-side)
    await expect(
      player2.locator('[data-square="e7"] [data-piece="bP"]')
    ).toBeVisible();

    // Assert: e5 is empty
    await expect(
      player2.locator('[data-square="e5"] [data-piece]')
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. Game End Conditions
// ---------------------------------------------------------------------------

test.describe("Game End Conditions", () => {
  test("black_team_checkmates_white", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);
    const player3 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");
    await player3.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");
    await player3.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 joins Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);

    // Player 3 joins Black
    await player3.click('button:has-text("Join Black")');
    await player3.waitForTimeout(500);

    // === Fool's Mate: 1. f3 e5 2. g4 Qh4# ===

    // Move 1: White plays f2-f3
    await makeMove(player1, "f2", "f3");
    await player1.waitForTimeout(1000);

    // Move 2: Both black players propose e7-e5
    await makeMove(player2, "e7", "e5");
    await player2.waitForTimeout(500);
    await makeMove(player3, "e7", "e5");
    await player3.waitForTimeout(3000);

    // Assert: e5 has a black pawn
    await expect(
      player1.locator('[data-square="e5"] [data-piece="bP"]')
    ).toBeVisible();

    // Move 3: White plays g2-g4
    await makeMove(player1, "g2", "g4");
    await player1.waitForTimeout(1000);

    // Move 4: Both black players propose Qd8-h4 (checkmate)
    await makeMove(player2, "d8", "h4");
    await player2.waitForTimeout(500);
    await makeMove(player3, "d8", "h4");
    await player3.waitForTimeout(3000);

    // Assert: Game is over — "Copy PGN" button appears
    await expect(player1.locator('button:has-text("Copy PGN")')).toBeVisible({
      timeout: 5000,
    });

    // Assert: Chat shows checkmate and Black wins
    await expect(player1.locator(".chat-messages")).toContainText("Checkmate");
    await expect(player1.locator(".chat-messages")).toContainText("Black wins");
  });

  test("copy_pgn_paste_chat", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);

    await player1
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);

    await player1.goto("/");
    await player2.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");

    // Player 1 joins White, Player 2 joins Black (1 per team — single proposal wins immediately)
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);

    // === Fool's Mate: 1. f3 e5 2. g4 Qh4# 0-1 ===

    // 1. f2-f3
    await makeMove(player1, "f2", "f3");
    await player1.waitForTimeout(1000);

    // 1... e7-e5
    await makeMove(player2, "e7", "e5");
    await player2.waitForTimeout(1000);

    // 2. g2-g4
    await makeMove(player1, "g2", "g4");
    await player1.waitForTimeout(1000);

    // 2... Qd8-h4# (checkmate)
    await makeMove(player2, "d8", "h4");
    await player2.waitForTimeout(1000);

    // Wait for game over — "Copy PGN" button appears
    await expect(player1.locator('button:has-text("Copy PGN")')).toBeVisible({
      timeout: 5000,
    });

    // Click "Copy PGN" and verify toast
    await player1.click('button:has-text("Copy PGN")');
    await expect(player1.locator("text=PGN copied!")).toBeVisible();

    // Read clipboard
    const pgn = await player1.evaluate(() => navigator.clipboard.readText());

    // Paste PGN into chat and assert round-trip
    const chatInput = player1.locator('.chat-panel input[type="text"]');
    await chatInput.fill(pgn);
    await chatInput.press("Enter");

    await expect(player1.locator(".chat-messages")).toContainText(
      "1. f3 e5 2. g4 Qh4# *"
    );
  });

  test("threefold_repetition_draw", async ({ browser }, testInfo) => {
    test.setTimeout(60000);
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);
    const player3 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");
    await player3.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");
    await player3.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 joins Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);

    // Player 3 joins Black
    await player3.click('button:has-text("Join Black")');
    await player3.waitForTimeout(500);

    // === Threefold repetition: Nf3 Nf6 Ng1 Ng8 (x2) ===
    // Starting position occurs 3 times: initial, after round 1, after round 2

    // Round 1: 1. Nf3 Nf6
    await makeMove(player1, "g1", "f3");
    await player1.waitForTimeout(1000);
    await makeMove(player2, "g8", "f6");
    await player2.waitForTimeout(500);
    await makeMove(player3, "g8", "f6");
    await player3.waitForTimeout(3000);

    // 2. Ng1 Ng8
    await makeMove(player1, "f3", "g1");
    await player1.waitForTimeout(1000);
    await makeMove(player2, "f6", "g8");
    await player2.waitForTimeout(500);
    await makeMove(player3, "f6", "g8");
    await player3.waitForTimeout(3000);

    // Round 2: 3. Nf3 Nf6
    await makeMove(player1, "g1", "f3");
    await player1.waitForTimeout(1000);
    await makeMove(player2, "g8", "f6");
    await player2.waitForTimeout(500);
    await makeMove(player3, "g8", "f6");
    await player3.waitForTimeout(3000);

    // 4. Ng1 Ng8 — position repeats for the 3rd time
    await makeMove(player1, "f3", "g1");
    await player1.waitForTimeout(1000);
    await makeMove(player2, "f6", "g8");
    await player2.waitForTimeout(500);
    await makeMove(player3, "f6", "g8");
    await player3.waitForTimeout(3000);

    // Assert: Game is over — "Copy PGN" button appears
    await expect(player1.locator('button:has-text("Copy PGN")')).toBeVisible({
      timeout: 5000,
    });

    // Assert: Chat shows threefold repetition draw
    await expect(player1.locator(".chat-messages")).toContainText(
      "threefold repetition"
    );
  });

  test("forfeit_by_joining_spectators", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 joins Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);

    // Player 1 plays e2-e4 (starts the game)
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 2 joins spectators — black team is now empty
    await player2.click('button:has-text("Join Spectators")');
    await player2.waitForTimeout(1000);

    // Assert: Game is over — "Copy PGN" button appears (only visible when game is Over)
    await expect(player1.locator('button:has-text("Copy PGN")')).toBeVisible({
      timeout: 5000,
    });

    // Assert: Chat contains the forfeit message indicating White wins
    await expect(player1.locator(".chat-messages")).toContainText("Forfeit");
    await expect(player1.locator(".chat-messages")).toContainText("White wins");
  });

  test("forfeit_by_disconnect", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    test.setTimeout(60000);
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 joins Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);

    // Player 1 plays e2-e4 (starts the game)
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 2 leaves the website (close page)
    await player2.close();

    // Wait for DISCONNECT_GRACE_MS (20s) + buffer
    await player1.waitForTimeout(25000);

    // Assert: Game is over — "Copy PGN" button appears
    await expect(player1.locator('button:has-text("Copy PGN")')).toBeVisible({
      timeout: 5000,
    });

    // Assert: Chat contains the forfeit message indicating White wins
    await expect(player1.locator(".chat-messages")).toContainText("Forfeit");
    await expect(player1.locator(".chat-messages")).toContainText("White wins");
  });

  test("stalemate_draw", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    test.setTimeout(90000);

    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);
    const player3 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");
    await player3.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");
    await player3.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 joins Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);

    // Player 3 joins Black
    await player3.click('button:has-text("Join Black")');
    await player3.waitForTimeout(500);

    // === Sam Loyd's shortest stalemate (10 moves) ===
    // 1. c4 h5  2. h4 a5  3. Qa4 Ra6  4. Qxa5 Rah6
    // 5. Qxc7 f6  6. Qxd7+ Kf7  7. Qxb7 Qd3  8. Qxb8 Qh7
    // 9. Qxc8 Kg6  10. Qe6 (stalemate)

    // Move 1: c2-c4
    await makeMove(player1, "c2", "c4");
    await player1.waitForTimeout(1000);

    // Move 1b: h7-h5
    await makeMove(player2, "h7", "h5");
    await player2.waitForTimeout(500);
    await makeMove(player3, "h7", "h5");
    await player3.waitForTimeout(3000);

    // Move 2: h2-h4
    await makeMove(player1, "h2", "h4");
    await player1.waitForTimeout(1000);

    // Move 2b: a7-a5
    await makeMove(player2, "a7", "a5");
    await player2.waitForTimeout(500);
    await makeMove(player3, "a7", "a5");
    await player3.waitForTimeout(3000);

    // Move 3: Qa4 (d1-a4)
    await makeMove(player1, "d1", "a4");
    await player1.waitForTimeout(1000);

    // Move 3b: Ra6 (a8-a6)
    await makeMove(player2, "a8", "a6");
    await player2.waitForTimeout(500);
    await makeMove(player3, "a8", "a6");
    await player3.waitForTimeout(3000);

    // Move 4: Qxa5 (a4-a5)
    await makeMove(player1, "a4", "a5");
    await player1.waitForTimeout(1000);

    // Move 4b: Rah6 (a6-h6)
    await makeMove(player2, "a6", "h6");
    await player2.waitForTimeout(500);
    await makeMove(player3, "a6", "h6");
    await player3.waitForTimeout(3000);

    // Move 5: Qxc7 (a5-c7)
    await makeMove(player1, "a5", "c7");
    await player1.waitForTimeout(1000);

    // Move 5b: f7-f6
    await makeMove(player2, "f7", "f6");
    await player2.waitForTimeout(500);
    await makeMove(player3, "f7", "f6");
    await player3.waitForTimeout(3000);

    // Move 6: Qxd7+ (c7-d7)
    await makeMove(player1, "c7", "d7");
    await player1.waitForTimeout(1000);

    // Move 6b: Kf7 (e8-f7)
    await makeMove(player2, "e8", "f7");
    await player2.waitForTimeout(500);
    await makeMove(player3, "e8", "f7");
    await player3.waitForTimeout(3000);

    // Move 7: Qxb7 (d7-b7)
    await makeMove(player1, "d7", "b7");
    await player1.waitForTimeout(1000);

    // Move 7b: Qd3 (d8-d3)
    await makeMove(player2, "d8", "d3");
    await player2.waitForTimeout(500);
    await makeMove(player3, "d8", "d3");
    await player3.waitForTimeout(3000);

    // Move 8: Qxb8 (b7-b8)
    await makeMove(player1, "b7", "b8");
    await player1.waitForTimeout(1000);

    // Move 8b: Qh7 (d3-h7)
    await makeMove(player2, "d3", "h7");
    await player2.waitForTimeout(500);
    await makeMove(player3, "d3", "h7");
    await player3.waitForTimeout(3000);

    // Move 9: Qxc8 (b8-c8)
    await makeMove(player1, "b8", "c8");
    await player1.waitForTimeout(1000);

    // Move 9b: Kg6 (f7-g6)
    await makeMove(player2, "f7", "g6");
    await player2.waitForTimeout(500);
    await makeMove(player3, "f7", "g6");
    await player3.waitForTimeout(3000);

    // Move 10: Qe6 (c8-e6) — STALEMATE!
    await makeMove(player1, "c8", "e6");
    await player1.waitForTimeout(2000);

    // Assert: Game is over — "Copy PGN" button appears
    await expect(player1.locator('button:has-text("Copy PGN")')).toBeVisible({
      timeout: 5000,
    });

    // Assert: Chat shows stalemate draw
    await expect(player1.locator(".chat-messages")).toContainText("stalemate");
  });

  test("reconnect_during_grace_period", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    // Player 2 needs same context for reconnect — create manually
    const context2 = await browser.newContext({
      baseURL,
      recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } },
    });
    const player2 = await context2.newPage();
    trackedPages.push(player2);
    trackedContexts.push(context2);

    await player1.goto("/");
    await player2.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 joins Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);

    // Player 1 plays e2-e4 (starts the game)
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 2 disconnects (close page)
    await player2.close();

    // Wait 5 seconds — well within the 20s grace period
    await player1.waitForTimeout(5000);

    // Player 2 reconnects — open new page in same context (preserves localStorage/PID)
    const player2Reconnected = await context2.newPage();
    trackedPages.push(player2Reconnected);
    await player2Reconnected.goto("/");
    await player2Reconnected.waitForSelector(".app-container");
    await player2Reconnected.waitForTimeout(2000);

    // Assert: Player 2 is reconnected — no offline banner
    await expect(
      player2Reconnected.locator(".offline-banner")
    ).not.toBeVisible();

    // Assert: Game is NOT over — no "Copy PGN" button (no forfeit happened)
    await expect(
      player1.locator('button:has-text("Copy PGN")')
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 4. Voting
// ---------------------------------------------------------------------------

test.describe("Voting", () => {
  test("resign_vote_rejected", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);
    const player3 = await createPlayer(browser, baseURL);
    const player4 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");
    await player3.goto("/");
    await player4.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");
    await player3.waitForSelector(".app-container");
    await player4.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2, 3, 4 join Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);
    await player3.click('button:has-text("Join Black")');
    await player3.waitForTimeout(500);
    await player4.click('button:has-text("Join Black")');
    await player4.waitForTimeout(500);

    // Player 1 (White) plays e2-e4
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 2 starts a resign vote (auto-votes yes as initiator)
    await player2.click('button:has-text("Resign")');
    await player2.waitForTimeout(500);

    // Player 3 votes No — vote fails immediately (unanimous required)
    await player3.click('button:has-text("No")');
    await player3.waitForTimeout(1000);

    // Assert: Game is NOT over — no "Copy PGN" button
    await expect(
      player1.locator('button:has-text("Copy PGN")')
    ).not.toBeVisible();

    // Assert: Board still has the position (white pawn on e4)
    await expect(
      player1.locator('[data-square="e4"] [data-piece="wP"]')
    ).toBeVisible();
  });

  test("resign_vote_accepted", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);
    const player3 = await createPlayer(browser, baseURL);
    const player4 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");
    await player3.goto("/");
    await player4.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");
    await player3.waitForSelector(".app-container");
    await player4.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2, 3, 4 join Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);
    await player3.click('button:has-text("Join Black")');
    await player3.waitForTimeout(500);
    await player4.click('button:has-text("Join Black")');
    await player4.waitForTimeout(500);

    // Player 1 (White) plays e2-e4
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 2 starts a resign vote (auto-votes yes as initiator)
    await player2.click('button:has-text("Resign")');
    await player2.waitForTimeout(500);

    // Player 3 votes Yes
    await player3.click('button:has-text("Yes")');
    await player3.waitForTimeout(500);

    // Player 4 votes Yes — vote passes (unanimous: 3/3)
    await player4.click('button:has-text("Yes")');
    await player4.waitForTimeout(1000);

    // Assert: Game is over — "Copy PGN" button appears
    await expect(player1.locator('button:has-text("Copy PGN")')).toBeVisible({
      timeout: 5000,
    });

    // Assert: Chat shows resignation message (system message visible to all)
    await expect(player1.locator(".chat-messages")).toContainText(
      "team resigns"
    );
  });

  test("reset_vote_accepted", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);
    const player3 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");
    await player3.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");
    await player3.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 joins Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);

    // Player 3 joins Black
    await player3.click('button:has-text("Join Black")');
    await player3.waitForTimeout(500);

    // Player 1 (White) plays e2-e4 to start the game
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 2 starts a reset game vote (auto-votes yes as initiator)
    await player2.click('button:has-text("Reset Game")');
    await player2.waitForTimeout(500);

    // Player 1 votes No
    await player1.click('button:has-text("No")');
    await player1.waitForTimeout(500);

    // Player 3 votes Yes — 2 yes vs 1 no → strict majority (2/3) → passes
    await player3.click('button:has-text("Yes")');
    await player3.waitForTimeout(1000);

    // Assert: Game is reset — board is back to starting position (pawn on e2, not e4)
    await expect(
      player1.locator('[data-square="e2"] [data-piece="wP"]')
    ).toBeVisible({ timeout: 5000 });
    await expect(
      player1.locator('[data-square="e4"] [data-piece]')
    ).not.toBeVisible();

    // Assert: Chat shows reset message
    await expect(player1.locator(".chat-messages")).toContainText(
      "Resetting game"
    );
  });

  test("reset_vote_rejected", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);
    const player3 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");
    await player3.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");
    await player3.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 joins Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);

    // Player 3 joins Black
    await player3.click('button:has-text("Join Black")');
    await player3.waitForTimeout(500);

    // Player 1 (White) plays e2-e4 to start the game
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 2 starts a reset game vote (auto-votes yes as initiator)
    await player2.click('button:has-text("Reset Game")');
    await player2.waitForTimeout(500);

    // Player 1 votes No
    await player1.click('button:has-text("No")');
    await player1.waitForTimeout(500);

    // Player 3 votes No — 1 yes vs 2 no → impossible to reach majority → fails
    await player3.click('button:has-text("No")');
    await player3.waitForTimeout(1000);

    // Assert: Game is NOT reset — still in game (white pawn on e4)
    await expect(
      player1.locator('[data-square="e4"] [data-piece="wP"]')
    ).toBeVisible();

    // Assert: Chat shows the rejection message
    await expect(player1.locator(".chat-messages")).toContainText(
      "Vote to reset the game failed"
    );
  });

  test("single_player_resign", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");

    // Player 1 joins White (solo)
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 joins Black (solo)
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);

    // Player 1 (White) plays e2-e4 to start the game
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 1 clicks Resign — solo player gets confirm dialog → accept
    player1.on("dialog", (dialog) => dialog.accept());
    await player1.click('button:has-text("Resign")');
    await player1.waitForTimeout(1000);

    // Assert: Game is over — "Copy PGN" button appears
    await expect(player1.locator('button:has-text("Copy PGN")')).toBeVisible({
      timeout: 5000,
    });

    // Assert: Chat shows resignation message
    await expect(player1.locator(".chat-messages")).toContainText("resigns");
  });

  test("reset_vote_expired", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    test.setTimeout(60000);
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);
    const player3 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");
    await player3.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");
    await player3.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 joins Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);

    // Player 3 joins Black
    await player3.click('button:has-text("Join Black")');
    await player3.waitForTimeout(500);

    // Player 1 (White) plays e2-e4 to start the game
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 2 starts a reset game vote (auto-votes yes)
    await player2.click('button:has-text("Reset Game")');
    await player2.waitForTimeout(500);

    // Nobody else votes — wait for the vote to expire (20s + buffer)
    await player1.waitForTimeout(22000);

    // Assert: Chat shows vote expiration message
    await expect(player1.locator(".chat-messages")).toContainText(
      "Time expired"
    );

    // Assert: Game is NOT reset — white pawn still on e4
    await expect(
      player1.locator('[data-square="e4"] [data-piece="wP"]')
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 5. Draw Offers
// ---------------------------------------------------------------------------

test.describe("Draw Offers", () => {
  test("draw_by_agreement", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);
    const player3 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");
    await player3.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");
    await player3.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 joins Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);

    // Player 3 joins Black
    await player3.click('button:has-text("Join Black")');
    await player3.waitForTimeout(500);

    // Player 1 (White) plays e2-e4
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 1 offers a draw (single player → confirm dialog)
    player1.on("dialog", (dialog) => dialog.accept());
    await player1.click('button:has-text("Offer Draw")');
    await player1.waitForTimeout(1000);

    // Player 2 and Player 3 see the accept_draw vote and click "Yes"
    await player2.click('button:has-text("Yes")');
    await player2.waitForTimeout(500);
    await player3.click('button:has-text("Yes")');
    await player3.waitForTimeout(1000);

    // Assert: Game is over — "Copy PGN" button appears
    await expect(player1.locator('button:has-text("Copy PGN")')).toBeVisible({
      timeout: 5000,
    });

    // Assert: Chat shows the draw agreed message
    await expect(player1.locator(".chat-messages")).toContainText(
      "Draw agreed"
    );
  });

  test("draw_offer_rejected", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);
    const player3 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");
    await player3.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");
    await player3.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 joins Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);

    // Player 3 joins Black
    await player3.click('button:has-text("Join Black")');
    await player3.waitForTimeout(500);

    // Player 1 (White) plays e2-e4
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 1 offers a draw (single player → confirm dialog)
    player1.on("dialog", (dialog) => dialog.accept());
    await player1.click('button:has-text("Offer Draw")');
    await player1.waitForTimeout(1000);

    // Player 2 votes Yes on the accept_draw vote
    await player2.click('button:has-text("Yes")');
    await player2.waitForTimeout(500);

    // Player 3 votes No — vote fails immediately
    await player3.click('button:has-text("No")');
    await player3.waitForTimeout(1000);

    // Assert: Game is NOT over — no "Copy PGN" button
    await expect(
      player1.locator('button:has-text("Copy PGN")')
    ).not.toBeVisible();

    // Assert: Chat shows the draw rejection message (system message visible to all)
    await expect(player1.locator(".chat-messages")).toContainText(
      "rejected the draw offer"
    );
  });

  test("team_offer_draw_rejected", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);
    const player3 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");
    await player3.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");
    await player3.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 joins Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);

    // Player 3 joins Black
    await player3.click('button:has-text("Join Black")');
    await player3.waitForTimeout(500);

    // Player 1 (White) plays e2-e4
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 2 starts an offer_draw team vote (auto-votes yes as initiator)
    await player2.click('button:has-text("Offer Draw")');
    await player2.waitForTimeout(500);

    // Player 3 votes No — vote fails immediately (unanimous required)
    await player3.click('button:has-text("No")');
    await player3.waitForTimeout(1000);

    // Assert: Game is NOT over — no "Copy PGN" button
    await expect(
      player1.locator('button:has-text("Copy PGN")')
    ).not.toBeVisible();

    // Assert: Team chat shows the failure message (visible to black team)
    await expect(player2.locator(".chat-messages")).toContainText(
      "Vote to offer draw failed"
    );
  });

  test("team_offer_draw_accepted", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);
    const player3 = await createPlayer(browser, baseURL);

    await player1.goto("/");
    await player2.goto("/");
    await player3.goto("/");

    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");
    await player3.waitForSelector(".app-container");

    // Player 1 joins White
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(500);

    // Player 2 joins Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(500);

    // Player 3 joins Black
    await player3.click('button:has-text("Join Black")');
    await player3.waitForTimeout(500);

    // Player 1 (White) plays e2-e4
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 2 starts an offer_draw team vote (auto-votes yes as initiator)
    await player2.click('button:has-text("Offer Draw")');
    await player2.waitForTimeout(500);

    // Player 3 votes Yes — offer_draw vote passes (2/2 unanimous)
    // Draw is offered to white → accept_draw vote starts for white
    await player3.click('button:has-text("Yes")');
    await player3.waitForTimeout(1000);

    // Player 1 accepts the draw (votes Yes on accept_draw vote)
    await player1.click('button:has-text("Yes")');
    await player1.waitForTimeout(1000);

    // Assert: Game is over — "Copy PGN" button appears
    await expect(player1.locator('button:has-text("Copy PGN")')).toBeVisible({
      timeout: 5000,
    });

    // Assert: Chat shows the draw agreed message
    await expect(player1.locator(".chat-messages")).toContainText(
      "Draw agreed"
    );
  });

  test("draw_offer_expired", async ({ browser }, testInfo) => {
    const baseURL = `http://localhost:${workerPort(testInfo.workerIndex)}`;
    test.setTimeout(60000);

    const player1 = await createPlayer(browser, baseURL);
    const player2 = await createPlayer(browser, baseURL);
    const player3 = await createPlayer(browser, baseURL);

    // Navigate all players
    await player1.goto("/");
    await player2.goto("/");
    await player3.goto("/");
    await player1.waitForSelector(".app-container");
    await player2.waitForSelector(".app-container");
    await player3.waitForSelector(".app-container");

    // Player 1 joins White (solo)
    await player1.click('button:has-text("Join White")');
    await player1.waitForTimeout(300);

    // Player 2 joins Black
    await player2.click('button:has-text("Join Black")');
    await player2.waitForTimeout(300);

    // Player 3 joins Black
    await player3.click('button:has-text("Join Black")');
    await player3.waitForTimeout(500);

    // Player 1 (White, solo) plays e2-e4 to start the game
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 1 offers a draw (solo white — passes immediately via confirm dialog)
    player1.on("dialog", (dialog) => dialog.accept());
    await player1.click('button:has-text("Offer Draw")');
    await player1.waitForTimeout(1000);

    // Draw offered to black team → accept_draw vote starts for black
    // Nobody votes — wait for vote to expire (20s timeout + buffer)
    await player1.waitForTimeout(22000);

    // Assert: Chat shows draw offer expired
    await expect(player1.locator(".chat-messages")).toContainText(
      "Draw offer expired"
    );

    // Assert: Game is NOT over — no "Copy PGN" button
    await expect(
      player1.locator('button:has-text("Copy PGN")')
    ).not.toBeVisible();
  });
});
