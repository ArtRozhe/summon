// New tab page: the panel centered on the page. The current tab is this page itself, so
// opening a bookmark replaces it and switching to another tab closes it (`blankTab`).
//
// Chrome gives a new tab's focus to the address bar; the background worker swaps the tab for one
// that gets page focus (newtab-focus.ts).
import { execute } from './actions';
import type { OverlayRequest } from './background';
import { buildItems } from './data';
import { REPLACED } from './newtab-focus';
import { loadMemory } from './storage';
import overlayCss from './ui/overlay.css';
import panelCss from './ui/panel.css';
import { mountPanel, PANEL_MARKUP } from './ui/panel';
import newtabCss from './ui/newtab.css';

const params = new URLSearchParams(location.search);
const tabPromise = chrome.tabs.getCurrent();
/** If the worker doesn't replace this tab by then, show the page here (focus stays in the address bar). */
const REPLACE_TIMEOUT_MS = 1500;

// Opened by Chrome: the worker is about to replace this tab, so don't render and nothing flashes.
if (params.has(REPLACED)) start();
else setTimeout(start, REPLACE_TIMEOUT_MS);

function start(): void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(panelCss + overlayCss + newtabCss);
  document.adoptedStyleSheets = [sheet];

  const panel = document.querySelector<HTMLElement>('.panel')!;
  panel.innerHTML = PANEL_MARKUP;

  const { input } = mountPanel(panel, {
    async load() {
      const [tab, tabs, tree, memory] = await Promise.all([
        tabPromise,
        chrome.tabs.query({}),
        chrome.bookmarks.getTree(),
        loadMemory(),
      ]);
      const ownPages = chrome.runtime.getURL('');
      const otherTabs = tabs.filter((t) => !(t.url || t.pendingUrl || '').startsWith(ownPages));
      return { items: buildItems(otherTabs, tree), ctx: { currentTabId: tab?.id, currentWindowId: tab?.windowId, blankTab: true }, memory };
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
}
