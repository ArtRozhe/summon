import type { Action, Context, Item, TabRef } from './types';

/** Among tabs with the same URL: the current tab, else one in the current window, else the most recently used. */
export function pickTab(tabs: TabRef[], ctx: Context): TabRef | undefined {
  const current = tabs.find((t) => t.tabId === ctx.currentTabId);
  if (current) return current;
  const byRecency = [...tabs].sort((a, b) => b.lastAccessed - a.lastAccessed);
  return byRecency.find((t) => t.windowId === ctx.currentWindowId) ?? byRecency[0];
}

export function resolveAction(item: Item | undefined, shift: boolean, ctx: Context): Action | null {
  if (!item) return null;

  // Shift+Enter on a bookmark explicitly loads it in the current tab, even if it is open elsewhere.
  if (item.kind === 'bookmark' && shift) {
    return ctx.currentTabId === undefined
      ? { type: 'open-new', url: item.url }
      : { type: 'open-here', tabId: ctx.currentTabId, url: item.url };
  }

  const tab = pickTab(item.tabs, ctx);
  if (!tab) return { type: 'open-new', url: item.url };
  if (tab.tabId === ctx.currentTabId) return { type: 'none' };
  return { type: 'activate', tabId: tab.tabId, windowId: tab.windowId };
}

/** What Enter / Shift+Enter will do, for the hint line. */
export function describe(item: Item | undefined, ctx: Context): { enter: string; shiftEnter?: string } | null {
  if (!item) return null;
  const enter = resolveAction(item, false, ctx)!;
  const enterLabel =
    enter.type === 'open-new' ? 'Open in new tab' : enter.type === 'none' ? 'Already here' : 'Switch to tab';
  if (item.kind === 'tab') return { enter: enterLabel };
  return { enter: enterLabel, shiftEnter: 'Open in this tab' };
}

/**
 * Runs the action. The popup closes itself as soon as another tab or window gets focus,
 * so all browser calls are dispatched before the first await: once sent, Chrome completes
 * them even if the popup document is already gone.
 */
export async function execute(action: Action, ctx: Context): Promise<void> {
  const calls: Promise<unknown>[] = [];
  switch (action.type) {
    case 'activate':
      calls.push(chrome.tabs.update(action.tabId, { active: true }));
      if (action.windowId !== ctx.currentWindowId) {
        calls.push(chrome.windows.update(action.windowId, { focused: true }));
      }
      break;
    case 'open-new':
      calls.push(chrome.tabs.create({ url: action.url, active: true, windowId: ctx.currentWindowId }));
      break;
    case 'open-here':
      calls.push(chrome.tabs.update(action.tabId, { url: action.url }));
      break;
    case 'none':
      break;
  }
  await Promise.all(calls);
}
