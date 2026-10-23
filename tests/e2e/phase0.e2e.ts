import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT } from '../helpers/data';
import { serveDirectory } from './server';

/**
 * The Phase 0 "done when" list and the shell's behaviour, checked in a real browser against the
 * single-file preview build (which includes the debug panel). Run with `npm run e2e`.
 */

const DIST = join(ROOT, 'dist-preview');
let browser: Browser;
let server: Server;
let url: string;

beforeAll(async () => {
  if (!existsSync(join(DIST, 'opsim-preview.html'))) {
    throw new Error(
      'dist-preview/opsim-preview.html is missing. Run `npm run build:preview` first (npm run e2e does).',
    );
  }
  ({ url, server } = await serveDirectory(DIST));
  try {
    browser = await chromium.launch();
  } catch (error) {
    throw new Error(
      `Could not start Chromium (${(error as Error).message}). Install it with: npx playwright-core install chromium`,
    );
  }
});

afterAll(async () => {
  await browser?.close();
  server?.close();
});

interface Session {
  context: BrowserContext;
  page: Page;
  problems: string[];
}

/** A fresh browser profile (empty IndexedDB) with console problems recorded. */
async function open(
  options: {
    width?: number;
    height?: number;
    scheme?: 'light' | 'dark';
    context?: BrowserContext;
  } = {},
): Promise<Session> {
  const context =
    options.context ??
    (await browser.newContext({
      viewport: { width: options.width ?? 1440, height: options.height ?? 900 },
      colorScheme: options.scheme ?? 'light',
      acceptDownloads: true,
    }));
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(url);
  await ready(page);
  return { context, page, problems };
}

async function ready(page: Page): Promise<void> {
  await page.waitForSelector('.shell');
  await page.waitForFunction(
    () => (document.querySelector('.masthead__title')?.textContent ?? '').length > 0,
  );
}

const openDebug = async (page: Page) => {
  if (await page.locator('.debug:not([hidden])').count()) return;
  await page.keyboard.press('`');
  await page.waitForSelector('.debug:not([hidden])');
  await page.waitForFunction(() =>
    /^[0-9a-f]{32}$/.test(document.querySelector('#dbg-hash')?.textContent ?? ''),
  );
};

const confirm = async (page: Page, scope: string, label: string) => {
  await page.locator(`${scope} button`, { hasText: label }).first().click();
  await page.locator(`${scope} button.is-armed`).first().click();
};

/** Start a world through the debug panel: given seed, entropy probe and test entity on. */
async function startWorld(page: Page, seed: string) {
  await openDebug(page);
  await page.locator('#debug-panel-world input[type="text"]').fill(seed);
  await confirm(page, '#debug-panel-world', 'Start with this seed');
  await page.waitForFunction((s) => document.querySelector('#dbg-seed')?.textContent === s, seed);
}

const clock = async (page: Page) => Number(await page.locator('.shell').getAttribute('data-tick'));

/** Press a tick button and wait until the clock has actually moved that far. */
const tick = async (page: Page, months: 1 | 12 | 468) => {
  const target = Math.min(468, (await clock(page)) + months);
  await page.locator('#debug-panel-world button', { hasText: `Tick x${months}` }).click();
  await page.waitForFunction(
    (t) => document.querySelector('.shell')?.getAttribute('data-tick') === String(t),
    target,
  );
};
const route = (page: Page) => page.locator('.shell').getAttribute('data-route');
const textOf = async (page: Page, selector: string) =>
  ((await page.locator(selector).first().textContent()) ?? '').replace(/\s+/g, ' ').trim();
/** Retry until the element's text satisfies the matcher (the page updates asynchronously). */
const eventually = (page: Page, selector: string) =>
  expect.poll(() => textOf(page, selector), { timeout: 10_000 });
const stateHash = async (page: Page) => {
  await page.waitForFunction(() =>
    /^[0-9a-f]{32}$/.test(document.querySelector('#dbg-hash')?.textContent ?? ''),
  );
  return (await page.locator('#dbg-hash').textContent()) as string;
};
const title = async (page: Page) => (await page.locator('.masthead__title').textContent())?.trim();

