import { mkdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';

export const RESULTS_DIR = resolve('test-results');

export interface Fixture {
  url: string;
  title: string;
}

export interface Harness {
  browser: Browser;
  extensionId: string;
  /** An extension page used to call chrome.* APIs; it stays in its own window. */
  control: Page;
  close(): Promise<void>;
}

/**
 * Serves every host from one local server, so fixture tabs get real-looking URLs without
 * touching the network. Fixtures use `.test` hosts: real ones like github.com are
 * HSTS-preloaded and would be forced to https. Titles come from `titles`, keyed by host + path.
 */
function startServer(titles: Map<string, string>): Promise<Server> {
  const server = createServer((req, res) => {
    const key = `${req.headers.host}${req.url?.split(/[?#]/)[0]}`;
    const title = titles.get(key) ?? key;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>${title.replace(/</g, '&lt;')}</title><h1>${title.replace(/</g, '&lt;')}</h1>`);
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

export const pageTitles = new Map<string, string>();

export async function launch(): Promise<Harness> {
  await mkdir(RESULTS_DIR, { recursive: true });
  const server = await startServer(pageTitles);
  const { port } = server.address() as AddressInfo;
  const browser = await puppeteer.launch({
    headless: true,
    enableExtensions: true,
    args: [`--host-resolver-rules=MAP * 127.0.0.1:${port}`, '--disable-features=HttpsUpgrades', '--window-size=1200,800'],
  });
  const extensionId = await browser.installExtension(resolve('dist'));
  const control = await browser.newPage();
  await control.goto(`chrome-extension://${extensionId}/popup.html?control`);
  return {
    browser,
    extensionId,
    control,
    async close() {
      await browser.close();
      server.close();
    },
  };
}

export function fixtureUrl(url: string, title: string): string {
  const u = new URL(url);
  pageTitles.set(`${u.host}${u.pathname}`, title);
  return url;
}

/** Closes every tab and window except the control page and removes all bookmarks. */
export async function reset(h: Harness): Promise<void> {
  await h.control.evaluate(async () => {
    const self = await chrome.tabs.getCurrent();
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.filter((t) => t.id !== self!.id).map((t) => chrome.tabs.remove(t.id!)));
    for (const root of await chrome.bookmarks.getChildren('0')) {
      for (const child of await chrome.bookmarks.getChildren(root.id)) await chrome.bookmarks.removeTree(child.id);
    }
  });
}

export interface SeedTab {
  url: string;
  title: string;
  /** Tabs with the same window number open in the same new window. */
  window?: number;
}

export interface SeedBookmark {
  title: string;
  url: string;
  /** Folder path under the bookmarks bar, e.g. ['Work', 'Deep']. */
  folder?: string[];
}

/** Opens fixture tabs (in new windows, grouped by `window`) and creates bookmarks. Returns tab ids in order. */
export async function seed(h: Harness, tabs: SeedTab[], bookmarks: SeedBookmark[] = []): Promise<number[]> {
  for (const t of tabs) fixtureUrl(t.url, t.title);
  return h.control.evaluate(
    async (tabs, bookmarks) => {
      const windows = new Map<number, number>();
      const ids: number[] = [];
      for (const t of tabs) {
        const key = t.window ?? 1;
        let windowId = windows.get(key);
        if (windowId === undefined) {
          const w = await chrome.windows.create({ url: t.url, focused: true });
          windowId = w!.id!;
          windows.set(key, windowId);
          ids.push(w!.tabs![0]!.id!);
        } else {
          const tab = await chrome.tabs.create({ url: t.url, windowId, active: true });
          ids.push(tab.id!);
        }
      }

      for (const b of bookmarks) {
        let parentId = '1';
        for (const name of b.folder ?? []) {
          const existing = (await chrome.bookmarks.getChildren(parentId)).find((n) => !n.url && n.title === name);
          parentId = existing ? existing.id : (await chrome.bookmarks.create({ parentId, title: name })).id;
        }
        await chrome.bookmarks.create({ parentId, title: b.title, url: b.url });
      }

      // Wait until titles are loaded, so the popup sees them.
      for (let i = 0; i < 100; i++) {
        const all = await Promise.all(ids.map((id) => chrome.tabs.get(id)));
        if (all.every((t) => t.status === 'complete')) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      return ids;
    },
    tabs,
    bookmarks,
  );
}

/** Focuses a tab and its window, like a user would before pressing the shortcut. */
export async function focusTab(h: Harness, tabId: number): Promise<void> {
  await h.control.evaluate(async (tabId) => {
    const tab = await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab!.windowId, { focused: true });
  }, tabId);
}

export interface BrowserState {
  activeTabId: number;
  activeUrl: string;
  focusedWindowId: number;
  tabCount: number;
  urls: string[];
}

export async function state(h: Harness): Promise<BrowserState> {
  return h.control.evaluate(async () => {
    const self = await chrome.tabs.getCurrent();
    const focused = await chrome.windows.getLastFocused({ populate: true });
    const active = focused.tabs!.find((t) => t.active)!;
    const tabs = (await chrome.tabs.query({})).filter((t) => t.id !== self!.id);
    return {
      activeTabId: active.id!,
      activeUrl: active.url || active.pendingUrl || '',
      focusedWindowId: focused.id!,
      tabCount: tabs.length,
      urls: tabs.map((t) => t.url || t.pendingUrl || ''),
    };
  });
}

/**
 * Polls the browser state until `ready` holds (or 2 s pass), then returns it. Actions are dispatched
 * as the popup closes, so tabs.query can briefly report the previous state.
 */
export async function settledState(h: Harness, ready: (s: BrowserState) => boolean): Promise<BrowserState> {
  let s = await state(h);
  for (let i = 0; i < 40 && !ready(s); i++) {
    await new Promise((r) => setTimeout(r, 50));
    s = await state(h);
  }
  return s;
}

/**
 * Opens the real action popup for the given tab, as a toolbar click would.
 * The keyboard shortcut itself cannot be pressed from CDP; that stays a manual check.
 */
export async function openPopup(h: Harness, tabId: number): Promise<Page> {
  await focusTab(h, tabId);
  const page = await findPageForTab(h, tabId);
  const extension = (await h.browser.extensions()).get(h.extensionId)!;
  const target = h.browser.waitForTarget((t) => t.url() === `chrome-extension://${h.extensionId}/popup.html`);
  await page.triggerExtensionAction(extension);
  const popup = (await (await target).asPage())!;
  await popup.waitForSelector('#results .row, #status:not(:empty)');
  return popup;
}

async function findPageForTab(h: Harness, tabId: number): Promise<Page> {
  const url = await h.control.evaluate(async (id) => (await chrome.tabs.get(id)).url!, tabId);
  const page = (await h.browser.pages()).find((p) => p.url() === url);
  if (!page) throw new Error(`No page for tab ${tabId} (${url})`);
  return page;
}

/** Waits for the popup document to go away (it closes itself after an action). */
export async function waitClosed(popup: Page): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (popup.isClosed()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Popup did not close');
}

export async function titles(popup: Page): Promise<string[]> {
  return popup.$$eval('#results .title', (els) => els.map((e) => e.textContent ?? ''));
}

export async function selectedTitle(popup: Page): Promise<string | undefined> {
  return popup.$eval('#results [aria-selected="true"] .title', (e) => e.textContent ?? undefined).catch(() => undefined);
}
