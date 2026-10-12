import type { Page } from 'puppeteer';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, launch, RESULTS_DIR, reset, seed, settledState } from './harness';

let h: Harness;

beforeAll(async () => {
  h = await launch();
});

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  await reset(h);
});

/** Opens a new tab like ⌘T would (no URL = the New Tab page) and returns Summon's page in it. */
async function openNewTab(): Promise<{ page: Page; tabId: number }> {
  const first = await h.control.evaluate(async () => (await chrome.tabs.create({ active: true })).id!);
  // The worker replaces the New Tab with a tab it created (that one gets page focus).
  const target = await h.browser.waitForTarget((t) => t.url().endsWith('/newtab.html?replaced'), { timeout: 5000 });
  const page = (await target.page())!;
  await page.waitForSelector('.query');
  const replacement = await h.control.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]!.id!, target.url());
  expect(replacement).not.toBe(first);
  return { page, tabId: replacement };
}

const rowTitles = (page: Page) => page.$$eval('.row .title', (els) => els.map((e) => e.textContent));

describe('new tab page', () => {
  it('lists recent tabs; Enter switches to the previous one and closes the blank tab', async () => {
    const [docs] = await seed(h, [{ url: 'http://docs.google.test/document/d/1', title: 'Roadmap Q4 - Google Docs' }]);
    const { page, tabId } = await openNewTab();
    await page.waitForSelector('.row');
    expect(await rowTitles(page)).toEqual(['Roadmap Q4 - Google Docs']);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.screenshot({ path: `${RESULTS_DIR}/newtab-light.png` });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await page.screenshot({ path: `${RESULTS_DIR}/newtab-dark.png` });
    // The tab closes during the key press, so the key-up can fail.
    await page.keyboard.press('Enter').catch(() => {});
    const s = await settledState(h, (s) => s.activeTabId === docs && !s.urls.some((u) => u.includes('newtab')));
    expect(s.activeTabId).toBe(docs);
    expect(await h.control.evaluate((id) => chrome.tabs.get(id).then(() => true, () => false), tabId)).toBe(false);
  });

  it('opens a bookmark in place of the blank tab', async () => {
    await seed(h, [], [{ title: 'KitDev', url: 'http://kit.test/dev' }]);
    const { page, tabId } = await openNewTab();
    await page.keyboard.type('kd');
    await page.waitForFunction(() => document.querySelector('.row[aria-selected="true"] .title')?.textContent === 'KitDev');
    expect(await page.$eval('.hints', (e) => e.textContent)).toContain('Open in this tab');
    await page.keyboard.press('Enter');
    const s = await settledState(h, (s) => s.urls.includes('http://kit.test/dev'));
    expect(s.tabCount).toBe(1);
    expect(s.activeTabId).toBe(tabId);
  });

  it('clears the field on Escape', async () => {
    await seed(h, [{ url: 'http://news.example.test/', title: 'Hacker News' }]);
    const { page } = await openNewTab();
    await page.keyboard.type('zzz');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.row');
    expect(await page.$eval('.query', (e) => (e as HTMLInputElement).value)).toBe('');
  });

  it('shows frequent picks as chips; ⌥1 opens the first in place', async () => {
    await seed(h, [], [
      { title: 'KitDev', url: 'http://kit.test/dev' },
      { title: 'AppDev1', url: 'http://app.test/' },
    ]);
    const now = Date.now();
    await h.control.evaluate(async (now) => {
      const pick = (n: number) => ({ n, weight: n, last: now });
      await chrome.storage.local.set({
        memory: { version: 1, picks: { kd: { 'http://kit.test/dev': pick(3) }, ad: { 'http://app.test/': pick(2) } }, similar: {} },
      });
    }, now);
    const { page, tabId } = await openNewTab();
    await page.waitForSelector('.chip');
    expect(await page.$$eval('.chip .chip-name', (els) => els.map((e) => e.textContent))).toEqual(['KitDev', 'AppDev1']);
    expect(await page.$eval('.clock time', (e) => e.textContent)).toMatch(/\d/);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.screenshot({ path: `${RESULTS_DIR}/newtab-extras-light.png` });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await page.screenshot({ path: `${RESULTS_DIR}/newtab-extras-dark.png` });

    // Chips step aside while searching.
    await page.keyboard.type('k');
    expect(await page.$eval('.chips', (e) => (e as HTMLElement).hidden)).toBe(true);
    await page.keyboard.press('Escape');

    await page.keyboard.down('Alt');
    await page.keyboard.press('Digit1');
    await page.keyboard.up('Alt');
    const s = await settledState(h, (s) => s.urls.includes('http://kit.test/dev'));
    expect(s.tabCount).toBe(1);
    expect(s.activeTabId).toBe(tabId);
  });
});
