import { describe, execute, resolveAction } from './actions';
import { buildItems } from './data';
import { prepare, search, type Prepared } from './search';
import type { Context, Item, Modifiers } from './types';

const LOADING_DELAY_MS = 150;

const input = document.getElementById('query') as HTMLInputElement;
const list = document.getElementById('results') as HTMLUListElement;
const status = document.getElementById('status') as HTMLParagraphElement;
const hints = document.getElementById('hints') as HTMLElement;

let ctx: Context = {};
let prepared: Prepared[] = [];
let results: Item[] = [];
let selected = 0;
let ready = false;
let busy = false;

/**
 * The tab and window the popup belongs to. `?tab=&window=` override it so popup.html
 * can be tested in a regular tab, where the "current tab" would be the popup itself.
 */
async function loadContext(): Promise<Context> {
  const params = new URLSearchParams(location.search);
  if (params.has('tab')) {
    return { currentTabId: Number(params.get('tab')), currentWindowId: Number(params.get('window')) };
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return { currentTabId: tab?.id, currentWindowId: tab?.windowId };
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!u.host) return url;
    const path = decodeURI(u.pathname + u.search + u.hash);
    return u.hostname.replace(/^www\./, '') + (path === '/' ? '' : path);
  } catch {
    return url;
  }
}

/** Site tile: the domain's first letter on a hue derived from the domain, so a site keeps its color. */
function renderTile(item: Item): HTMLSpanElement {
  let host = '';
  try {
    host = new URL(item.url).hostname.replace(/^www\./, '');
  } catch {
    // Unparseable URL: fall back to the title.
  }
  const source = host || item.titles[0]!;
  let hue = 0;
  for (const char of source) hue = (hue * 31 + char.charCodeAt(0)) % 360;

  const tile = document.createElement('span');
  tile.className = 'tile';
  tile.setAttribute('aria-hidden', 'true');
  tile.style.setProperty('--hue', String(hue));
  tile.textContent = (source.match(/[\p{L}\p{N}]/u)?.[0] ?? '•').toUpperCase();
  return tile;
}

function badgesFor(item: Item): string[] {
  const badges = [item.kind === 'tab' ? 'Tab' : 'Bookmark'];
  if (item.tabs.some((t) => t.tabId === ctx.currentTabId)) badges.push('Current');
  else if (item.kind === 'bookmark' && item.tabs.length) badges.push('Open');
  else if (item.kind === 'bookmark' && item.similarTabs.length) badges.push('Similar open');
  else if (item.kind === 'tab' && item.tabs[0]!.windowId !== ctx.currentWindowId) badges.push('Other window');
  return badges;
}

function renderRow(item: Item, index: number): HTMLLIElement {
  const li = document.createElement('li');
  li.id = `option-${index}`;
  li.className = 'row';
  li.setAttribute('role', 'option');
  li.dataset.index = String(index);

  const title = item.titles[0]!;
  const url = shortUrl(item.url);
  const badges = badgesFor(item);

  const text = document.createElement('span');
  text.className = 'text';
  const titleEl = document.createElement('span');
  titleEl.className = 'title';
  titleEl.textContent = title;
  titleEl.title = title;
  const urlEl = document.createElement('span');
  urlEl.className = 'url';
  urlEl.textContent = url;
  urlEl.title = item.url;
  text.append(titleEl, urlEl);

  const badgeBox = document.createElement('span');
  badgeBox.className = 'badges';
  for (const label of badges) {
    const badge = document.createElement('span');
    badge.className = label === 'Open' || label === 'Similar open' ? 'badge open' : 'badge';
    badge.textContent = label;
    badgeBox.append(badge);
  }

  li.append(renderTile(item), text, badgeBox);
  li.setAttribute('aria-label', `${title}, ${url}, ${badges.join(', ')}`);
  return li;
}

function setStatus(text: string, isError = false): void {
  status.textContent = text;
  status.classList.toggle('error', isError);
}

function renderHints(): void {
  const d = describe(results[selected], ctx);
  const parts = d ? [`<kbd>↵</kbd> ${d.enter}`] : [];
  if (d?.altEnter) parts.push(`<kbd>⌥↵</kbd> ${d.altEnter}`);
  if (d?.shiftEnter) parts.push(`<kbd>⇧↵</kbd> ${d.shiftEnter}`);
  if (results.length > 1) parts.push('<kbd>↑↓</kbd> Select');
  parts.push('<kbd>esc</kbd> Close');
  hints.innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
}

function select(index: number): void {
  if (!results.length) return;
  selected = (index + results.length) % results.length;
  for (const row of list.children) {
    row.setAttribute('aria-selected', String(Number((row as HTMLElement).dataset.index) === selected));
  }
  const row = document.getElementById(`option-${selected}`);
  input.setAttribute('aria-activedescendant', `option-${selected}`);
  row?.scrollIntoView({ block: 'nearest' });
  renderHints();
}

function update(): void {
  if (!ready) return;
  const query = input.value;
  results = search(prepared, query, ctx);
  selected = 0;
  list.replaceChildren(...results.map(renderRow));
  input.setAttribute('aria-expanded', String(results.length > 0));

  if (results.length) {
    setStatus('');
    select(0);
  } else {
    input.removeAttribute('aria-activedescendant');
    setStatus(query.trim() ? `No matches for “${query.trim()}”` : 'Type to search tabs and bookmarks');
    renderHints();
  }
}

async function run(mods: Modifiers): Promise<void> {
  const action = resolveAction(results[selected], mods, ctx);
  if (!action || busy) return;
  busy = true;
  try {
    await execute(action, ctx);
    window.close();
  } catch (error) {
    busy = false;
    setStatus(`Couldn’t open: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

input.addEventListener('input', update);

input.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      select(selected + 1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      select(selected - 1);
      break;
    case 'Enter':
      e.preventDefault();
      void run({ shift: e.shiftKey, alt: e.altKey });
      break;
    case 'Escape':
      e.preventDefault();
      window.close();
      break;
  }
});

list.addEventListener('mousemove', (e) => {
  const row = (e.target as Element).closest<HTMLElement>('.row');
  if (row && Number(row.dataset.index) !== selected) select(Number(row.dataset.index));
});

list.addEventListener('click', (e) => {
  const row = (e.target as Element).closest<HTMLElement>('.row');
  if (!row) return;
  select(Number(row.dataset.index));
  void run({ shift: e.shiftKey, alt: e.altKey });
  input.focus();
});

async function init(): Promise<void> {
  input.focus();
  const loadingTimer = setTimeout(() => setStatus('Loading…'), LOADING_DELAY_MS);
  try {
    const [context, tabs, tree] = await Promise.all([
      loadContext(),
      chrome.tabs.query({}),
      chrome.bookmarks.getTree(),
    ]);
    ctx = context;
    const ownPages = chrome.runtime.getURL('');
    const otherTabs = tabs.filter((t) => !(t.url || t.pendingUrl || '').startsWith(ownPages));
    prepared = buildItems(otherTabs, tree).map(prepare);
    ready = true;
    update();
  } catch (error) {
    setStatus(`Couldn’t read tabs or bookmarks: ${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    clearTimeout(loadingTimer);
  }
}

void init();
