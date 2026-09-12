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
  waitForMovePlayed,
  waitForMyTurn,
  waitForProposals,
  waitForVoteBanner,
  waitForYesVotes,
} from "./helpers";

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

// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, testInfo) => {
  const safeName = testInfo.title
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "");

  const videoPaths: (string | undefined)[] = [];
  for (const page of trackedPages) {
    try {
      const video = page.video();
      videoPaths.push(video ? await video.path() : undefined);
    } catch {
      videoPaths.push(undefined);
    }
  }

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

  const { workerIndex } = test.info();
  const project = workerProject(workerIndex);
  execSync(`docker compose -p ${project} down`, { stdio: "ignore" });
});

// Desktop UI note: viewport is 1280x720 → desktop layout renders. Join controls
// live inline in each `.player-section` heading ("Join" button). Action icons
// (Resign, Offer Draw, Reset, Copy PGN) use aria-label or title attributes.

test.describe("Game and Social", () => {
  test("auto_assign_balances_teams", async ({ browser }, testInfo) => {
    const [player1, player2] = await setupPlayers(browser, testInfo, 2);
    await joinTeam(player1, "white");

    await player2.click('button[aria-label="Auto assign"]');
    await expect(
      player2.locator('button[aria-label="Auto assign"]')
    ).toHaveCount(0, { timeout: 10_000 });

    const blackPlayers = player1.locator(
      '.player-section:has(h3:has-text("Black")) ul.player-list li'
    );
    await expect(blackPlayers).toHaveCount(1);

    const whitePlayers = player1.locator(
      '.player-section:has(h3:has-text("White")) ul.player-list li'
    );
    await expect(whitePlayers).toHaveCount(1);
  });

  test("name_change", async ({ browser }, testInfo) => {
    const [player1, player2] = await setupPlayers(browser, testInfo, 2);
    await player1.click("button.clickable-name");
    await player1.waitForSelector(".name-modal-dialog");

    const nameInput = player1.locator('.name-modal-dialog input[type="text"]');
    await nameInput.clear();
    await nameInput.fill("toto1");

    await player1.click('.name-modal-dialog button:has-text("Save")');

    // Assert: Player 1 sees their new name "toto1" with the (You) marker.
    // (You) is a sibling of the button (not a child), separated by the
    // .player-entry flex gap — same structure as teamchess-steam.
    await expect(player1.locator("button.clickable-name")).toHaveText("toto1");
    await expect(player1.locator(".player-you-tag").first()).toBeVisible();

    await expect(player2.locator(".players-panel")).toContainText("toto1");
  });

  test("chat_message", async ({ browser }, testInfo) => {
    const [player1, player2] = await setupPlayers(browser, testInfo, 2);
    const chatInput = player1.locator('.chat-panel input[type="text"]');
    await chatInput.fill("hello1");
    await chatInput.press("Enter");

    await expect(player1.locator(".chat-messages")).toContainText("hello1");

    await expect(player2.locator(".chat-messages")).toContainText("hello1");
  });

  test("host_kicks_player", async ({ browser }, testInfo) => {
    const [player1, player2, player3] = await setupPlayers(
      browser,
      testInfo,
      3
    );
    // Player 1 connected first, so they are the lead: only they can kick
    const kickButtons = player1.locator(
      '.players-panel button:has-text("Kick")'
    );
    await expect(kickButtons).toHaveCount(2, { timeout: 5000 });
    await expect(
      player2.locator('.players-panel button:has-text("Kick")')
    ).toHaveCount(0);

    await kickButtons.nth(1).click();
    await player1.getByRole("button", { name: "Confirm" }).click();

    await expect(player3.locator(".offline-banner")).toBeVisible({
      timeout: 5000,
    });

    await expect(player1.locator(".chat-messages")).toContainText(
      "has been kicked"
    );

    await player3.goto("/");
    await player3.waitForSelector(".app-container");

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

    await joinTeam(player1, "white");

    await joinTeam(player2, "black");

    await makeMove(player1, "e2", "e4");
    await waitForMovePlayed(spectator, "e4");

    // Spectator tries to drag e7-e5 — should be rejected client-side
    await makeMove(spectator, "e7", "e5");
    // Asserting that nothing happens: there is no state change to wait for.
    await spectator.waitForTimeout(500);

    await expect(
      spectator.locator('[data-square="e7"] [data-piece="bP"]')
    ).toBeVisible();

    await expect(
      spectator.locator('[data-square="e5"] [data-piece]')
    ).not.toBeVisible();
  });
});

