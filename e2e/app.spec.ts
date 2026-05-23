import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import {
  VIDEO_DIR,
  workerPort,
  workerProject,
  trackedPages,
  trackedContexts,
  resetTracking,
  createPlayer,
  setupPlayers,
  joinTeam,
  joinSpectators,
  makeMove,
} from "./helpers";

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

  resetTracking();

  // Docker cleanup
  const { workerIndex } = test.info();
  const project = workerProject(workerIndex);
  execSync(`docker compose -p ${project} down`, { stdio: "ignore" });
});

// Desktop UI note: viewport is 1280x720 → desktop layout renders. Join controls
// live inline in each `.player-section` heading ("Join" button). Action icons
// (Resign, Offer Draw, Reset, Copy PGN) use aria-label or title attributes.

// ---------------------------------------------------------------------------
// 1. Game and Social
// ---------------------------------------------------------------------------

test.describe("Game and Social", () => {
  test("auto_assign_balances_teams", async ({ browser }, testInfo) => {
    const [player1, player2] = await setupPlayers(browser, testInfo, 2);
    // Player 1 joins White
    await joinTeam(player1, "white");

    // Player 2 clicks Auto Assign — should join Black (balancing teams)
    await player2.click('button[aria-label="Auto assign"]');
    await player2.waitForTimeout(500);

    // Assert: Black team has 1 player
    const blackPlayers = player1.locator(
      '.player-section:has(h3:has-text("Black")) ul.player-list li'
    );
    await expect(blackPlayers).toHaveCount(1);

    // Assert: White team has 1 player
    const whitePlayers = player1.locator(
      '.player-section:has(h3:has-text("White")) ul.player-list li'
    );
    await expect(whitePlayers).toHaveCount(1);
  });

  test("name_change", async ({ browser }, testInfo) => {
    const [player1, player2] = await setupPlayers(browser, testInfo, 2);
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
    await expect(player1.locator("button.clickable-name")).toHaveText(
      "toto1 (You)"
    );

    // Assert: Player 2 sees "toto1" in the players list
    await expect(player2.locator(".players-panel")).toContainText("toto1");
  });

  test("chat_message", async ({ browser }, testInfo) => {
    const [player1, player2] = await setupPlayers(browser, testInfo, 2);
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
    const [player1, player2, player3] = await setupPlayers(
      browser,
      testInfo,
      3
    );
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
    await joinTeam(player1, "white");

    // Player 2 joins Black
    await joinTeam(player2, "black");

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
});

// ---------------------------------------------------------------------------
// 2. Gameplay Mechanics
// ---------------------------------------------------------------------------

test.describe("Gameplay Mechanics", () => {
  test("three_players_stockfish", async ({ browser }, testInfo) => {
    const [player1, player2, player3] = await setupPlayers(
      browser,
      testInfo,
      3
    );
    // Player 1 joins White team
    await joinTeam(player1, "white");

    // Player 2 joins Black team
    await joinTeam(player2, "black");

    // Player 3 joins Black team
    await joinTeam(player3, "black");

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
    const [player1, player2, player3] = await setupPlayers(
      browser,
      testInfo,
      3
    );
    // Player 1 joins White
    await joinTeam(player1, "white");

    // Player 2 joins Black
    await joinTeam(player2, "black");

    // Player 3 joins Black
    await joinTeam(player3, "black");

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
    const [player4] = await setupPlayers(browser, testInfo, 1);
    await joinTeam(player4, "black");

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
    const [player1, player2] = await setupPlayers(browser, testInfo, 2);
    // Player 1 joins White team
    await joinTeam(player1, "white");

    // Player 2 joins Black team
    await joinTeam(player2, "black");

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

  test("illegal_move_rejected", async ({ browser }, testInfo) => {
    const [player1, player2] = await setupPlayers(browser, testInfo, 2);
    // Player 1 joins White
    await joinTeam(player1, "white");

    // Player 2 joins Black
    await joinTeam(player2, "black");

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
    const [player1, player2, player3] = await setupPlayers(
      browser,
      testInfo,
      3
    );
    // Player 1 joins White
    await joinTeam(player1, "white");

    // Player 2 and Player 3 join Black
    await joinTeam(player2, "black");
    await joinTeam(player3, "black");

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
});

// ---------------------------------------------------------------------------
// 3. Game End Conditions
// ---------------------------------------------------------------------------

test.describe("Game End Conditions", () => {
  test("black_team_checkmates_white", async ({ browser }, testInfo) => {
    const [player1, player2, player3] = await setupPlayers(
      browser,
      testInfo,
      3
    );
    // Player 1 joins White
    await joinTeam(player1, "white");

    // Player 2 joins Black
    await joinTeam(player2, "black");

    // Player 3 joins Black
    await joinTeam(player3, "black");

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
    await expect(player1.locator('button[title="Copy PGN"]')).toBeVisible({
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
    await joinTeam(player1, "white");
    await joinTeam(player2, "black");

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
    await expect(player1.locator('button[title="Copy PGN"]')).toBeVisible({
      timeout: 5000,
    });

    // Click "Copy PGN" and verify toast
    await player1.click('button[title="Copy PGN"]');
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

  test("forfeit_by_joining_spectators", async ({ browser }, testInfo) => {
    const [player1, player2] = await setupPlayers(browser, testInfo, 2);
    // Player 1 joins White
    await joinTeam(player1, "white");

    // Player 2 joins Black
    await joinTeam(player2, "black");

    // Player 1 plays e2-e4 (starts the game)
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 2 joins spectators — black team is now empty
    await joinSpectators(player2);
    await player2.waitForTimeout(500);

    // Assert: Game is over — "Copy PGN" button appears (only visible when game is Over)
    await expect(player1.locator('button[title="Copy PGN"]')).toBeVisible({
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
    await joinTeam(player1, "white");

    // Player 2 joins Black
    await joinTeam(player2, "black");

    // Player 1 plays e2-e4 (starts the game)
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 2 leaves the website (close page)
    await player2.close();

    // Wait for DISCONNECT_GRACE_MS (20s) + buffer
    await player1.waitForTimeout(25000);

    // Assert: Game is over — "Copy PGN" button appears
    await expect(player1.locator('button[title="Copy PGN"]')).toBeVisible({
      timeout: 5000,
    });

    // Assert: Chat contains the forfeit message indicating White wins
    await expect(player1.locator(".chat-messages")).toContainText("Forfeit");
    await expect(player1.locator(".chat-messages")).toContainText("White wins");
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
    await joinTeam(player1, "white");

    // Player 2 joins Black
    await joinTeam(player2, "black");

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
    await expect(player1.locator('button[title="Copy PGN"]')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 4. Voting
// ---------------------------------------------------------------------------

test.describe("Voting", () => {
  test("resign_vote_accepted", async ({ browser }, testInfo) => {
    const [player1, player2, player3, player4] = await setupPlayers(
      browser,
      testInfo,
      4
    );
    // Player 1 joins White
    await joinTeam(player1, "white");

    // Player 2, 3, 4 join Black
    await joinTeam(player2, "black");
    await joinTeam(player3, "black");
    await joinTeam(player4, "black");

    // Player 1 (White) plays e2-e4
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 2 starts a resign vote (auto-votes yes as initiator)
    await player2.click('button[aria-label="Resign"]');
    await player2.waitForTimeout(500);

    // Player 3 votes Yes
    await player3.click('button:has-text("Yes")');
    await player3.waitForTimeout(500);

    // Player 4 votes Yes — vote passes (unanimous: 3/3)
    await player4.click('button:has-text("Yes")');
    await player4.waitForTimeout(1000);

    // Assert: Game is over — "Copy PGN" button appears
    await expect(player1.locator('button[title="Copy PGN"]')).toBeVisible({
      timeout: 5000,
    });

    // Assert: Chat shows resignation message (system message visible to all)
    await expect(player1.locator(".chat-messages")).toContainText(
      "Resignation"
    );
  });

  test("reset_vote_accepted", async ({ browser }, testInfo) => {
    const [player1, player2, player3] = await setupPlayers(
      browser,
      testInfo,
      3
    );
    // Player 1 joins White
    await joinTeam(player1, "white");

    // Player 2 joins Black
    await joinTeam(player2, "black");

    // Player 3 joins Black
    await joinTeam(player3, "black");

    // Player 1 (White) plays e2-e4 to start the game
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 2 starts a reset game vote (auto-votes yes as initiator)
    await player2.click('button[aria-label="Reset"]');
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
      "Game has been reset"
    );
  });

  test("single_player_resign", async ({ browser }, testInfo) => {
    const [player1, player2] = await setupPlayers(browser, testInfo, 2);
    // Player 1 joins White (solo)
    await joinTeam(player1, "white");

    // Player 2 joins Black (solo)
    await joinTeam(player2, "black");

    // Player 1 (White) plays e2-e4 to start the game
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 1 clicks Resign — solo player gets confirm modal → click Confirm
    await player1.click('button[aria-label="Resign"]');
    await player1.getByRole("button", { name: "Confirm" }).click();
    await player1.waitForTimeout(1000);

    // Assert: Game is over — "Copy PGN" button appears
    await expect(player1.locator('button[title="Copy PGN"]')).toBeVisible({
      timeout: 5000,
    });

    // Assert: Chat shows resignation message
    await expect(player1.locator(".chat-messages")).toContainText(
      "Resignation"
    );
  });

  test("reset_vote_shows_voter_labels", async ({ browser }, testInfo) => {
    const [player1, player2, player3] = await setupPlayers(
      browser,
      testInfo,
      3
    );
    // Set distinct names for each player
    // Player 1 → Alice
    await player1.click("button.clickable-name");
    await player1.waitForSelector(".name-modal-dialog");
    const name1 = player1.locator('.name-modal-dialog input[type="text"]');
    await name1.clear();
    await name1.fill("Alice");
    await player1.click('.name-modal-dialog button:has-text("Save")');
    await player1.waitForTimeout(500);

    // Player 2 → Bob
    await player2.click("button.clickable-name");
    await player2.waitForSelector(".name-modal-dialog");
    const name2 = player2.locator('.name-modal-dialog input[type="text"]');
    await name2.clear();
    await name2.fill("Bob");
    await player2.click('.name-modal-dialog button:has-text("Save")');
    await player2.waitForTimeout(500);

    // Player 3 → Charlie
    await player3.click("button.clickable-name");
    await player3.waitForSelector(".name-modal-dialog");
    const name3 = player3.locator('.name-modal-dialog input[type="text"]');
    await name3.clear();
    await name3.fill("Charlie");
    await player3.click('.name-modal-dialog button:has-text("Save")');
    await player3.waitForTimeout(500);

    // Alice → White, Bob + Charlie → Black
    await joinTeam(player1, "white");
    await joinTeam(player2, "black");
    await joinTeam(player3, "black");

    // Alice plays e2-e4 to start the game
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Bob clicks "Reset Game" (auto-votes yes)
    await player2.click('button[aria-label="Reset"]');
    await player2.waitForTimeout(1000);

    // Assert on Alice's view: "Yes (1)" button visible, "Yes: Bob" label visible
    await expect(player1.locator('button:has-text("Yes (1)")')).toBeVisible({
      timeout: 5000,
    });
    await expect(player1.getByText("Yes: Bob")).toBeVisible();

    // Alice clicks "No"
    await player1.click('button:has-text("No")');
    await player1.waitForTimeout(1000);

    // Assert: "No (1)" button visible, "No: Alice" label visible, "Yes: Bob" still visible
    await expect(player1.locator('button:has-text("No (1)")')).toBeVisible();
    await expect(player1.getByText("No: Alice")).toBeVisible();
    await expect(player1.getByText("Yes: Bob")).toBeVisible();

    // Charlie clicks "Yes" — vote passes (2/3 majority)
    await player3.click('button:has-text("Yes")');
    await player3.waitForTimeout(1000);

    // Assert: game resets — pawn back on e2
    await expect(
      player1.locator('[data-square="e2"] [data-piece="wP"]')
    ).toBeVisible({ timeout: 5000 });
    await expect(
      player1.locator('[data-square="e4"] [data-piece]')
    ).not.toBeVisible();
  });

  test("team_vote_buttons_disabled_for_late_joiner", async ({
    browser,
  }, testInfo) => {
    const [player1, player2, player3] = await setupPlayers(
      browser,
      testInfo,
      3
    );
    // Player 1 → White, Player 2 + 3 → Black
    await joinTeam(player1, "white");
    await joinTeam(player2, "black");
    await joinTeam(player3, "black");

    // Start game
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 2 starts resign vote
    await player2.click('button[aria-label="Resign"]');
    await player2.waitForTimeout(500);

    // Player 4 joins late, goes to Black
    const [player4] = await setupPlayers(browser, testInfo, 1);
    await joinTeam(player4, "black");
    await player4.waitForTimeout(500);

    // Assert: P4 (late joiner) sees vote but Yes/No buttons are disabled
    const p4Yes = player4.locator('button:has-text("Yes")');
    const p4No = player4.locator('button:has-text("No")');
    await expect(p4Yes).toBeVisible({ timeout: 5000 });
    await expect(p4Yes).toBeDisabled();
    await expect(p4No).toBeDisabled();

    // Assert: P3 (eligible) has Yes/No buttons enabled
    const p3Yes = player3.locator('button:has-text("Yes")');
    const p3No = player3.locator('button:has-text("No")');
    await expect(p3Yes).toBeEnabled();
    await expect(p3No).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// 5. Draw Offers
// ---------------------------------------------------------------------------

test.describe("Draw Offers", () => {
  test("draw_by_agreement", async ({ browser }, testInfo) => {
    const [player1, player2, player3] = await setupPlayers(
      browser,
      testInfo,
      3
    );
    // Player 1 joins White
    await joinTeam(player1, "white");

    // Player 2 joins Black
    await joinTeam(player2, "black");

    // Player 3 joins Black
    await joinTeam(player3, "black");

    // Player 1 (White) plays e2-e4
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 1 offers a draw (single player → confirm modal)
    await player1.click('button[aria-label="Offer Draw"]');
    await player1.getByRole("button", { name: "Confirm" }).click();
    await player1.waitForTimeout(1000);

    // Player 2 and Player 3 see the accept_draw vote and click "Yes"
    await player2.click('button:has-text("Yes")');
    await player2.waitForTimeout(500);
    await player3.click('button:has-text("Yes")');
    await player3.waitForTimeout(1000);

    // Assert: Game is over — "Copy PGN" button appears
    await expect(player1.locator('button[title="Copy PGN"]')).toBeVisible({
      timeout: 5000,
    });

    // Assert: Chat shows the draw agreed message
    await expect(player1.locator(".chat-messages")).toContainText(
      "Draw agreed"
    );
  });

  test("team_offer_draw_accepted", async ({ browser }, testInfo) => {
    const [player1, player2, player3] = await setupPlayers(
      browser,
      testInfo,
      3
    );
    // Player 1 joins White
    await joinTeam(player1, "white");

    // Player 2 joins Black
    await joinTeam(player2, "black");

    // Player 3 joins Black
    await joinTeam(player3, "black");

    // Player 1 (White) plays e2-e4
    await makeMove(player1, "e2", "e4");
    await player1.waitForTimeout(1000);

    // Player 2 starts an offer_draw team vote (auto-votes yes as initiator)
    await player2.click('button[aria-label="Offer Draw"]');
    await player2.waitForTimeout(500);

    // Player 3 votes Yes — offer_draw vote passes (2/2 unanimous)
    // Draw is offered to white → accept_draw vote starts for white
    await player3.click('button:has-text("Yes")');
    await player3.waitForTimeout(1000);

    // Player 1 accepts the draw (votes Yes on accept_draw vote)
    await player1.click('button:has-text("Yes")');
    await player1.waitForTimeout(1000);

    // Assert: Game is over — "Copy PGN" button appears
    await expect(player1.locator('button[title="Copy PGN"]')).toBeVisible({
      timeout: 5000,
    });

    // Assert: Chat shows the draw agreed message
    await expect(player1.locator(".chat-messages")).toContainText(
      "Draw agreed"
    );
  });
});
