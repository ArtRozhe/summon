// History search (optional `history` permission, granted with "> Enable history search"): recent pages that are
// neither open nor bookmarked, searched by the same engine as tabs and bookmarks. Extension contexts only.
import { memoryKey } from './memory';
import type { Item } from './types';

const HISTORY: chrome.permissions.Permissions = { permissions: ['history'] };
const DAYS = 90;
const MAX_PAGES = 3000;

export function historyEnabled(): Promise<boolean> {
  return chrome.permissions.contains(HISTORY);
}

/** Asks Chrome for the permission; needs a user gesture in an extension page. */
export function enableHistory(): Promise<boolean> {
  return chrome.permissions.request(HISTORY);
}

export function disableHistory(): Promise<boolean> {
  return chrome.permissions.remove(HISTORY);
}

/** Pages visited in the last 90 days, minus the URLs already among `known` (tabs and bookmarks). */
export async function historyItems(known: string[], now = Date.now()): Promise<Item[]> {
  if (!(await historyEnabled())) return [];
  const pages = await chrome.history.search({ text: '', startTime: now - DAYS * 24 * 60 * 60 * 1000, maxResults: MAX_PAGES });
  return toHistoryItems(pages, known);
}

export function toHistoryItems(pages: chrome.history.HistoryItem[], known: string[]): Item[] {
  const seen = new Set(known.map(memoryKey));
  const items: Item[] = [];
  for (const page of pages) {
    if (!page.url || !/^https?:/.test(page.url)) continue;
    const key = memoryKey(page.url);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: `h${page.id}`,
      kind: 'history',
      titles: [page.title || page.url],
      url: page.url,
      tabs: [],
      similarTabs: [],
      lastVisit: page.lastVisitTime,
    });
  }
  return items;
}

/** For a history row: "Today", "Yesterday", "5 days ago" (calendar days in local time). */
export function visitedAgo(time: number, now = Date.now()): string {
  // Local midnights, rounded: days around a DST change are 23 or 25 hours long.
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(time).setHours(0, 0, 0, 0)) / 86_400_000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
}
