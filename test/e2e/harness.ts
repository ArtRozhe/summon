import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
  /** An extension page used to call chrome.* APIs; it stays in its own window. Replaced by `reloadExtension`. */
  control: Page;
  close(): Promise<void>;
}

/**
 * A page with some color and text, so screenshots show the glass blurring real content. It counts
 * keydowns the page itself receives (`window.__pageKeys`), to check the panel keeps keys to itself.
 */
function fixturePage(title: string, inlineScript: boolean): string {
  const t = title.replace(/</g, '&lt;');
  const cards = ['#ff6b6b', '#ffd166', '#06d6a0', '#118ab2', '#8338ec', '#ef476f']
    .map((c, i) => `<div style="background:${c}">Card ${i + 1}</div>`)
    .join('');
  return `<!doctype html><meta charset="utf-8"><title>${t}</title><link rel="icon" href="/favicon.svg">
<style>
  body { margin: 0; font: 16px/1.5 system-ui; color: #222; background: #fafafa; }
  @media (prefers-color-scheme: dark) { body { color: #ddd; background: #16161a; } }
  header { padding: 24px 40px; background: linear-gradient(90deg, #4361ee, #f72585); color: #fff; }
  main { padding: 24px 40px; } p { max-width: 70ch; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 24px; }
  .cards div { height: 120px; border-radius: 12px; color: #fff; font-weight: 700; padding: 16px; }
</style>
<header><h1>${t}</h1></header>
<main><p>${'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore. '.repeat(3)}</p>
<div class="cards">${cards}</div></main>
${inlineScript ? '<script>window.__pageKeys = 0; document.addEventListener("keydown", () => window.__pageKeys++);</script>' : ''}`;
}

/**
 * Serves every host from one local server, so fixture tabs get real-looking URLs without
 * touching the network. Fixtures use `.test` hosts: real ones like github.com are
 * HSTS-preloaded and would be forced to https. Titles come from `titles`, keyed by host + path.
 * Paths starting with `/csp` are served with a strict Content-Security-Policy (no inline styles or scripts).
 * `/favicon.svg` gives every host a site icon, except `noicon.*` hosts.
 */