test.describe("Gameplay Mechanics", () => {
  test("three_players_stockfish", async ({ browser }, testInfo) => {
    const [player1, player2, player3] = await setupPlayers(
      browser,
      testInfo,
      3
    );
    await joinTeam(player1, "white");

    await joinTeam(player2, "black");

    await joinTeam(player3, "black");

    await makeMove(player1, "e2", "e4");
    await waitForMyTurn(player2);

    await expect(
      player1.locator('[data-square="e4"] [data-piece="wP"]')
    ).toBeVisible();
    await expect(
      player1.locator('[data-square="e2"] [data-piece]')
    ).not.toBeVisible();

    await makeMove(player2, "e7", "e5");
    await waitForProposals(player2, 1);

    await makeMove(player3, "b8", "a6");

    // Two different proposals, so Stockfish really does have to choose
    await waitForMovePlayed(player1, "e5");

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
    await joinTeam(player1, "white");

    await joinTeam(player2, "black");

    await joinTeam(player3, "black");

    await makeMove(player1, "e2", "e4");
    await waitForMyTurn(player2);

    await expect(
      player1.locator('[data-square="e4"] [data-piece="wP"]')
    ).toBeVisible();

    await makeMove(player2, "b8", "a6");
    await waitForProposals(player2, 1);

    const [player4] = await setupPlayers(browser, testInfo, 1);
    await joinTeam(player4, "black");

    await makeMove(player4, "e7", "e5");
    await waitForProposals(player4, 2);

    await makeMove(player3, "h7", "h6");

    // Three different proposals — Stockfish picks among them
    await waitForMovePlayed(player1, "e5");

    // Stockfish picked the late joiner's move.
    await expect(
      player1.locator('[data-square="e5"] [data-piece="bP"]')
    ).toBeVisible();
    await expect(
      player1.locator('[data-square="e7"] [data-piece]')
    ).not.toBeVisible();
  });

  test("pawn_promotion_to_queen", async ({ browser }, testInfo) => {
    const [player1, player2] = await setupPlayers(browser, testInfo, 2);
    await joinTeam(player1, "white");

    await joinTeam(player2, "black");

    // Nine plies to walk a white pawn up to h8. Each move waits for the turn to actually close — nine fixed sleeps put this
    // test within a couple of seconds of the 30s budget, so it tipped over first
    // whenever the workers ran in parallel.
    await makeMove(player1, "g2", "g4");
    await waitForMovePlayed(player1, "g4");

    await makeMove(player2, "h7", "h5");
    await waitForMovePlayed(player2, "h5");

    await makeMove(player1, "g4", "h5");
    await waitForMovePlayed(player1, "gxh5");

    await makeMove(player2, "g7", "g6");
    await waitForMovePlayed(player2, "g6");

    await makeMove(player1, "h5", "g6");
    await waitForMovePlayed(player1, "hxg6");

    await makeMove(player2, "g8", "f6");
    await waitForMovePlayed(player2, "Nf6");

    await makeMove(player1, "g6", "g7");
    await waitForMovePlayed(player1, "g7");

    await makeMove(player2, "a7", "a6");
    await waitForMovePlayed(player2, "a6");

    await makeMove(player1, "g7", "h8");

    // Select Queen in promotion dialog (first button)
    await player1.click(".promotion-choices button:first-child");
    await waitForMovePlayed(player1, "gxh8=Q");

    await expect(
      player1.locator('[data-square="h8"] [data-piece="wQ"]')
    ).toBeVisible();
  });

  test("illegal_move_rejected", async ({ browser }, testInfo) => {
    const [player1, player2] = await setupPlayers(browser, testInfo, 2);
    await joinTeam(player1, "white");

    await joinTeam(player2, "black");

    await makeMove(player1, "e2", "e4");
    await waitForMovePlayed(player1, "e4");

    // Player 1 tries to play d2-d4 (not their turn) — client-side rejection
    await makeMove(player1, "d2", "d4");
    // Asserting that nothing happens: there is no state change to wait for.
    await player1.waitForTimeout(500);

    await expect(
      player1.locator('[data-square="d2"] [data-piece="wP"]')
    ).toBeVisible();

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
    await joinTeam(player1, "white");

    await joinTeam(player2, "black");
    await joinTeam(player3, "black");

    await makeMove(player1, "e2", "e4");
    await waitForMyTurn(player2);

    await makeMove(player2, "e7", "e5");
    await waitForProposals(player2, 1);

    // Player 2 tries to submit a second move d7-d5 — server should reject
    await makeMove(player2, "d7", "d5");

    await expect(player2.getByText("Already moved")).toBeVisible();
  });
});

