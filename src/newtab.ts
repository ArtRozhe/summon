// New tab page: the panel centered on the page. The current tab is this page itself, so
// opening a bookmark replaces it and switching to another tab closes it (`blankTab`).
// Around it: a clock, frequent picks as chips (⌥1…⌥6) and tabs untouched for a week, to close in one go.
//
// Chrome gives a new tab's focus to the address bar; the background worker swaps the tab for one
// that gets page focus (newtab-focus.ts).
import { execute, resolveAction } from './actions';
import type { OverlayRequest } from './background';
import { buildItems } from './data';
import { type Memory, memoryKey, prefersSwitch } from './memory';
import { MAX_FREQUENT, frequentItems, type StaleTab, staleTabs } from './newtab-extras';
import { REPLACED } from './newtab-focus';
import { loadMemory } from './storage';
import type { Context, Item } from './types';
import overlayCss from './ui/overlay.css';
import panelCss from './ui/panel.css';
import { mountPanel, PANEL_MARKUP, renderTile, shortUrl } from './ui/panel';
import newtabCss from './ui/newtab.css';

const params = new URLSearchParams(location.search);
const tabPromise = chrome.tabs.getCurrent();
/** If the worker doesn't replace this tab by then, show the page here (focus stays in the address bar). */
const REPLACE_TIMEOUT_MS = 1500;
const UNDO_MS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function start(): void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(panelCss + overlayCss + newtabCss);
  document.adoptedStyleSheets = [sheet];

  const panel = document.querySelector<HTMLElement>('.panel')!;
  panel.innerHTML = PANEL_MARKUP;
  const chips = document.createElement('div');
  chips.className = 'chips';
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Frequent');
  panel.querySelector('.search')!.after(chips);

  let frequent: Item[] = [];
  let ctx: Context = {};
  let memory: Memory | undefined;

  const { input, reload } = mountPanel(panel, {
    async load() {
      const [tab, tabs, tree, loaded] = await Promise.all([
        tabPromise,
        chrome.tabs.query({}),
        chrome.bookmarks.getTree(),
        loadMemory(),
      ]);
      const ownPages = chrome.runtime.getURL('');
      const otherTabs = tabs.filter((t) => !(t.url || t.pendingUrl || '').startsWith(ownPages));
      const items = buildItems(otherTabs, tree);
      ctx = { currentTabId: tab?.id, currentWindowId: tab?.windowId, blankTab: true };
      memory = loaded;
      frequent = frequentItems(loaded, items, Date.now());
      renderChips();
      renderStale(staleTabs(tabs, Date.now(), ownPages));
      return { items, ctx, memory: loaded };
    },
    remember(event) {
      void chrome.runtime.sendMessage({ type: 'record', event } satisfies OverlayRequest);
    },
    perform: (action, ctx) => execute(action, ctx),
    // Nothing to close: Esc clears the field.
    escapeLabel: 'Clear',
    close() {
      input.value = '';
      input.dispatchEvent(new Event('input'));
    },
  });
  input.focus();

  function openFrequent(item: Item): void {
    const action = resolveAction(item, {}, ctx, memory ? prefersSwitch(memory, memoryKey(item.url)) : false);
    if (action) void execute(action, ctx);
  }

  function renderChips(): void {
    chips.replaceChildren(
      ...frequent.map((item, i) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.tabIndex = -1;
        chip.title = `${item.titles[0]} — ${shortUrl(item.url)}`;
        const name = document.createElement('span');
        name.className = 'chip-name';
        name.textContent = item.titles[0]!;
        const key = document.createElement('kbd');
        key.textContent = `⌥${i + 1}`;
        chip.append(renderTile(item), name, key);
        chip.addEventListener('click', () => openFrequent(item));
        return chip;
      }),
    );
    syncChips();
  }

  // Chips are for an empty field; while searching the results take over.
  const syncChips = () => (chips.hidden = !frequent.length || input.value !== '');
  input.addEventListener('input', syncChips);

  // ⌥1…⌥6 by physical key: on a Mac ⌥digit types a symbol (¡, ™…), so e.key can't be used.
  window.addEventListener(
    'keydown',
    (e) => {
      const digit = /^Digit([1-9])$/.exec(e.code)?.[1];
      if (!digit || !e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const item = frequent[Number(digit) - 1];
      if (Number(digit) > MAX_FREQUENT || !item) return;
      e.preventDefault();
      e.stopPropagation();
      openFrequent(item);
    },
    true,
  );

  startClock();
  setUpStale(input, reload);
}

