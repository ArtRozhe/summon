import type { Item, TabRef } from './types';

interface BookmarkNode {
  id: string;
  title: string;
  url?: string;
  children?: BookmarkNode[];
}
type Tab = Pick<chrome.tabs.Tab, 'id' | 'windowId' | 'title' | 'url' | 'pendingUrl' | 'lastAccessed'> & { index?: number };

/**
 * The parser's canonical form (lowercase scheme and host, trailing slash on a bare origin).
 * Used to collapse duplicate bookmarks; query and hash stay, they can mean different pages.
 */
export function urlKey(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

interface ParsedUrl {
  key: string;
  /** `null` for URLs without a real origin (chrome://, file://, about:): those only match exactly. */
  origin: string | null;
  path: string;
  params: URLSearchParams;
  hash: string;
}

function parseUrl(url: string): ParsedUrl {
  try {
    const u = new URL(url);
    return {
      key: u.href,
      origin: u.origin === 'null' ? null : u.origin,
      path: u.pathname,
      params: u.searchParams,
      hash: u.hash,
    };
  } catch {
    return { key: url, origin: null, path: '', params: new URLSearchParams(), hash: '' };
  }
}

/**
 * How a tab relates to a bookmark:
 * - `open`: same origin and path, every bookmark parameter present in the tab with the same value
 *   (extra tab parameters are fine), same hash if the bookmark has one. A translator bookmark with
 *   `sl=ru&tl=en` is open in a tab that also has `text=…`, but not in one with `sl=en&tl=ru`.
 * - `similar`: same origin, the tab's path is the bookmark's path or below it, parameters differ.
 *   An app bookmark with `?company=a&date=…` is similar to any tab of that app.
 */
export function matchTab(bookmark: ParsedUrl, tab: ParsedUrl): 'open' | 'similar' | null {
  if (bookmark.key === tab.key) return 'open';
  if (!bookmark.origin || bookmark.origin !== tab.origin) return null;
  const samePath = bookmark.path === tab.path;
  if (samePath && (!bookmark.hash || bookmark.hash === tab.hash)) {
    const allParams = [...bookmark.params].every(([name, value]) => tab.params.getAll(name).includes(value));
    if (allParams) return 'open';
  }
  const below = bookmark.path.endsWith('/') ? bookmark.path : `${bookmark.path}/`;
  return samePath || tab.path.startsWith(below) ? 'similar' : null;
}

export function matchUrls(bookmarkUrl: string, tabUrl: string): 'open' | 'similar' | null {
  return matchTab(parseUrl(bookmarkUrl), parseUrl(tabUrl));
}

function flattenBookmarks(nodes: BookmarkNode[], out: BookmarkNode[] = []): BookmarkNode[] {
  for (const node of nodes) {
    if (node.url) out.push(node);
    if (node.children) flattenBookmarks(node.children, out);
  }
  return out;
}

/** Bookmarklets would need script injection, which the extension does not have. */
function isOpenable(url: string): boolean {
  return !url.toLowerCase().startsWith('javascript:');
}

export function buildItems(tabs: Tab[], bookmarkTree: BookmarkNode[]): Item[] {
  const openTabs: { ref: TabRef; title: string; url: ParsedUrl }[] = [];
  for (const tab of tabs) {
    const url = tab.url || tab.pendingUrl;
    if (tab.id === undefined || !url) continue;
    openTabs.push({
      ref: { tabId: tab.id, windowId: tab.windowId, lastAccessed: tab.lastAccessed ?? 0, index: tab.index },
      title: tab.title || url,
      url: parseUrl(url),
    });
  }

  // Bookmarks with the same URL collapse into one item carrying all their names.
  const bookmarksByUrl = new Map<string, { id: string; titles: string[]; url: string }>();
  for (const node of flattenBookmarks(bookmarkTree)) {
    const url = node.url!;
    if (!isOpenable(url)) continue;
    const key = urlKey(url);
    const existing = bookmarksByUrl.get(key);
    const title = node.title.trim();
    if (existing) {
      if (title && !existing.titles.includes(title)) existing.titles.push(title);
    } else {
      bookmarksByUrl.set(key, { id: node.id, titles: title ? [title] : [], url });
    }
  }

  const items: Item[] = [];
  // A tab where a bookmark is open is shown only inside that bookmark's row.
  const shownInBookmark = new Set<number>();
  for (const bookmark of bookmarksByUrl.values()) {
    const parsed = parseUrl(bookmark.url);
    const open: (typeof openTabs)[number][] = [];
    const similar: TabRef[] = [];
    for (const tab of openTabs) {
      const match = matchTab(parsed, tab.url);
      if (match === 'open') open.push(tab);
      else if (match === 'similar') similar.push(tab.ref);
    }
    for (const tab of open) shownInBookmark.add(tab.ref.tabId);
    const tabTitles = open.map((t) => t.title).filter((t) => !bookmark.titles.includes(t));
    const titles = [...bookmark.titles, ...new Set(tabTitles)];
    items.push({
      id: `b${bookmark.id}`,
      kind: 'bookmark',
      titles: titles.length ? titles : [bookmark.url],
      url: bookmark.url,
      tabs: open.map((t) => t.ref),
      similarTabs: similar,
    });
  }

  for (const { ref, title, url } of openTabs) {
    if (shownInBookmark.has(ref.tabId)) continue;
    items.push({ id: `t${ref.tabId}`, kind: 'tab', titles: [title], url: url.key, tabs: [ref], similarTabs: [] });
  }

  return items;
}
