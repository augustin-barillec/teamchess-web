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
  await page.click(`.player-section:has(h3:has-text("${heading}")) .join-btn`);
  await page.waitForTimeout(500);
}

export async function joinSpectators(page: Page): Promise<void> {
  await page.click('.player-section:has(h3:has-text("Spectators")) .join-btn');
  await page.waitForTimeout(500);
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
