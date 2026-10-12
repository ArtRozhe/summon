import { describe, resolveAction, similarOutcome } from '../actions';
import {
  emptyMemory,
  exportMemory,
  type Learned,
  learnedForAny,
  type Memory,
  memoryKey,
  parseExport,
  type PickEvent,
  prefersSwitch,
  size,
} from '../memory';
import type { IconMap } from '../favicons';
import { highlight, type Range } from '../highlight';
import { layoutVariants } from '../layout';
import { isPinned, prepare, search, type Prepared } from '../search';
import type { Action, Context, Item, Modifiers } from '../types';

const LOADING_DELAY_MS = 150;

/** Where the panel lives: the action popup or the overlay inside a page. */
export interface PanelShell {
  /** `icons`: site icons already known, so the first results show them at once. */
  load(): Promise<{ items: Item[]; ctx: Context; memory: Memory; icons?: IconMap }>;
  /** Site icons for these result URLs (fetched if needed). Absent: letter tiles only. */
  icons?(urls: string[]): Promise<IconMap>;
  /** Saves a pick to memory (fire and forget). */
  remember(event: PickEvent): void;
  /** Runs the action and closes the panel; rejects to show an error in the panel. */
  perform(action: Action, ctx: Context): Promise<void>;
  close(): void;
  /** What Esc does, for the hint line (default "Close"). */
  escapeLabel?: string;
  /** Called once results are first shown (for timing diagnostics). */
  loaded?(): void;
  /** Merges imported memory into the stored one and returns the result. Absent where a file picker can't work. */
  importMemory?(memory: Memory): Promise<Memory>;
  /** Keeps the panel open while the page loses focus (the file picker is open). */
  holdOpen?(hold: boolean): void;
}

const searches = (n: number): string => `${n} ${n === 1 ? 'search' : 'searches'}`;

/** Typed after ">" in the search field. */
interface Command {
  title: string;
  detail: string;
  glyph: string;
  /** Returns the message to show. */
  run(): Promise<string>;
}

const COMMAND_PREFIX = '>';

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

/**
 * Site tile: the site's icon on a white plate when Chrome has one, else the domain's first letter on a hue
 * derived from the domain, so a site keeps its color.
 */
export function renderTile(item: Item, icon?: string | null): HTMLSpanElement {
  if (icon) {
    const tile = document.createElement('span');
    tile.className = 'tile icon';
    tile.setAttribute('aria-hidden', 'true');
    const img = document.createElement('img');
    img.src = icon;
    img.alt = '';
    tile.append(img);
    return tile;
  }
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

/** Fills `el` with `text`, wrapping the highlighted ranges in `.hl` spans. */
function setMarkedText(el: HTMLElement, text: string, ranges: Range[]): void {
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) el.append(text.slice(at, start));
    const mark = document.createElement('span');
    mark.className = 'hl';
    mark.textContent = text.slice(start, end);
    el.append(mark);
    at = end;
  }
  if (at < text.length) el.append(text.slice(at));
}

function renderRow(item: Item, index: number, ctx: Context, pinned: boolean, query: string, icon?: string | null): HTMLLIElement {
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
  const marks = highlight(title, url, query);
  titleEl.className = 'title';
  setMarkedText(titleEl, title, marks.title);
  titleEl.title = title;
  const urlEl = document.createElement('span');
  urlEl.className = 'url';
  setMarkedText(urlEl, url, marks.url);
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

  li.append(renderTile(item, icon), text, badgeBox);
  li.setAttribute('aria-label', `${title}, ${url}, ${badges.join(', ')}${pinned ? ', your usual pick' : ''}`);
  return li;
}

function renderCommandRow(command: Command, index: number): HTMLLIElement {
  const li = document.createElement('li');
  li.id = `summon-option-${index}`;
  li.className = 'row command';
  li.setAttribute('role', 'option');
  li.dataset.index = String(index);
  const tile = document.createElement('span');
  tile.className = 'tile';
  tile.setAttribute('aria-hidden', 'true');
  tile.textContent = command.glyph;
  const text = document.createElement('span');
  text.className = 'text';
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = command.title;
  const detail = document.createElement('span');
  detail.className = 'url';
  detail.textContent = command.detail;
  text.append(title, detail);
  li.append(tile, text);
  li.setAttribute('aria-label', `${command.title}, ${command.detail}`);
  return li;
}

/** Lets the user pick a file; resolves to null when the picker is cancelled. */
function pickFile(shell: PanelShell): Promise<File | null> {
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.json,application/json';
  shell.holdOpen?.(true);
  return new Promise<File | null>((done) => {
    picker.addEventListener('change', () => done(picker.files?.[0] ?? null), { once: true });
    picker.addEventListener('cancel', () => done(null), { once: true });
    picker.click();
  }).finally(() => shell.holdOpen?.(false));
}

/**
 * Wires the search panel inside `panel` (which already contains PANEL_MARKUP).
 * Returns once the markup is live; data loads in the background.
 */
