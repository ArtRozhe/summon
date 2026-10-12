import { describe, resolveAction, similarOutcome } from '../actions';
import { emptyMemory, type Learned, learnedFor, type Memory, memoryKey, type PickEvent, prefersSwitch } from '../memory';
import { isPinned, prepare, search, type Prepared } from '../search';
import type { Action, Context, Item, Modifiers } from '../types';

const LOADING_DELAY_MS = 150;

/** Where the panel lives: the action popup or the overlay inside a page. */
export interface PanelShell {
  load(): Promise<{ items: Item[]; ctx: Context; memory: Memory }>;
  /** Saves a pick to memory (fire and forget). */
  remember(event: PickEvent): void;
  /** Runs the action and closes the panel; rejects to show an error in the panel. */
  perform(action: Action, ctx: Context): Promise<void>;
  close(): void;
  /** Called once results are first shown (for timing diagnostics). */
  loaded?(): void;
}

export const PANEL_MARKUP = `
<div class="search">
  <svg class="search-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>
  <input class="query" type="text" autocomplete="off" spellcheck="false"
         role="combobox" aria-expanded="false" aria-controls="summon-results" aria-autocomplete="list"
         aria-label="Search tabs and bookmarks" placeholder="Search tabs and bookmarks">
</div>
<ul id="summon-results" class="results" role="listbox" aria-label="Results"></ul>
<p class="status" role="status" aria-live="polite"></p>
<footer class="hints" aria-hidden="true"></footer>`;

export function shortUrl(url: string): string {
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

function badgesFor(item: Item, ctx: Context): string[] {
  const badges = [item.kind === 'tab' ? 'Tab' : 'Bookmark'];
  if (item.tabs.some((t) => t.tabId === ctx.currentTabId)) badges.push('Current');
  else if (item.kind === 'bookmark' && item.tabs.length) badges.push('Open');
  else if (item.kind === 'bookmark' && item.similarTabs.length) badges.push('Similar open');
  else if (item.kind === 'tab' && item.tabs[0]!.windowId !== ctx.currentWindowId) badges.push('Other window');
  return badges;
}

function renderRow(item: Item, index: number, ctx: Context, pinned: boolean): HTMLLIElement {
  const li = document.createElement('li');
  li.id = `summon-option-${index}`;
  li.className = pinned ? 'row pinned' : 'row';
  li.setAttribute('role', 'option');
  li.dataset.index = String(index);

  const title = item.titles[0]!;
  const url = shortUrl(item.url);
  const badges = badgesFor(item, ctx);

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
  li.setAttribute('aria-label', `${title}, ${url}, ${badges.join(', ')}${pinned ? ', your usual pick' : ''}`);
  return li;
}

/**
 * Wires the search panel inside `panel` (which already contains PANEL_MARKUP).
 * Returns once the markup is live; data loads in the background.
 */
export function mountPanel(panel: HTMLElement, shell: PanelShell): { input: HTMLInputElement } {
  const input = panel.querySelector<HTMLInputElement>('.query')!;
  const list = panel.querySelector<HTMLUListElement>('.results')!;
  const status = panel.querySelector<HTMLElement>('.status')!;
  const hints = panel.querySelector<HTMLElement>('.hints')!;

  let ctx: Context = {};
  let memory: Memory = emptyMemory();
  let learned: Learned | undefined;
  let prepared: Prepared[] = [];
  let results: Item[] = [];
  let selected = 0;
  let ready = false;
  let busy = false;

  function setStatus(text: string, isError = false): void {
    status.textContent = text;
    status.classList.toggle('error', isError);
  }

  const preferSwitchFor = (item: Item | undefined): boolean => !!item && prefersSwitch(memory, memoryKey(item.url));

  function renderHints(): void {
    const d = describe(results[selected], ctx, preferSwitchFor(results[selected]));
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
    input.setAttribute('aria-activedescendant', `summon-option-${selected}`);
    list.children[selected]?.scrollIntoView({ block: 'nearest' });
    renderHints();
  }

  function update(): void {
    if (!ready) return;
    const query = input.value;
    learned = learnedFor(memory, query, Date.now());
    results = search(prepared, query, ctx, learned);
    selected = 0;
    list.replaceChildren(...results.map((item, i) => renderRow(item, i, ctx, i === 0 && isPinned(item, learned))));
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
    const item = results[selected];
    const action = resolveAction(item, mods, ctx, preferSwitchFor(item));
    if (!item || !action || busy) return;
    busy = true;
    shell.remember({ query: input.value, key: memoryKey(item.url), similarOutcome: similarOutcome(item, mods, action) });
    try {
      await shell.perform(action, ctx);
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
      case 'ArrowUp':
        e.preventDefault();
        select(selected + (e.key === 'ArrowDown' ? 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        void run({ shift: e.shiftKey, alt: e.altKey });
        break;
      case 'Escape':
        e.preventDefault();
        shell.close();
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

  const loadingTimer = setTimeout(() => setStatus('Loading…'), LOADING_DELAY_MS);
  shell
    .load()
    .then(
      (data) => {
        ctx = data.ctx;
        memory = data.memory;
        prepared = data.items.map(prepare);
        ready = true;
        update();
        shell.loaded?.();
      },
      (error: unknown) => {
        setStatus(`Couldn’t read tabs or bookmarks: ${error instanceof Error ? error.message : String(error)}`, true);
      },
    )
    .finally(() => clearTimeout(loadingTimer));

  return { input };
}