test.describe("Game End Conditions", () => {
  test("black_team_checkmates_white", async ({ browser }, testInfo) => {
    const [player1, player2, player3] = await setupPlayers(
      browser,
      testInfo,
      3
    );
    await joinTeam(player1, "white");

    await joinTeam(player2, "black");

    await joinTeam(player3, "black");

    // === Fool's Mate: 1. f3 e5 2. g4 Qh4# ===

    await makeMove(player1, "f2", "f3");
    await waitForMyTurn(player2);

    // Move 2: Both black players propose e7-e5 (unanimous — no search needed)
    await makeMove(player2, "e7", "e5");
    await waitForProposals(player2, 1);
    await makeMove(player3, "e7", "e5");
    await waitForMyTurn(player1);

    await expect(
      player1.locator('[data-square="e5"] [data-piece="bP"]')
    ).toBeVisible();

    await makeMove(player1, "g2", "g4");
    await waitForMyTurn(player2);

    // Move 4: Both black players propose Qd8-h4 (checkmate)
    await makeMove(player2, "d8", "h4");
    await waitForProposals(player2, 1);
    await makeMove(player3, "d8", "h4");

    // Assert: Game is over — "Copy PGN" button appears
    await expect(player1.locator('button[title="Copy PGN"]')).toBeVisible({
      timeout: 5000,
    });

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
    await waitForMyTurn(player2);

    // 1... e7-e5
    await makeMove(player2, "e7", "e5");
    await waitForMyTurn(player1);

    // 2. g2-g4
    await makeMove(player1, "g2", "g4");
    await waitForMyTurn(player2);

    // 2... Qd8-h4# (checkmate)
    await makeMove(player2, "d8", "h4");

    // Wait for game over — "Copy PGN" button appears
    await expect(player1.locator('button[title="Copy PGN"]')).toBeVisible({
      timeout: 5000,
    });

    await player1.click('button[title="Copy PGN"]');
    await expect(player1.locator("text=PGN copied!")).toBeVisible();

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
    await joinTeam(player1, "white");

    await joinTeam(player2, "black");

    await makeMove(player1, "e2", "e4");
    await waitForMovePlayed(player2, "e4");

    // Player 2 joins spectators — black team is now empty. Every way of emptying
    // a team is the same rule now: 30s to get someone back, then forfeit.
    test.setTimeout(60000);
    await joinSpectators(player2);

    await expect(player1.locator(".forfeit-banner")).toBeVisible();
    await expect(player1.locator('button[title="Copy PGN"]')).not.toBeVisible();

    // Assert: Game is over — "Copy PGN" button appears (only visible when game is Over)
    await expect(player1.locator('button[title="Copy PGN"]')).toBeVisible({
      timeout: 40_000,
    });

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

    await joinTeam(player1, "white");

    await joinTeam(player2, "black");

    await makeMove(player1, "e2", "e4");
    await waitForMovePlayed(player1, "e4");

    await player2.close();

    // Leaving gives the seat up at once — nothing is held for an absent player.
    // What runs is the countdown on the team it left empty, shown to the player
    // still there. Waiting on the button rather than sleeping past it means the
    // test ends the moment the forfeit lands.
    await expect(player1.locator(".forfeit-banner")).toBeVisible();
    await expect(player1.locator('button[title="Copy PGN"]')).toBeVisible({
      timeout: 40_000,
    });

    await expect(player1.locator(".chat-messages")).toContainText("Forfeit");
    await expect(player1.locator(".chat-messages")).toContainText("White wins");
  });

  test("reconnect_keeps_your_side", async ({ browser }, testInfo) => {
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

    await joinTeam(player1, "white");

    await joinTeam(player2, "black");

    await makeMove(player1, "e2", "e4");
    await waitForMovePlayed(player1, "e4");

    await player2.close();

    // The countdown on the emptied black team starts at once, and says so
    await expect(player1.locator(".forfeit-banner")).toBeVisible();
    await player1.waitForTimeout(5000);

    // Player 2 reconnects — open new page in same context (preserves localStorage/PID)
    const player2Reconnected = await context2.newPage();
    trackedPages.push(player2Reconnected);
    await player2Reconnected.goto("/");
    await player2Reconnected.waitForSelector(".app-container");
    // The session is only really restored once the roster comes back with both
    // players — asserting the negatives before that would pass for the wrong reason.
    await expect(
      player2Reconnected.locator(".players-panel .player-list li")
    ).toHaveCount(2, { timeout: 10_000 });

    await expect(
      player2Reconnected.locator(".offline-banner")
    ).not.toBeVisible();

    // Back on Black rather than demoted to spectator: the server held no seat,
    // the client remembered its side and claimed it back.
    await expect(
      player2Reconnected.locator(
        '.player-section:has(h3:has-text("Black")) .player-list li'
      )
    ).toHaveCount(1);

    // Assert: the countdown was called off and no forfeit fired
    await expect(player1.locator(".forfeit-banner")).not.toBeVisible();
    await expect(player1.locator('button[title="Copy PGN"]')).not.toBeVisible();
  });

  // Same name as its teamchess-steam twin: the two suites are meant to diff.
  test("blip_cancels_forfeit_when_the_link_comes_back", async ({
    browser,
  }, testInfo) => {
    // The countdown the blip arms is served in real time here.
    test.setTimeout(90000);

    const [player1, player2] = await setupPlayers(browser, testInfo, 2);
    await joinTeam(player1, "white");
    await joinTeam(player2, "black");

    await makeMove(player1, "e2", "e4");
    await waitForMovePlayed(player2, "e4");

    // A hiccup, not a departure: the page keeps running and keeps its state,
    // only the link goes away. reconnect_keeps_your_side closes the page and
    // opens another, which is a reload — a new socket and a new React tree.
    // This is the failure a flaky wifi actually produces.
    await player2.context().setOffline(true);

    // Both ends are on a 5s ping (server/index.ts), so a severed link is noticed
    // within ~10s even if nothing closes the socket outright.
    await expect(player2.locator(".offline-banner")).toBeVisible({
      timeout: 20_000,
    });
    await expect(player1.locator(".forfeit-banner")).toBeVisible({
      timeout: 20_000,
    });

    // socket.io reconnects on its own, under the same pid, so the seat is
    // refilled and the countdown has to be called off with it.
    await player2.context().setOffline(false);

    await expect(player2.locator(".offline-banner")).not.toBeVisible({
      timeout: 20_000,
    });
    await expect(player1.locator(".forfeit-banner")).not.toBeVisible({
      timeout: 20_000,
    });
    await expect(player1.locator('button[title="Copy PGN"]')).not.toBeVisible();
  });
});