function startClock(): void {
  const clock = document.querySelector<HTMLElement>('.clock')!;
  const time = clock.querySelector('time')!;
  const date = clock.querySelector('small')!;
  const tick = () => {
    const now = new Date();
    time.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    time.dateTime = now.toISOString();
    // English like the rest of the UI; the time keeps the system's 12/24-hour format.
    date.textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    setTimeout(tick, 60_000 - (now.getTime() % 60_000));
  };
  tick();
  clock.hidden = false;
}

let renderStale: (tabs: StaleTab[]) => void = () => {};

/** The "N tabs untouched for a week" button, its review dialog, and undo after closing. */
function setUpStale(input: HTMLInputElement, reload: () => void): void {
  const button = document.querySelector<HTMLButtonElement>('.stale')!;
  const dialog = document.querySelector<HTMLDialogElement>('.stale-dialog')!;
  const list = dialog.querySelector('.stale-list')!;
  const confirm = dialog.querySelector<HTMLButtonElement>('button.primary')!;
  const toast = document.querySelector<HTMLElement>('.toast')!;
  let stale: StaleTab[] = [];
  let toastTimer = 0;

  const tabs = (n: number) => `${n} ${n === 1 ? 'tab' : 'tabs'}`;
  const checked = () => [...list.querySelectorAll<HTMLInputElement>('input:checked')].map((box) => stale[Number(box.value)]!);
  const syncConfirm = () => {
    const n = checked().length;
    confirm.textContent = n ? `Close ${tabs(n)}` : 'Close';
    confirm.disabled = !n;
  };

  renderStale = (found) => {
    stale = found;
    button.hidden = !found.length;
    button.innerHTML = '';
    const count = document.createElement('b');
    count.textContent = tabs(found.length);
    button.append(count, ' untouched for a week · Review');
  };

  button.addEventListener('click', () => {
    const now = Date.now();
    list.replaceChildren(
      ...stale.map((t, i) => {
        const row = document.createElement('li');
        const label = document.createElement('label');
        const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: true, value: String(i) });
        box.addEventListener('change', syncConfirm);
        const text = document.createElement('span');
        text.className = 'text';
        const title = Object.assign(document.createElement('span'), { className: 'title', textContent: t.title });
        const url = Object.assign(document.createElement('span'), { className: 'url', textContent: shortUrl(t.url) });
        text.append(title, url);
        const age = Object.assign(document.createElement('span'), {
          className: 'age',
          textContent: `${Math.floor((now - t.lastAccessed) / DAY_MS)} days`,
        });
        const tile = renderTile({ id: '', kind: 'tab', titles: [t.title], url: t.url, tabs: [], similarTabs: [] });
        label.append(box, tile, text, age);
        row.append(label);
        return row;
      }),
    );
    syncConfirm();
    dialog.showModal();
  });

  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'close') void closeTabs(checked());
    input.focus();
  });

  async function closeTabs(closing: StaleTab[]): Promise<void> {
    if (!closing.length) return;
    await chrome.tabs.remove(closing.map((t) => t.tabId));
    reload();
    showToast(`Closed ${tabs(closing.length)}`, async () => {
      // No `sessions` permission: reopen the URLs in their windows (history inside those tabs is gone).
      const windows = new Set((await chrome.windows.getAll()).map((w) => w.id));
      for (const t of [...closing].sort((a, b) => a.index - b.index)) {
        await chrome.tabs.create({ url: t.url, active: false, ...(windows.has(t.windowId) ? { windowId: t.windowId, index: t.index } : {}) });
      }
      reload();
    });
  }

  function showToast(text: string, undo: () => Promise<void>): void {
    toast.querySelector('span')!.textContent = text;
    const undoButton = toast.querySelector('button')!;
    undoButton.onclick = () => {
      toast.hidden = true;
      void undo().finally(() => input.focus());
    };
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toast.hidden = true), UNDO_MS);
  }
}

// Last, once everything above is defined. Opened by Chrome: the worker is about to replace this tab,
// so don't render and nothing flashes.
if (params.has(REPLACED)) start();
else setTimeout(start, REPLACE_TIMEOUT_MS);
