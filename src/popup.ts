// Fallback shell: the action popup, opened by the background worker on pages where the
// overlay can't run (chrome://, Web Store, PDF viewer).
import { execute } from './actions';
import { buildItems } from './data';
import type { OverlayRequest } from './background';
import { loadMemory } from './storage';
import type { Context } from './types';
import panelCss from './ui/panel.css';
import { mountPanel, PANEL_MARKUP } from './ui/panel';
import themeCss from './ui/popup.css';

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

const sheet = new CSSStyleSheet();
sheet.replaceSync(panelCss + themeCss);
document.adoptedStyleSheets = [sheet];

const panel = document.querySelector<HTMLElement>('.panel')!;
panel.innerHTML = PANEL_MARKUP;

const { input } = mountPanel(panel, {
  async load() {
    const [ctx, tabs, tree, memory] = await Promise.all([
      loadContext(),
      chrome.tabs.query({}),
      chrome.bookmarks.getTree(),
      loadMemory(),
    ]);
    const ownPages = chrome.runtime.getURL('');
    const otherTabs = tabs.filter((t) => !(t.url || t.pendingUrl || '').startsWith(ownPages));
    return { items: buildItems(otherTabs, tree), ctx, memory };
  },
  remember(event) {
    // The background worker is the only writer; the message is out before the popup closes.
    void chrome.runtime.sendMessage({ type: 'record', event } satisfies OverlayRequest);
  },
  async perform(action, ctx) {
    await execute(action, ctx);
    window.close();
  },
  close: () => window.close(),
  loaded: () => performance.mark('summon:first-results'),
});
input.focus();