test.describe("Voting", () => {
  test("resign_vote_accepted", async ({ browser }, testInfo) => {
    const [player1, player2, player3, player4] = await setupPlayers(
      browser,
      testInfo,
      4
    );
    await joinTeam(player1, "white");

    await joinTeam(player2, "black");
    await joinTeam(player3, "black");
    await joinTeam(player4, "black");

    await makeMove(player1, "e2", "e4");
    await waitForMovePlayed(player2, "e4");

    await player2.click('button[aria-label="Resign"]');
    await waitForVoteBanner(player3);

    await player3.click('button:has-text("Yes")');
    await waitForYesVotes(player4, 2);

    await player4.click('button:has-text("Yes")');

    // Assert: Game is over — "Copy PGN" button appears
    await expect(player1.locator('button[title="Copy PGN"]')).toBeVisible({
      timeout: 5000,
    });

    await expect(player1.locator(".chat-messages")).toContainText(
      "Resignation"
    );
  });

  test("host_resets_game", async ({ browser }, testInfo) => {
    const [player1, player2, player3] = await setupPlayers(
      browser,
      testInfo,
      3
    );
    await joinTeam(player1, "white");

    await joinTeam(player2, "black");

    await joinTeam(player3, "black");

    await makeMove(player1, "e2", "e4");
    await waitForMovePlayed(player1, "e4");

    // Player 1 connected first, so they are the lead: only they see Reset
    await expect(
      player2.locator('button[aria-label="Reset"]')
    ).not.toBeVisible();

    await player1.click('button[aria-label="Reset"]');
    await player1.getByRole("button", { name: "Confirm" }).click();

    await expect(
      player1.locator('[data-square="e2"] [data-piece="wP"]')
    ).toBeVisible({ timeout: 5000 });
    await expect(
      player1.locator('[data-square="e4"] [data-piece]')
    ).not.toBeVisible();

    await expect(player1.locator(".chat-messages")).toContainText(
      "Game has been reset"
    );
  });

  test("single_player_resign", async ({ browser }, testInfo) => {
    const [player1, player2] = await setupPlayers(browser, testInfo, 2);
    await joinTeam(player1, "white");

    await joinTeam(player2, "black");

    await makeMove(player1, "e2", "e4");
    await waitForMovePlayed(player1, "e4");

    // Player 1 clicks Resign — solo player gets confirm modal → click Confirm
    await player1.click('button[aria-label="Resign"]');
    await player1.getByRole("button", { name: "Confirm" }).click();

    // Assert: Game is over — "Copy PGN" button appears
    await expect(player1.locator('button[title="Copy PGN"]')).toBeVisible({
      timeout: 5000,
    });

    await expect(player1.locator(".chat-messages")).toContainText(
      "Resignation"
    );
  });

  test("team_vote_shows_voter_labels", async ({ browser }, testInfo) => {
    const [player1, player2, player3] = await setupPlayers(
      browser,
      testInfo,
      3
    );
    await player1.click("button.clickable-name");
    await player1.waitForSelector(".name-modal-dialog");
    const name1 = player1.locator('.name-modal-dialog input[type="text"]');
    await name1.clear();
    await name1.fill("Alice");
    await player1.click('.name-modal-dialog button:has-text("Save")');
    await expect(player1.locator("button.clickable-name")).toHaveText("Alice");

    await player2.click("button.clickable-name");
    await player2.waitForSelector(".name-modal-dialog");
    const name2 = player2.locator('.name-modal-dialog input[type="text"]');
    await name2.clear();
    await name2.fill("Bob");
    await player2.click('.name-modal-dialog button:has-text("Save")');
    await expect(player2.locator("button.clickable-name")).toHaveText("Bob");

    await player3.click("button.clickable-name");
    await player3.waitForSelector(".name-modal-dialog");
    const name3 = player3.locator('.name-modal-dialog input[type="text"]');
    await name3.clear();
    await name3.fill("Charlie");
    await player3.click('.name-modal-dialog button:has-text("Save")');
    await expect(player3.locator("button.clickable-name")).toHaveText(
      "Charlie"
    );

    await joinTeam(player1, "white");
    await joinTeam(player2, "black");
    await joinTeam(player3, "black");

    await makeMove(player1, "e2", "e4");
    await waitForMovePlayed(player2, "e4");

    await player2.click('button[aria-label="Resign"]');
    await waitForVoteBanner(player1);

    // Assert on Alice's view: "Yes (1)" button visible, "Yes: Bob" label visible
    await expect(player1.locator('button:has-text("Yes (1)")')).toBeVisible({
      timeout: 5000,
    });
    await expect(player1.getByText("Yes: Bob")).toBeVisible();

    await player3.click('button:has-text("Yes")');

    await expect(player1.locator(".chat-messages")).toContainText(
      "Resignation"
    );
    await expect(player1.locator('button[title="Copy PGN"]')).toBeVisible({
      timeout: 5000,
    });
  });

  test("team_vote_buttons_disabled_for_late_joiner", async ({
    browser,
  }, testInfo) => {
    const [player1, player2, player3] = await setupPlayers(
      browser,
      testInfo,
      3
    );
    await joinTeam(player1, "white");
    await joinTeam(player2, "black");
    await joinTeam(player3, "black");

    await makeMove(player1, "e2", "e4");
    await waitForMovePlayed(player2, "e4");

    await player2.click('button[aria-label="Resign"]');
    await waitForVoteBanner(player2);

    const [player4] = await setupPlayers(browser, testInfo, 1);
    await joinTeam(player4, "black");

    const p4Yes = player4.locator('button:has-text("Yes")');
    const p4No = player4.locator('button:has-text("No")');
    await expect(p4Yes).toBeVisible({ timeout: 5000 });
    await expect(p4Yes).toBeDisabled();
    await expect(p4No).toBeDisabled();

    const p3Yes = player3.locator('button:has-text("Yes")');
    const p3No = player3.locator('button:has-text("No")');
    await expect(p3Yes).toBeEnabled();
    await expect(p3No).toBeEnabled();
  });

  test("only_one_vote_at_a_time", async ({ browser }, testInfo) => {
    const [player1, player2, player3] = await setupPlayers(
      browser,
      testInfo,
      3
    );
    await joinTeam(player1, "white");
    await joinTeam(player2, "black");
    await joinTeam(player3, "black");

    await makeMove(player1, "e2", "e4");
    await waitForMovePlayed(player2, "e4");

    // Sanity: while no vote is active, the team vote triggers are available
    await expect(player3.locator('button[aria-label="Resign"]')).toBeVisible();

    await player2.click('button[aria-label="Resign"]');

    // The single shared banner is visible to everyone — including White…
    await expect(player1.locator(".vote-banner")).toBeVisible();
    await expect(player1.locator(".vote-banner-title")).toContainText("Resign");
    // …but White is not in the frozen electorate: buttons disabled
    await expect(player1.locator('button:has-text("Yes")')).toBeDisabled();
    await expect(player1.locator('button:has-text("No")')).toBeDisabled();

    // While the vote is active, the other team vote triggers are hidden
    await expect(
      player3.locator('button[aria-label="Resign"]')
    ).not.toBeVisible();
    await expect(
      player3.locator('button[aria-label="Offer Draw"]')
    ).not.toBeVisible();

    // The lead powers are not votes: they stay available throughout
    await expect(player1.locator('button[aria-label="Reset"]')).toBeVisible();
    await expect(
      player1.locator('.players-panel button:has-text("Kick")')
    ).toHaveCount(2);

    // Player 3 votes No — a unanimity vote fails instantly
    await player3.click('button:has-text("No")');

    // Banner gone, the team vote triggers are back
    await expect(player1.locator(".vote-banner")).not.toBeVisible();
    await expect(player3.locator('button[aria-label="Resign"]')).toBeVisible();
  });

  test("forfeit_countdown_and_vote_banner_stack", async ({
    browser,
  }, testInfo) => {
    // The countdown (TEAM_EMPTY_FORFEIT_MS, 30s) is served in real time here.
    test.setTimeout(90000);

    const [player1, player2, player3] = await setupPlayers(
      browser,
      testInfo,
      3
    );
    await joinTeam(player1, "white");
    await joinTeam(player2, "black");
    await joinTeam(player3, "black");

    await makeMove(player1, "e2", "e4");
    await waitForMovePlayed(player2, "e4");

    // White empties itself, arming the forfeit countdown. Black is untouched by
    // that and stays free to open a vote, so both deadlines run at once.
    await joinSpectators(player1);
    await expect(player2.locator(".forfeit-banner")).toBeVisible();

    await player2.click('button[aria-label="Resign"]');
    await expect(player2.locator(".vote-banner")).toBeVisible();

    // The two banners share one row and stack inside it. As separate grid items
    // assigned that single cell they were drawn one on top of the other.
    const vote = await player2.locator(".vote-banner").boundingBox();
    const forfeit = await player2.locator(".forfeit-banner").boundingBox();
    if (!vote || !forfeit) throw new Error("both banners should be laid out");
    expect(forfeit.y).toBeGreaterThanOrEqual(vote.y + vote.height);

    // What the order buys: Yes/No stays reachable, so the vote can still be
    // settled while the countdown runs.
    await player3.click('button:has-text("No")');
    await expect(player2.locator(".vote-banner")).not.toBeVisible();
    await expect(player2.locator(".forfeit-banner")).toBeVisible();
  });
});

