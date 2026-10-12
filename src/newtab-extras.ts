// New tab page extras: frequent picks as chips and tabs left untouched for a while. Pure logic.
import { frequent, type Memory, memoryKey } from './memory';
import type { Item } from './types';

export const MAX_FREQUENT = 6;
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** The most picked results that still exist as a bookmark or an open tab (bookmarks win: they carry the name). */
export function frequentItems(memory: Memory, items: Item[], now: number): Item[] {
  const byKey = new Map<string, Item>();
  for (const item of items) {
    const key = memoryKey(item.url);
    if (!byKey.has(key) || (item.kind === 'bookmark' && byKey.get(key)!.kind === 'tab')) byKey.set(key, item);
  }
  return frequent(memory, now)
    .map((key) => byKey.get(key))
    .filter((item): item is Item => !!item)
    .slice(0, MAX_FREQUENT);
}

export interface StaleTab {
  tabId: number;
  windowId: number;
  index: number;
  title: string;
  url: string;
  lastAccessed: number;
}

/**
 * Tabs not looked at for a week: not pinned, not playing sound, not the active tab of a window, not Summon's own.
 * Oldest first.
 */
export function staleTabs(tabs: chrome.tabs.Tab[], now: number, ownPrefix: string): StaleTab[] {
  return tabs
    .filter((t) => {
      const url = t.url || t.pendingUrl || '';
      return (
        t.id !== undefined &&
        t.lastAccessed !== undefined &&
        now - t.lastAccessed >= STALE_AFTER_MS &&
        !t.pinned &&
        !t.audible &&
        !t.active &&
        !url.startsWith(ownPrefix)
      );
    })
    .map((t) => ({
      tabId: t.id!,
      windowId: t.windowId,
      index: t.index,
      title: t.title || t.url || '',
      url: t.url || t.pendingUrl || '',
      lastAccessed: t.lastAccessed!,
    }))
    .sort((a, b) => a.lastAccessed - b.lastAccessed);
}
