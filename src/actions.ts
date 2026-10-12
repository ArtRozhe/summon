import type { Action, Context, Item, Modifiers, TabRef } from './types';

/** Among tabs with the same URL: the current tab, else one in the current window, else the most recently used. */
export function pickTab(tabs: TabRef[], ctx: Context): TabRef | undefined {
  const current = tabs.find((t) => t.tabId === ctx.currentTabId);
  if (current) return current;
  const byRecency = [...tabs].sort((a, b) => b.lastAccessed - a.lastAccessed);
  return byRecency.find((t) => t.windowId === ctx.currentWindowId) ?? byRecency[0];
}

function switchTo(tabs: TabRef[], ctx: Context): Action | null {
  const tab = pickTab(tabs, ctx);
  if (!tab) return null;
  if (tab.tabId === ctx.currentTabId) return { type: 'none' };
  return { type: 'activate', tabId: tab.tabId, windowId: tab.windowId };
}

/**
 * `preferSwitch`: learned for this bookmark (two ⌥↵ in a row) — Enter switches to a similar tab and ⌥↵
 * opens the bookmark anew, the other way round from the default.
 */
export function resolveAction(item: Item | undefined, mods: Modifiers, ctx: Context, preferSwitch = false): Action | null {
  const action = resolve(item, mods, ctx, preferSwitch);
  // A blank Summon tab is there to be replaced: open things in it instead of next to it.
  if (action?.type === 'open-new' && ctx.blankTab && ctx.currentTabId !== undefined) {
    return { type: 'open-here', tabId: ctx.currentTabId, url: action.url };
  }
  return action;
}

function resolve(item: Item | undefined, mods: Modifiers, ctx: Context, preferSwitch: boolean): Action | null {
  if (!item) return null;

  if (item.kind === 'bookmark') {
    const toSimilar = (): Action | null => switchTo(item.tabs, ctx) ?? switchTo(item.similarTabs, ctx);
    if (preferSwitch && !mods.shift) {
      return mods.alt ? (switchTo(item.tabs, ctx) ?? { type: 'open-new', url: item.url }) : (toSimilar() ?? { type: 'open-new', url: item.url });
    }
    // ⌥↵: switch to a tab where the bookmark is open, or else to a similar one (same app, other parameters).
    if (mods.alt) return toSimilar();
    // ⇧↵ explicitly loads the bookmark in the current tab, even if it is open elsewhere.
    if (mods.shift) {
      return ctx.currentTabId === undefined
        ? { type: 'open-new', url: item.url }
        : { type: 'open-here', tabId: ctx.currentTabId, url: item.url };
    }
  }

  return switchTo(item.tabs, ctx) ?? { type: 'open-new', url: item.url };
}

/** The tab that tab actions (close, move here) apply to: the one Enter would switch to. Bookmarks: only where open. */
export function tabFor(item: Item | undefined, ctx: Context): TabRef | undefined {
  return item ? pickTab(item.tabs, ctx) : undefined;
}

/** What Enter / ⇧↵ / ⌥↵ will do, for the hint line. */
export function describe(
  item: Item | undefined,
  ctx: Context,
  preferSwitch = false,
): { enter: string; shiftEnter?: string; altEnter?: string } | null {
  if (!item) return null;
  const onlySimilar = item.kind === 'bookmark' && !item.tabs.length && item.similarTabs.length > 0;
  const enter = resolveAction(item, {}, ctx, preferSwitch)!;
  const enterLabel =
    enter.type === 'open-new'
      ? 'Open in new tab'
      : enter.type === 'open-here'
        ? 'Open in this tab'
        : enter.type === 'none'
        ? 'Already here'
        : onlySimilar
          ? 'Switch to open tab'
          : 'Switch to tab';
  if (item.kind === 'tab') return { enter: enterLabel };
  const openLabel = ctx.blankTab ? 'Open in this tab' : 'Open in new tab';
  const altEnter = onlySimilar ? (preferSwitch ? openLabel : 'Switch to open tab') : undefined;
  // In a blank tab ⇧↵ does the same as opening.
  return { enter: enterLabel, shiftEnter: ctx.blankTab ? undefined : 'Open in this tab', altEnter };
}

/** For memory: what a choice on a bookmark with only similar tabs amounted to. */
export function similarOutcome(item: Item, mods: Modifiers, action: Action): 'switch' | 'new' | undefined {
  if (item.kind !== 'bookmark' || item.tabs.length || !item.similarTabs.length || mods.shift) return undefined;
  if (action.type === 'activate' || action.type === 'none') return 'switch';
  // Shift is ruled out above, so loading here means opening anew from a blank tab.
  return action.type === 'open-new' || action.type === 'open-here' ? 'new' : undefined;
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
      // Switching away leaves the blank Summon tab behind: close it.
      if (ctx.blankTab && ctx.currentTabId !== undefined) calls.push(chrome.tabs.remove(ctx.currentTabId));
      break;
    case 'open-new':
      calls.push(chrome.tabs.create({ url: action.url, active: true, windowId: ctx.currentWindowId }));
      break;
    case 'open-here':
      calls.push(chrome.tabs.update(action.tabId, { url: action.url }));
      break;
    case 'close':
      calls.push(chrome.tabs.remove(action.tabId));
      break;
    case 'reopen': {
      const url = action.url;
      // Its window may be gone by now: then the current one.
      calls.push(
        chrome.tabs
          .create({ url, active: false, windowId: action.windowId, index: action.index })
          .catch(() => chrome.tabs.create({ url, active: false })),
      );
      break;
    }
    case 'move-here': {
      const tabId = action.tabId;
      // Activate once it has arrived, so it becomes the active tab of this window. Moving doesn't close the
      // popup, so the activation still goes out from it.
      const moved =
        ctx.currentWindowId === undefined
          ? Promise.resolve()
          : chrome.tabs.move(tabId, { windowId: ctx.currentWindowId, index: -1 });
      calls.push(moved.then(() => chrome.tabs.update(tabId, { active: true })));
      if (ctx.blankTab && ctx.currentTabId !== undefined) calls.push(chrome.tabs.remove(ctx.currentTabId));
      break;
    }
    case 'new-window':
      calls.push(chrome.windows.create(action.tabId !== undefined ? { tabId: action.tabId, focused: true } : { url: action.url, focused: true }));
      if (ctx.blankTab && ctx.currentTabId !== undefined) calls.push(chrome.tabs.remove(ctx.currentTabId));
      break;
    case 'none':
      break;
  }
  await Promise.all(calls);
}
