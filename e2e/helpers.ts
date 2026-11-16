import { expect } from "@playwright/test";
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";

export const BASE_PORT = 8080;
export const VIDEO_DIR = "test-results/videos";

export function workerPort(workerIndex: number): number {
  return BASE_PORT + workerIndex;
}

export function workerProject(workerIndex: number): string {
  return `teamchess-test-${workerIndex}`;
}

export function baseURL(testInfo: TestInfo): string {
  return `http://localhost:${workerPort(testInfo.workerIndex)}`;
}

export const trackedPages: Page[] = [];
export const trackedContexts: BrowserContext[] = [];

export function resetTracking(): void {
  trackedPages.length = 0;
  trackedContexts.length = 0;
}

export async function createPlayer(
  browser: Browser,
  url: string
): Promise<Page> {
  const context = await browser.newContext({
    baseURL: url,
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  trackedPages.push(page);
  trackedContexts.push(context);
  return page;
}

export async function setupPlayers(
  browser: Browser,
  testInfo: TestInfo,
  n: number
): Promise<Page[]> {
  const url = baseURL(testInfo);
  const pages: Page[] = [];
  for (let i = 0; i < n; i++) {
    pages.push(await createPlayer(browser, url));
  }
  for (const p of pages) await p.goto("/");
  for (const p of pages) await p.waitForSelector(".app-container");
  return pages;
}

export async function joinTeam(
  page: Page,
  side: "white" | "black"
): Promise<void> {
  const heading = side === "white" ? "White" : "Black";
  const btn = page.locator(
    `.player-section:has(h3:has-text("${heading}")) .join-btn`
  );
  await btn.click();
  // A section offers Join only while you are not in it: once the round-trip has
  // landed, this one stops offering.
  await expect(btn).toHaveCount(0, { timeout: 10_000 });
}

export async function joinSpectators(page: Page): Promise<void> {
  const btn = page.locator(
    '.player-section:has(h3:has-text("Spectators")) .join-btn'
  );
  await btn.click();
  await expect(btn).toHaveCount(0, { timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Waiting on state rather than on the clock.
//
// A fixed sleep encodes a guess about how long the network and Stockfish will
// take, and the guess has to be generous enough for the slowest run — which is
// what put pawn_promotion_to_queen within seconds of its own timeout. Each helper
// below waits for the thing the test actually depends on, so a fast run stays
// fast and a slow one still passes.
// ---------------------------------------------------------------------------

/**
 * Waits for a move to have actually been played, instead of sleeping and hoping.
 * The moves list only ever lists turns the engine has already resolved, so the SAN
 * showing up there is the signal that the turn closed and the board moved on.
 */
export async function waitForMovePlayed(
  page: Page,
  san: string,
  timeout = 15_000
): Promise<void> {
  await expect(
    page.locator(".moves-list").getByText(san, { exact: true }).first()
  ).toBeVisible({ timeout });
}

/**
 * Waits until it is this player's turn to move. The clock under the board is the
 * one the app itself lights up for the side to move, so it only goes active once
 * both the selected move and the turn change have landed here — exactly the
 * precondition `makeMove` needs, since a drop out of turn is discarded.
 */
export async function waitForMyTurn(
  page: Page,
  timeout = 15_000
): Promise<void> {
  await expect(page.locator(".bottom-clock-row .clock-box")).toHaveClass(
    /active/,
    { timeout }
  );
}

/**
 * Waits until `count` members of the side to move are ticked as having proposed.
 * Only the side to move ever shows the tick, so this counts the current turn.
 */
export async function waitForProposals(
  page: Page,
  count: number
): Promise<void> {
  await expect(page.locator(".player-played-check")).toHaveCount(count, {
    timeout: 10_000,
  });
}

/** Waits for the single shared vote banner to reach this player. */
export async function waitForVoteBanner(page: Page): Promise<void> {
  await expect(page.locator(".vote-banner")).toBeVisible({ timeout: 10_000 });
}

/** Waits for the vote tally to reach `count` — the Yes button carries it. */
export async function waitForYesVotes(
  page: Page,
  count: number
): Promise<void> {
  await expect(
    page.getByRole("button", { name: `Yes (${count})` })
  ).toBeVisible({ timeout: 10_000 });
}

export async function makeMove(
  page: Page,
  from: string,
  to: string
): Promise<void> {
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

/**
 * Picks a piece in the promotion dialog (1 = queen). The dialog opens on a drop,
 * and the drag library swallows every click for 50ms after one — dnd-kit keeps its
 * click-stopping listener on the document that long. A click sent the instant the
 * dialog shows lands 50 to 70ms after the drop: sometimes inside that window, where
 * it does nothing at all. No player is that fast, a test is — so click until the
 * dialog has actually gone.
 */
export async function choosePromotion(page: Page, nth = 1): Promise<void> {
  const dialog = page.locator(".promotion-dialog");
  await expect(async () => {
    await dialog
      .locator(`.promotion-choices button:nth-child(${nth})`)
      .click({ timeout: 1_000 });
    await expect(dialog).toBeHidden({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}