export function mountPanel(panel: HTMLElement, shell: PanelShell): { input: HTMLInputElement; reload(): void } {
  const input = panel.querySelector<HTMLInputElement>('.query')!;
  const list = panel.querySelector<HTMLUListElement>('.results')!;
  const status = panel.querySelector<HTMLElement>('.status')!;
  const hints = panel.querySelector<HTMLElement>('.hints')!;

  let ctx: Context = {};
  let memory: Memory = emptyMemory();
  let learned: Learned | undefined;
  let prepared: Prepared[] = [];
  let results: Item[] = [];
  /** Shown instead of results while the query starts with ">". */
  let commands: Command[] | null = null;
  let icons: IconMap = {};
  let selected = 0;
  let ready = false;
  let busy = false;

  function setStatus(text: string, isError = false): void {
    status.textContent = text;
    status.classList.toggle('error', isError);
  }

  const preferSwitchFor = (item: Item | undefined): boolean => !!item && prefersSwitch(memory, memoryKey(item.url));
  const count = (): number => (commands ? commands.length : results.length);

  const allCommands: Command[] = [
    {
      title: 'Export Summon data',
      detail: 'Save what Summon has learned to a JSON file in Downloads',
      glyph: '↓',
      async run() {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([exportMemory(memory, Date.now())], { type: 'application/json' }));
        link.download = `summon-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
        return `Exported ${searches(size(memory))} Summon remembers`;
      },
    },
    {
      title: 'Import Summon data',
      detail: 'Merge an exported file; fresher records win, nothing is removed',
      glyph: '↑',
      async run() {
        if (!shell.importMemory) throw new Error('Import works on a regular web page — open one and try again');
        const file = await pickFile(shell);
        input.focus();
        if (!file) return '';
        memory = await shell.importMemory(parseExport(await file.text()));
        return `Imported — Summon now remembers ${searches(size(memory))}`;
      },
    },
  ];

  function renderHints(): void {
    if (commands) {
      hints.innerHTML = [
        commands.length ? '<kbd>↵</kbd> Run' : '',
        commands.length > 1 ? '<kbd>↑↓</kbd> Select' : '',
        `<kbd>esc</kbd> ${shell.escapeLabel ?? 'Close'}`,
      ]
        .filter(Boolean)
        .map((p) => `<span>${p}</span>`)
        .join('');
      return;
    }
    const d = describe(results[selected], ctx, preferSwitchFor(results[selected]));
    const parts = d ? [`<kbd>↵</kbd> ${d.enter}`] : [];
    if (d?.altEnter) parts.push(`<kbd>⌥↵</kbd> ${d.altEnter}`);
    if (d?.shiftEnter) parts.push(`<kbd>⇧↵</kbd> ${d.shiftEnter}`);
    if (count() > 1) parts.push('<kbd>↑↓</kbd> Select');
    parts.push(`<kbd>esc</kbd> ${shell.escapeLabel ?? 'Close'}`);
    hints.innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
  }

  function select(index: number): void {
    if (!count()) return;
    selected = (index + count()) % count();
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
    const variants = layoutVariants(query);
    // ">" typed with the Russian layout on is "Ю"; the command name then reads in the other layout too.
    const commandQuery = variants.find((v) => v.trimStart().startsWith(COMMAND_PREFIX));
    if (commandQuery !== undefined) {
      const filter = commandQuery.trimStart().slice(COMMAND_PREFIX.length).trim().toLowerCase();
      commands = allCommands.filter((c) => c.title.toLowerCase().includes(filter));
      results = [];
      selected = 0;
      list.replaceChildren(...commands.map(renderCommandRow));
      input.setAttribute('aria-expanded', String(commands.length > 0));
      setStatus(commands.length ? '' : `No command matches “${filter}”`);
      if (commands.length) select(0);
      else renderHints();
      return;
    }
    commands = null;
    learned = learnedForAny(memory, variants, Date.now());
    results = search(prepared, query, ctx, learned);
    selected = 0;
    list.replaceChildren(
      ...results.map((item, i) => renderRow(item, i, ctx, i === 0 && isPinned(item, learned), query, icons[item.url])),
    );
    input.setAttribute('aria-expanded', String(results.length > 0));
    fillIcons();

    if (results.length) {
      setStatus('');
      select(0);
    } else {
      input.removeAttribute('aria-activedescendant');
      setStatus(query.trim() ? `No matches for “${query.trim()}”` : 'Type to search tabs and bookmarks');
      renderHints();
    }
  }

  /** Asks for icons the shown results don't have yet and swaps them into the rows that are still shown. */
  function fillIcons(): void {
    const missing = [...new Set(results.map((item) => item.url).filter((url) => !(url in icons)))];
    if (!shell.icons || !missing.length) return;
    const shown = results;
    shell.icons(missing).then(
      (found) => {
        icons = { ...icons, ...found };
        if (results !== shown) return;
        shown.forEach((item, i) => {
          const tile = list.children[i]?.querySelector('.tile');
          if (found[item.url] && tile) tile.replaceWith(renderTile(item, found[item.url]));
        });
      },
      () => {},
    );
  }

  async function runCommand(command: Command): Promise<void> {
    busy = true;
    try {
      setStatus(await command.run());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    } finally {
      busy = false;
    }
  }

  async function run(mods: Modifiers): Promise<void> {
    if (commands) {
      const command = commands[selected];
      if (command && !busy) await runCommand(command);
      return;
    }
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

  /** Reads tabs, bookmarks and memory (again), keeping what is typed. */
  function reload(): void {
    const loadingTimer = setTimeout(() => setStatus('Loading…'), LOADING_DELAY_MS);
    shell
      .load()
      .then(
        (data) => {
          ctx = data.ctx;
          memory = data.memory;
          icons = { ...icons, ...data.icons };
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
  }
  reload();

  return { input, reload };
}