test.describe("Draw Offers", () => {
  test("draw_by_agreement", async ({ browser }, testInfo) => {
    const [player1, player2, player3] = await setupPlayers(
      browser,
      testInfo,
      3
    );
    await joinTeam(player1, "white");

    await joinTeam(player2, "black");

    await joinTeam(player3, "black");

    await makeMove(player1, "e2", "e4");
    await waitForMovePlayed(player1, "e4");

    await player1.click('button[aria-label="Offer Draw"]');
    await player1.getByRole("button", { name: "Confirm" }).click();
    await waitForVoteBanner(player2);

    await player2.click('button:has-text("Yes")');
    await waitForYesVotes(player3, 1);
    await player3.click('button:has-text("Yes")');

    // Assert: Game is over — "Copy PGN" button appears
    await expect(player1.locator('button[title="Copy PGN"]')).toBeVisible({
      timeout: 5000,
    });

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
    await joinTeam(player1, "white");

    await joinTeam(player2, "black");

    await joinTeam(player3, "black");

    await makeMove(player1, "e2", "e4");
    await waitForMovePlayed(player2, "e4");

    await player2.click('button[aria-label="Offer Draw"]');
    await waitForVoteBanner(player3);

    // Draw is offered to white → accept_draw vote starts for white
    await player3.click('button:has-text("Yes")');

    await player1.getByRole("button", { name: /^Yes/ }).click();

    // Assert: Game is over — "Copy PGN" button appears
    await expect(player1.locator('button[title="Copy PGN"]')).toBeVisible({
      timeout: 5000,
    });

    await expect(player1.locator(".chat-messages")).toContainText(
      "Draw agreed"
    );
  });
});
