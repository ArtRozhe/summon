import { execute } from './actions';
import { buildItems } from './data';
import { type Memory, merge, type PickEvent, record } from './memory';
import { loadMemory, saveMemory } from './storage';
import type { Action, Context, Item } from './types';

/** When the panel was last invoked, to report how fast it appeared (diagnostics only). */
let invokedAt = 0;

/**
 * Click on the icon or the `_execute_action` shortcut (both arrive here: the action has no default popup).
 * On regular pages the search panel is drawn inside the page — no new process, so it appears fast.
 * Where scripts can't run (chrome://, Web Store, PDF viewer) the regular popup opens instead.
 */
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined) return;
  invokedAt = Date.now();
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['overlay.js'] });
  } catch {
    await openPopupFallback(tab);
  }
});

async function openPopupFallback(tab: chrome.tabs.Tab): Promise<void> {
  // A popup set only for this tab and only for this one opening; otherwise onClicked would stop firing.
  await chrome.action.setPopup({ tabId: tab.id, popup: 'popup.html' });
  try {
    await chrome.action.openPopup({ windowId: tab.windowId });
  } finally {
    await chrome.action.setPopup({ tabId: tab.id, popup: '' });
  }
}

export type OverlayRequest =
  | { type: 'load' }
  | { type: 'execute'; action: Action }
  | { type: 'record'; event: PickEvent }
  | { type: 'import'; memory: Memory };
export interface LoadResponse {
  items: Item[];
  ctx: Context;
  memory: Memory;
  invokedAt: number;
}

function contextOf(sender: chrome.runtime.MessageSender): Context {
  return { currentTabId: sender.tab?.id, currentWindowId: sender.tab?.windowId };
}

async function load(sender: chrome.runtime.MessageSender): Promise<LoadResponse> {
  const [tabs, tree, memory] = await Promise.all([chrome.tabs.query({}), chrome.bookmarks.getTree(), loadMemory()]);
  const ownPages = chrome.runtime.getURL('');
  const otherTabs = tabs.filter((t) => !(t.url || t.pendingUrl || '').startsWith(ownPages));
  return { items: buildItems(otherTabs, tree), ctx: contextOf(sender), memory, invokedAt };
}

/** The only writer of memory (both shells send their picks here); writes run one after another. */
let writes: Promise<unknown> = Promise.resolve();
function update(change: (memory: Memory) => Memory): Promise<Memory> {
  const write = writes.then(async () => {
    const next = change(await loadMemory());
    await saveMemory(next);
    return next;
  });
  writes = write.catch(() => {});
  return write;
}

chrome.runtime.onMessage.addListener((message: OverlayRequest, sender, respond) => {
  const work =
    message.type === 'load'
      ? load(sender)
      : message.type === 'record'
        ? update((memory) => record(memory, message.event, Date.now()))
        : message.type === 'import'
          ? update((memory) => merge(memory, message.memory, Date.now()))
          : execute(message.action, contextOf(sender));
  work.then(
    (result) => respond({ ok: true, result }),
    (error: unknown) => respond({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
  return true;
});
