import { describe, resolveAction, similarOutcome, tabFor } from '../actions';
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
import { visitedAgo } from '../history';
import { webItems } from '../web';
import { layoutVariants } from '../layout';
import { isPinned, MAX_RESULTS, prepare, search, type Prepared } from '../search';
import type { Action, Context, Item, Modifiers } from '../types';

const LOADING_DELAY_MS = 150;

/** Where the panel lives: the action popup or the overlay inside a page. */
export interface PanelShell {
  /** `icons`: site icons already known, so the first results show them at once. */
  load(): Promise<{ items: Item[]; ctx: Context; memory: Memory; icons?: IconMap; historyEnabled?: boolean }>;
  /** Pages from browsing history, minus `known` URLs; empty when history search is off. */
  history?(known: string[]): Promise<Item[]>;
  /** Asks Chrome for the history permission (needs a Summon page: the new tab). Absent where it can't. */
  enableHistory?(): Promise<boolean>;
  disableHistory?(): Promise<void>;
  /** Site icons for these result URLs (fetched if needed). Absent: letter tiles only. */
  icons?(urls: string[]): Promise<IconMap>;
  /** Saves a pick to memory (fire and forget). */
  remember(event: PickEvent): void;
  /** Runs the action and closes the panel; rejects to show an error in the panel. */
  perform(action: Action, ctx: Context): Promise<void>;
  /** Runs a tab action that keeps the panel open (close a tab, reopen it). */
  apply(action: Action, ctx: Context): Promise<void>;
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

/** A row of the ⌘K actions menu for one result. */
interface MenuAction {
  title: string;
  glyph: string;
  /** Its direct shortcut, shown on the row. */
  key?: string;
  run(): Promise<void> | void;
}

export const PANEL_MARKUP = `
<div class="search">
  <svg class="search-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>
  <input class="query" type="text" autocomplete="off" spellcheck="false"
         role="combobox" aria-expanded="false" aria-controls="summon-results" aria-autocomplete="list"
         aria-label="Search tabs and bookmarks" placeholder="Search tabs and bookmarks">
</div>
<div class="menu-head" hidden></div>
<ul id="summon-results" class="results" role="listbox" aria-label="Results"></ul>
<p class="status" role="status" aria-live="polite"></p>
<footer class="hints" aria-hidden="true"></footer>`;

/**
 * Copies text from a key press. The async clipboard API is missing on plain-http pages (the overlay runs in
 * the page), so fall back to selecting a hidden field and `execCommand('copy')`, then give focus back.
 */
function copyText(text: string, panel: HTMLElement): void {
  const active = (panel.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement | null;
  if (navigator.clipboard && window.isSecureContext) {
    void navigator.clipboard.writeText(text).catch(() => copyWithField(text, panel, active));
    return;
  }
  copyWithField(text, panel, active);
}

function copyWithField(text: string, panel: HTMLElement, restore: HTMLElement | null): void {
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('aria-hidden', 'true');
  field.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  panel.append(field);
  field.select();
  document.execCommand('copy');
  field.remove();
  restore?.focus({ preventScroll: true });
}

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
  if (item.kind === 'search' || item.kind === 'url') return [];
  if (item.kind === 'history') return item.lastVisit ? [visitedAgo(item.lastVisit)] : [];
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
  // "Go to" shows the full address, so http / https is visible.
  const url = item.kind === 'search' ? 'Default search engine' : item.kind === 'url' ? item.url : shortUrl(item.url);
  const badges = badgesFor(item, ctx);
  if (item.kind === 'search' || item.kind === 'url') li.classList.add('web');
  if (item.kind === 'search') li.classList.add('command');

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

  li.append(item.kind === 'search' ? searchTile() : renderTile(item, icon), text, badgeBox);
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

/** The magnifier from the search field, on a command tile. */
function searchTile(): HTMLSpanElement {
  const tile = document.createElement('span');
  tile.className = 'tile';
  tile.setAttribute('aria-hidden', 'true');
  tile.innerHTML = '<svg class="tile-glyph" viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>';
  return tile;
}

function renderMenuRow(action: MenuAction, index: number): HTMLLIElement {
  const li = document.createElement('li');
  li.id = `summon-option-${index}`;
  li.className = 'row command menu';
  li.setAttribute('role', 'option');
  li.dataset.index = String(index);
  const tile = document.createElement('span');
  tile.className = 'tile';
  tile.setAttribute('aria-hidden', 'true');
  tile.textContent = action.glyph;
  const text = document.createElement('span');
  text.className = 'text';
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = action.title;
  text.append(title);
  li.append(tile, text);
  // ↵ is already drawn on the selected row.
  if (action.key && action.key !== '↵') {
    const key = document.createElement('kbd');
    key.className = 'shortcut';
    key.textContent = action.key;
    li.append(key);
  }
  li.setAttribute('aria-label', action.key ? `${action.title}, ${action.key}` : action.title);
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
  const menuHead = panel.querySelector<HTMLElement>('.menu-head')!;

  let ctx: Context = {};
  let memory: Memory = emptyMemory();
  let learned: Learned | undefined;
  let prepared: Prepared[] = [];
  let historyOn = false;
  let historyPrepared: Prepared[] = [];
  /** Index of the first history result in `results` (they follow tabs and bookmarks under a header). */
  let historyStart = -1;
  let results: Item[] = [];
  /** Shown instead of results while the query starts with ">". */
  let commands: Command[] | null = null;
  /** ⌘K: actions for one result, shown instead of the results; Esc goes back to them. */
  let menu: { item: Item; actions: MenuAction[]; back: number } | null = null;
  let icons: IconMap = {};
  /** The tab closed last from the panel, for ⌘Z. */
  let lastClosed: { url: string; windowId: number; index?: number } | undefined;
  let selected = 0;
  let ready = false;
  let busy = false;

  function setStatus(text: string, isError = false): void {
    status.textContent = text;
    status.classList.toggle('error', isError);
  }

  const preferSwitchFor = (item: Item | undefined): boolean => !!item && prefersSwitch(memory, memoryKey(item.url));
  const count = (): number => (menu ? menu.actions.length : commands ? commands.length : results.length);
  /** The result the keys act on: the selected one, or the one whose actions menu is open. */
  const current = (): Item | undefined => (menu ? menu.item : commands ? undefined : results[selected]);

  const historyCommand = (): Command =>
    historyOn
      ? {
          title: 'Disable history search',
          detail: 'Stop listing pages from browsing history and give the permission back',
          glyph: '⟲',
          async run() {
            await shell.disableHistory?.();
            historyOn = false;
            historyPrepared = [];
            return 'History search is off';
          },
        }
      : {
          title: 'Enable history search',
          detail: 'Also list recent pages you visited, below tabs and bookmarks',
          glyph: '⟲',
          async run() {
            if (!shell.enableHistory) {
              throw new Error('Open a new tab and run this command there — Chrome asks for the permission only on Summon’s own page');
            }
            if (!(await shell.enableHistory())) return 'Chrome didn’t grant access to history';
            historyOn = true;
            loadHistory();
            return 'History search is on — pages you visited show below tabs and bookmarks';
          },
        };

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
    if (menu) {
      hints.innerHTML = ['<kbd>↵</kbd> Run', '<kbd>↑↓</kbd> Select', '<kbd>esc</kbd> Back'].map((p) => `<span>${p}</span>`).join('');
      return;
    }
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
    if (d && results[selected]?.kind !== 'search') parts.push('<kbd>⌘K</kbd> Actions');
    parts.push(`<kbd>esc</kbd> ${shell.escapeLabel ?? 'Close'}`);
    hints.innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
  }

  function select(index: number): void {
    if (!count()) return;
    selected = (index + count()) % count();
    for (const row of list.querySelectorAll('.row')) {
      row.setAttribute('aria-selected', String(Number((row as HTMLElement).dataset.index) === selected));
    }
    input.setAttribute('aria-activedescendant', `summon-option-${selected}`);
    list.querySelector(`#summon-option-${selected}`)?.scrollIntoView({ block: 'nearest' });
    renderHints();
  }

  function update(): void {
    if (!ready) return;
    closeMenu(false);
    const query = input.value;
    const variants = layoutVariants(query);
    // ">" typed with the Russian layout on is "Ю"; the command name then reads in the other layout too.
    const commandQuery = variants.find((v) => v.trimStart().startsWith(COMMAND_PREFIX));
    if (commandQuery !== undefined) {
      const filter = commandQuery.trimStart().slice(COMMAND_PREFIX.length).trim().toLowerCase();
      commands = [...allCommands, historyCommand()].filter((c) => c.title.toLowerCase().includes(filter));
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
    // History fills the list when tabs and bookmarks don't, always below them (Enter on the first stays the same).
    historyStart = -1;
    if (query.trim() && results.length < MAX_RESULTS && historyPrepared.length) {
      const history = search(historyPrepared, query, ctx, learned).slice(0, MAX_RESULTS - results.length);
      if (history.length) {
        historyStart = results.length;
        results = [...results, ...history];
      }
    }
    // Then "Go to …" / "Search for …" for what was typed: first only when nothing else matches.
    results = [...results, ...webItems(query)];
    selected = 0;
    const rows: HTMLElement[] = results.map((item, i) =>
      renderRow(item, i, ctx, i === 0 && isPinned(item, learned), query, icons[item.url]),
    );
    if (historyStart >= 0) {
      const header = document.createElement('li');
      header.className = 'section';
      header.setAttribute('role', 'presentation');
      header.textContent = 'History';
      rows.splice(historyStart, 0, header);
    }
    list.replaceChildren(...rows);
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
    const missing = [...new Set(results.map((item) => item.url).filter((url) => url && !(url in icons)))];
    if (!shell.icons || !missing.length) return;
    const shown = results;
    shell.icons(missing).then(
      (found) => {
        icons = { ...icons, ...found };
        if (results !== shown) return;
        shown.forEach((item, i) => {
          const tile = list.querySelector(`#summon-option-${i} .tile`);
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
    if (menu) {
      // Enter runs the selected action; ⇧↵ / ⌥↵ still mean what they mean for the result.
      if (mods.shift || mods.alt) await openItem(menu.item, mods);
      else await menu.actions[selected]?.run();
      return;
    }
    if (commands) {
      const command = commands[selected];
      if (command && !busy) await runCommand(command);
      return;
    }
    await openItem(results[selected], mods);
  }

  /** Enter / ⇧↵ / ⌥↵ on a result: remembered as a pick for the query, then done; the panel closes. */
  async function openItem(item: Item | undefined, mods: Modifiers): Promise<void> {
    const action = resolveAction(item, mods, ctx, preferSwitchFor(item));
    if (!item || !action || busy) return;
    busy = true;
    // Leaving for the web isn't a pick among results: not learned.
    if (item.kind !== 'search' && item.kind !== 'url') {
      shell.remember({ query: input.value, key: memoryKey(item.url), similarOutcome: similarOutcome(item, mods, action) });
    }
    try {
      await shell.perform(action, ctx);
    } catch (error) {
      busy = false;
      setStatus(`Couldn’t open: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }


  function menuActions(item: Item): MenuAction[] {
    const preferSwitch = preferSwitchFor(item);
    const d = describe(item, ctx, preferSwitch)!;
    const open = (mods: Modifiers) => () => openItem(item, mods);
    const actions: MenuAction[] = [{ title: d.enter, glyph: '↵', key: '↵', run: open({}) }];
    if (d.altEnter) actions.push({ title: d.altEnter, glyph: '⌥', key: '⌥↵', run: open({ alt: true }) });
    if (d.shiftEnter) actions.push({ title: d.shiftEnter, glyph: '⇧', key: '⇧↵', run: open({ shift: true }) });
    const tab = tabFor(item, ctx);
    if (!tab) actions.push({ title: 'Open in background', glyph: '⤓', run: () => openInBackground(item) });
    if (tab && tab.windowId !== ctx.currentWindowId && tab.tabId !== ctx.currentTabId) {
      actions.push({ title: 'Move to this window', glyph: '⇥', run: () => perform({ type: 'move-here', tabId: tab.tabId }) });
    }
    actions.push(
      tab
        ? { title: 'Move to new window', glyph: '⧉', run: () => perform({ type: 'new-window', tabId: tab.tabId, url: item.url }) }
        : { title: 'Open in new window', glyph: '⧉', run: () => perform({ type: 'new-window', url: item.url }) },
    );
    actions.push({ title: 'Copy URL', glyph: '⎘', key: '⌘C', run: () => void copyItem(item) });
    if (tab) actions.push({ title: 'Close tab', glyph: '✕', key: '⇧⌘⌫', run: () => void closeItem(item) });
    return actions;
  }

  /** Opens a bookmark in a background tab; the panel stays, the bookmark then shows as open. */
  async function openInBackground(item: Item): Promise<void> {
    shell.remember({ query: input.value, key: memoryKey(item.url) });
    try {
      await shell.apply({ type: 'open-background', url: item.url }, ctx);
    } catch (error) {
      setStatus(`Couldn’t open: ${error instanceof Error ? error.message : String(error)}`, true);
      return;
    }
    const back = menu ? menu.back : selected;
    closeMenu(false);
    reload();
    afterReload = () => {
      select(back);
      setStatus('Opened in a background tab');
    };
  }

  /** Runs an action that leaves the panel (move a tab, open a window). */
  async function perform(action: Action): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await shell.perform(action, ctx);
    } catch (error) {
      busy = false;
      setStatus(`Couldn’t do that: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }

  function openMenu(): void {
    const item = current();
    if (!item || menu || item.kind === 'search') return;
    menu = { item, actions: menuActions(item), back: selected };
    menuHead.replaceChildren(renderTile(item, icons[item.url]), Object.assign(document.createElement('span'), { textContent: item.titles[0]! }));
    menuHead.hidden = false;
    list.replaceChildren(...menu.actions.map(renderMenuRow));
    list.setAttribute('aria-label', `Actions for ${item.titles[0]}`);
    setStatus('');
    selected = 0;
    select(0);
  }

  /** Back to the results; `restore` re-renders them with the same row selected. */
  function closeMenu(restore = true): void {
    if (!menu) return;
    const back = menu.back;
    menu = null;
    menuHead.hidden = true;
    list.setAttribute('aria-label', 'Results');
    if (restore) {
      update();
      select(back);
    }
  }

  /** ⇧⌘⌫: closes the tab the selected row would switch to; the panel stays, ⌘Z brings it back. */
  async function closeItem(item: Item | undefined): Promise<boolean> {
    const tab = tabFor(item, ctx);
    if (!item || !tab) return false;
    try {
      await shell.apply({ type: 'close', tabId: tab.tabId }, ctx);
    } catch (error) {
      setStatus(`Couldn’t close: ${error instanceof Error ? error.message : String(error)}`, true);
      return true;
    }
    // For an open bookmark this is the bookmark's URL; extra parameters the tab had are not kept.
    lastClosed = { url: item.url, windowId: tab.windowId, index: tab.index };
    const index = menu ? menu.back : selected;
    closeMenu(false);
    reload();
    // Keep the place in the list, so several tabs can be closed in a row.
    afterReload = () => {
      select(Math.min(index, count() - 1));
      setStatus('Closed the tab · ⌘Z to reopen');
    };
    return true;
  }

  async function reopenClosed(): Promise<boolean> {
    if (!lastClosed) return false;
    const tab = lastClosed;
    lastClosed = undefined;
    try {
      await shell.apply({ type: 'reopen', ...tab }, ctx);
    } catch (error) {
      setStatus(`Couldn’t reopen: ${error instanceof Error ? error.message : String(error)}`, true);
      return true;
    }
    reload();
    afterReload = () => setStatus('Reopened the tab');
    return true;
  }

  /** ⌘C with nothing selected in the field: copies the result's URL. */
  function copyItem(item: Item | undefined): boolean {
    if (!item || input.selectionStart !== input.selectionEnd) return false;
    copyText(item.url, panel);
    if (menu) closeMenu();
    setStatus('Copied the URL');
    return true;
  }

  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    // By physical key, so they work with any keyboard layout (⌘C is ⌘С on the Russian one).
    if (e.metaKey && !e.altKey && !e.ctrlKey) {
      const handled =
        e.code === 'Backspace' && e.shiftKey
          ? (void closeItem(current()), true)
          : e.code === 'KeyZ' && !e.shiftKey && lastClosed
            ? (void reopenClosed(), true)
            : e.code === 'KeyC' && !e.shiftKey
              ? copyItem(current())
              : e.code === 'KeyK' && !e.shiftKey && current()
                ? (openMenu(), true)
                : false;
      if (handled) {
        e.preventDefault();
        return;
      }
    }
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        select(selected + (e.key === 'ArrowDown' ? 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        // ⌘↵: search the web for what was typed, whichever row is selected.
        if (e.metaKey && input.value.trim() && !commands && !menu) void perform({ type: 'web-search', text: input.value.trim() });
        else void run({ shift: e.shiftKey, alt: e.altKey });
        break;
      case 'Escape':
        e.preventDefault();
        if (menu) closeMenu();
        else shell.close();
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

  /** Reads history in the background after tabs and bookmarks are shown; re-runs the search when it arrives. */
  function loadHistory(): void {
    if (!historyOn || !shell.history) return;
    shell.history(prepared.map((p) => p.item.url)).then(
      (pages) => {
        historyPrepared = pages.map(prepare);
        if (input.value.trim() && !menu && !commands && results.length < MAX_RESULTS) update();
      },
      () => {},
    );
  }

  /** Runs once the next load has updated the results. */
  let afterReload: (() => void) | undefined;

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
          historyOn = !!data.historyEnabled;
          ready = true;
          update();
          afterReload?.();
          afterReload = undefined;
          loadHistory();
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