describe('starting up', () => {
  it('runs the simulation in a real Web Worker, with a clean console', async () => {
    const { page, problems, context } = await open();
    await page.getByRole('link', { name: 'World' }).click();
    await eventually(page, '.panel--side').toContain('a Web Worker');
    expect(await title(page)).toBe('January, Year 0');
    expect(problems).toEqual([]);
    await context.close();
  });

  it('every control is usable from the keyboard', async () => {
    const { page, context } = await open();
    await page.locator('button', { hasText: 'Next month' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => document.querySelector('.masthead__title')?.textContent === 'February, Year 0',
    );
    expect(await page.locator('.controls__status').textContent()).toBe('Advanced 1 month.');
    await context.close();
  });
});

describe('the debug panel', () => {
  it("shows the plan's modifier stack for a test entity: Strength 74 = 50 + 12 + 8 + 4", async () => {
    const { page, context, problems } = await open();
    await openDebug(page);
    await confirm(page, '#debug-panel-world', 'Reroll seed');
    await page.getByRole('tab', { name: 'Entities' }).click();
    await page.waitForSelector('.stat');
    expect(await page.locator('.stat__description').allTextContents()).toEqual([
      'Endurance 35 = 35 base',
      'Speed 70 = (40 base + 6 training + 10 Tailwind (temporary)) x 1.25 (+25% Quick (trait))',
      'Strength 74 = 50 base + 12 training + 8 Brawler (trait) + 4 Cutlass (weapon)',
    ]);
    expect(problems).toEqual([]);
    await context.close();
  });

  it('shows the same stack in a tooltip on hover', async () => {
    const { page, context } = await open();
    await openDebug(page);
    await confirm(page, '#debug-panel-world', 'Reroll seed');
    await page.getByRole('tab', { name: 'Entities' }).click();
    await page.locator('.stat[data-stat="strength"] .stat__total').hover();
    await eventually(page, '[role="tooltip"]').toContain('Brawler (trait)');
    await page.mouse.move(5, 5);
    await expect.poll(() => page.locator('[role="tooltip"]').count()).toBe(0);
    await context.close();
  });

  it('a skip stops on a decision, and the choice chains a follow-up two months later', async () => {
    const { page, context } = await open();
    await openDebug(page);
    await page.locator('#debug-panel-world select').selectOption('evt_test_crossroads');
    await page.locator('#debug-panel-world button', { hasText: 'Force event' }).click();
    await page.getByRole('button', { name: 'Skip 3 months' }).click();
    await page.waitForSelector('.decision');
    expect(await page.locator('.controls__status').textContent()).toBe(
      'Stopped after 1 month: a decision is waiting.',
    );
    expect(await page.getByRole('button', { name: 'Next month' }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: /Take the left path/ }).click();
    await page.waitForSelector('.decision', { state: 'detached' });
    await page.getByRole('button', { name: 'Skip 3 months' }).click();
    await eventually(page, '.panel--feed').toContain(
      'The consequences of the crossroads reach you in April',
    );
    await context.close();
  });
});

describe('saving (Phase 0 "done when")', () => {
  it('save, reload the page, and the state hash still matches', async () => {
    const { page, context } = await open();
    await startWorld(page, 'e2e-reload');
    await tick(page, 12);
    const before = await stateHash(page);
    const dateBefore = await title(page);
    expect(dateBefore).toBe('January, Year 1');

    await page.reload();
    await ready(page);
    expect(await title(page)).toBe(dateBefore);
    await openDebug(page);
    expect(await stateHash(page)).toBe(before);
    await eventually(page, '#debug-panel-world .debug__note[data-kind="ok"]').toContain(
      'They match.',
    );
    expect(await page.locator('.controls__status').textContent()).toContain(
      'Its state hash matches the save',
    );
    await context.close();
  });

  it('a world resumed after a reload carries on exactly like one that never stopped', async () => {
    const interrupted = await open();
    await startWorld(interrupted.page, 'e2e-continue');
    await tick(interrupted.page, 12);
    await interrupted.page.reload();
    await ready(interrupted.page);
    await openDebug(interrupted.page);
    for (let i = 0; i < 2; i++) await tick(interrupted.page, 12);
    const resumed = await stateHash(interrupted.page);

    const straight = await open();
    await startWorld(straight.page, 'e2e-continue');
    for (let i = 0; i < 3; i++) await tick(straight.page, 12);
    expect(await stateHash(straight.page)).toBe(resumed);
    await interrupted.context.close();
    await straight.context.close();
  });

  it('survives a close and reopen of the browser tab, not just a reload', async () => {
    const first = await open();
    await startWorld(first.page, 'e2e-newtab');
    await tick(first.page, 12);
    const hash = await stateHash(first.page);
    await first.page.close();

    const second = await open({ context: first.context });
    await openDebug(second.page);
    expect(await stateHash(second.page)).toBe(hash);
    await first.context.close();
  });

  it('exports a .opsim file that imports into a brand-new browser with the same state hash', async () => {
    const source = await open();
    await startWorld(source.page, 'e2e-export');
    await tick(source.page, 12);
    await tick(source.page, 12);
    const hash = await stateHash(source.page);

    await source.page.getByRole('button', { name: 'Menu' }).click();
    const [download] = await Promise.all([
      source.page.waitForEvent('download'),
      source.page.getByRole('button', { name: 'Export this world' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('opsim-e2e-export-tick24.opsim');
    const folder = mkdtempSync(join(tmpdir(), 'opsim-e2e-'));
    const path = join(folder, download.suggestedFilename());
    await download.saveAs(path); // Playwright deletes its own copy when the context closes
    const bytes = readFileSync(path);
    expect([...bytes.subarray(0, 5)].map((b) => String.fromCharCode(b)).join('')).toBe('OPSIM');
    await source.context.close();

    // A different browser profile: nothing in storage.
    const target = await open();
    expect(await title(target.page)).toBe('January, Year 0');
    await target.page.getByRole('button', { name: 'Menu' }).click();
    await target.page.locator('.modal input[type="file"]').setInputFiles(path);
    await target.page.waitForSelector('.modal', { state: 'detached' });
    expect(await title(target.page)).toBe('January, Year 2');
    await openDebug(target.page);
    expect(await stateHash(target.page)).toBe(hash);
    expect(await target.page.locator('#dbg-seed').textContent()).toBe('e2e-export');
    expect(await target.page.locator('.controls__status').textContent()).toContain(
      'matches the save',
    );
    await target.context.close();
    rmSync(folder, { recursive: true, force: true });
  });

  it('rejects a file that is not a save, leaving the world alone', async () => {
    const { page, context } = await open();
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.locator('.modal input[type="file"]').setInputFiles({
      name: 'notes.opsim',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('this is not a save'),
    });
    await eventually(page, '.menu__message[data-kind="error"]').toContain(
      'not an .opsim save file',
    );
    await page.keyboard.press('Escape');
    expect(await title(page)).toBe('January, Year 0');
    await context.close();
  });

  it('keeps manual saves, and loads one back after a reload', async () => {
    const { page, context } = await open();
    await startWorld(page, 'e2e-manual');
    await tick(page, 12);
    await page.getByRole('button', { name: 'Menu' }).click();
    await page
      .locator('.slot', { hasText: 'Slot 2' })
      .getByRole('button', { name: 'Save here' })
      .click();
    await eventually(page, '.menu__message').toBe('Saved to Slot 2.');
    await page.keyboard.press('Escape');
    await tick(page, 12);
    expect(await title(page)).toBe('January, Year 2');

    await page.reload();
    await ready(page);
    await page.getByRole('button', { name: 'Menu' }).click();
    await confirm(page, '.slot:has-text("Slot 2")', 'Load');
    await page.waitForSelector('.modal', { state: 'detached' });
    expect(await title(page)).toBe('January, Year 1');
    await context.close();
  });
});

describe('layout', () => {
  it('shows the chronicle and the side panel together on a wide screen, with no Feed tab', async () => {
    const { page, context } = await open({ width: 1280, height: 800 });
    const feed = (await page.locator('.panel--feed').boundingBox())!;
    const side = (await page.locator('.panel--side').boundingBox())!;
    expect(feed.x).toBeLessThan(side.x);
    expect(Math.abs(feed.y - (await page.locator('.tabs').boundingBox())!.y)).toBeLessThan(2);
    expect(side.y).toBeGreaterThan(feed.y);
    expect(await page.locator('.tab--feed').isVisible()).toBe(false);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await context.close();
  });

  it('is one column on a phone: sections become tabs and only one panel shows at a time', async () => {
    const { page, context } = await open({ width: 390, height: 844 });
    expect(await page.locator('.tab--feed').isVisible()).toBe(true);
    expect(await page.locator('.panel--feed').isVisible()).toBe(true);
    expect(await page.locator('.panel--side').isVisible()).toBe(false);
    await page.getByRole('link', { name: 'World' }).click();
    await expect.poll(() => route(page)).toBe('world');
    expect(await page.locator('.panel--feed').isVisible()).toBe(false);
    await expect.poll(() => page.locator('.panel--side').isVisible()).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await context.close();
  });

  it('the browser Back button returns to the previous section', async () => {
    const { page, context } = await open({ width: 390, height: 844 });
    await page.getByRole('link', { name: 'World' }).click();
    await expect.poll(() => route(page)).toBe('world');
    await page.getByRole('link', { name: 'News' }).click();
    await expect.poll(() => route(page)).toBe('news');
    await page.goBack();
    await expect.poll(() => route(page)).toBe('world');
    await page.goBack();
    await expect.poll(() => route(page)).toBe('feed');
    await context.close();
  });

  it('keeps the time controls reachable on a phone', async () => {
    const { page, context } = await open({ width: 390, height: 844 });
    const next = (await page.getByRole('button', { name: 'Next month' }).boundingBox())!;
    expect(next.y + next.height).toBeLessThanOrEqual(844);
    expect(next.height).toBeGreaterThanOrEqual(44);
    await context.close();
  });
});

describe('dialogs', () => {
  for (const [width, height] of [
    [1440, 900],
    [1280, 600],
    [390, 640],
  ] as const) {
    it(`the menu fits a ${width}x${height} window and its last section can be reached`, async () => {
      const { page, context } = await open({ width, height });
      await page.getByRole('button', { name: 'Menu' }).click();
      await page.waitForSelector('.slot');
      const box = (await page.locator('.modal').boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      // "Appearance" is the last section, below thirteen save slots: a user must be able to scroll to it.
      await page.locator('.modal input[value="dark"]').scrollIntoViewIfNeeded();
      const radio = (await page.locator('.modal input[value="dark"]').boundingBox())!;
      expect(radio.y + radio.height).toBeLessThanOrEqual(height);
      await page.locator('.modal input[value="dark"]').check();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
        .toBe('dark');
      await context.close();
    });
  }
});

describe('themes', () => {
  const background = (page: Page) =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  it('follows the device: foam in light, deep sea in dark', async () => {
    const light = await open({ scheme: 'light' });
    expect(await background(light.page)).toBe('rgb(237, 243, 241)');
    await light.context.close();
    const dark = await open({ scheme: 'dark' });
    expect(await background(dark.page)).toBe('rgb(13, 34, 48)');
    await dark.context.close();
  });

  it('can be overridden from the menu, and the choice survives a reload', async () => {
    const { page, context } = await open({ scheme: 'dark' });
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.locator('.modal input[value="light"]').check();
    await page.keyboard.press('Escape');
    await expect.poll(() => background(page)).toBe('rgb(237, 243, 241)');
    await page.reload();
    await ready(page);
    await expect.poll(() => background(page)).toBe('rgb(237, 243, 241)');
    await context.close();
  });
});