function startServer(titles: Map<string, string>): Promise<Server> {
  const server = createServer((req, res) => {
    const path = req.url?.split(/[?#]/)[0] ?? '/';
    const key = `${req.headers.host}${path}`;
    const title = titles.get(key) ?? key;
    if (path === '/favicon.svg') {
      // Every host has an icon except `noicon.*`, which keeps its letter tile.
      if (req.headers.host?.startsWith('noicon.')) return void res.writeHead(404).end();
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      return void res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#e8590c"/><circle cx="16" cy="16" r="7" fill="#fff"/></svg>');
    }
    const strict = path.startsWith('/csp');
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      ...(strict ? { 'content-security-policy': "default-src 'none'; style-src 'self'; script-src 'self'" } : {}),
    });
    res.end(fixturePage(title, !strict));
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

export const pageTitles = new Map<string, string>();

async function extensionDir(grant: string[]): Promise<string> {
  if (!grant.length) return resolve('dist');
  const dir = resolve('test-results', 'dist-granted');
  await rm(dir, { recursive: true, force: true });
  await cp(resolve('dist'), dir, { recursive: true });
  const manifest = JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8'));
  manifest.permissions = [...manifest.permissions, ...grant];
  manifest.optional_permissions = (manifest.optional_permissions ?? []).filter((p: string) => !grant.includes(p));
  await writeFile(resolve(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

/**
 * `grant`: optional permissions to grant up front. Chrome asks for them in a prompt automation can't click,
 * so the extension is installed from a copy of `dist` with them moved into `permissions`.
 */
export async function launch(options: { grant?: string[] } = {}): Promise<Harness> {
  await mkdir(RESULTS_DIR, { recursive: true });
  const server = await startServer(pageTitles);
  const { port } = server.address() as AddressInfo;
  const browser = await puppeteer.launch({
    headless: true,
    enableExtensions: true,
    args: [`--host-resolver-rules=MAP * 127.0.0.1:${port}`, '--disable-features=HttpsUpgrades', '--window-size=1200,800'],
  });
  const extensionId = await browser.installExtension(await extensionDir(options.grant ?? []));
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

/**
 * Reloads the extension, as ↻ on its card does after an update, and reopens the control page.
 * Pages that were open keep running, with the old overlay script orphaned in them.
 */
export async function reloadExtension(h: Harness): Promise<void> {
  // Loading the same unpacked folder again is what ↻ does; the pinned key keeps the ID (and storage).
  const old = h.control;
  const id = await h.browser.installExtension(resolve('dist'));
  if (id !== h.extensionId) throw new Error(`Extension ID changed on reload: ${id}`);
  // Proof that it really reloaded: the old extension page is gone or cut off from the extension.
  const oldAlive = await old.evaluate(() => !!chrome.runtime?.id).catch(() => false);
  if (oldAlive) throw new Error('The extension did not reload');
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      const page = await h.browser.newPage();
      await page.goto(`chrome-extension://${h.extensionId}/popup.html?control`);
      if (await page.evaluate(() => !!chrome.runtime?.id)) {
        h.control = page;
        // Let the background worker come up before the next click.
        await new Promise((r) => setTimeout(r, 500));
        return;
      }
      await page.close();
    } catch {
      // The extension is not back yet.
    }
  }
  throw new Error('The extension did not come back after reload');
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
    await chrome.storage.local.clear();
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

export interface Panel {
  kind: 'overlay' | 'popup';
  /** The page that receives keyboard input: the site for the overlay, the popup itself otherwise. */
  page: Page;
  /** Runs `fn` against the panel's root (the overlay's closed shadow root, or the popup document). */
  query<T>(fn: (root: ShadowRoot | Document) => T): Promise<T>;
  isOpen(): Promise<boolean>;
}

async function waitFor<T>(get: () => Promise<T | undefined> | T | undefined, what: string): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = await get();
    if (value !== undefined && value !== null && value !== false) return value;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/**
 * Invokes Summon on the given tab, as a click on the toolbar icon would (the keyboard shortcut itself
 * can't be pressed from CDP). On regular pages that injects the overlay; on restricted pages
 * (chrome://…) the background worker falls back to the action popup.
 */
export async function openPanel(h: Harness, tabId: number): Promise<Panel> {
  await focusTab(h, tabId);
  const page = await findPageForTab(h, tabId);
  const extension = (await h.browser.extensions()).get(h.extensionId)!;
  const popupUrl = `chrome-extension://${h.extensionId}/popup.html`;
  const popupTarget = h.browser
    .waitForTarget((t) => t.url() === popupUrl, { timeout: 3000 })
    .catch(() => null);
  await page.triggerExtensionAction(extension);

  let panel: Panel;
  if (page.url().startsWith('http')) {
    // The overlay's state lives in the extension's isolated world of the page.
    const realm = await waitFor(async () => {
      for (const r of page.extensionRealms()) {
        if (await r.evaluate(() => !!globalThis.__summonOverlay?.root).catch(() => false)) return r;
      }
      return undefined;
    }, 'the overlay');
    panel = {
      kind: 'overlay',
      page,
      query: <T>(fn: (root: ShadowRoot | Document) => T) =>
        realm.evaluate(`(${fn.toString()})(globalThis.__summonOverlay.root)`) as Promise<T>,
      isOpen: () => realm.evaluate(() => !!globalThis.__summonOverlay?.root),
    };
  } else {
    const target = await popupTarget;
    if (!target) throw new Error('The popup fallback did not open');
    const popup = (await target.asPage())!;
    panel = {
      kind: 'popup',
      page: popup,
      query: <T>(fn: (root: ShadowRoot | Document) => T) => popup.evaluate(`(${fn.toString()})(document)`) as Promise<T>,
      isOpen: async () => !popup.isClosed(),
    };
  }
  await waitFor(
    () => panel.query((root) => !!root.querySelector('.results .row') || !!root.querySelector('.status')?.textContent),
    'results',
  );
  return panel;
}

async function findPageForTab(h: Harness, tabId: number): Promise<Page> {
  const url = await h.control.evaluate(async (id) => (await chrome.tabs.get(id)).url!, tabId);
  const page = (await h.browser.pages()).find((p) => p.url() === url);
  if (!page) throw new Error(`No page for tab ${tabId} (${url})`);
  return page;
}

/** Waits for the panel to go away (it closes itself after an action). */
export async function waitClosed(panel: Panel): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (!(await panel.isOpen().catch(() => false))) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Panel did not close');
}

/** Titles of the results, without the "Go to …" / "Search for …" rows. */
export function titles(panel: Panel): Promise<string[]> {
  return panel.query((root) => [...root.querySelectorAll('.results .row:not(.web) .title')].map((e) => e.textContent ?? ''));
}

export function selectedTitle(panel: Panel): Promise<string | undefined> {
  return panel.query((root) => root.querySelector('.results [aria-selected="true"] .title')?.textContent ?? undefined);
}

export function text(panel: Panel, selector: string): Promise<string> {
  return panel.query(new Function('root', `return root.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`) as (root: ShadowRoot | Document) => string);
}
