import type { Item, TabRef } from './types';

interface BookmarkNode {
  id: string;
  title: string;
  url?: string;
  children?: BookmarkNode[];
}
type Tab = Pick<chrome.tabs.Tab, 'id' | 'windowId' | 'title' | 'url' | 'pendingUrl' | 'lastAccessed'>;

/**
 * The only URL normalization: the parser's canonical form (lowercase scheme and host,
 * trailing slash on a bare origin). Query and hash stay, they can mean different pages.
 */
export function urlKey(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
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
  const tabsByUrl = new Map<string, { ref: TabRef; title: string }[]>();
  for (const tab of tabs) {
    const url = tab.url || tab.pendingUrl;
    if (tab.id === undefined || !url) continue;
    const key = urlKey(url);
    const entry = {
      ref: { tabId: tab.id, windowId: tab.windowId, lastAccessed: tab.lastAccessed ?? 0 },
      title: tab.title || url,
    };
    tabsByUrl.set(key, [...(tabsByUrl.get(key) ?? []), entry]);
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
  const mergedUrls = new Set<string>();
  for (const [key, bookmark] of bookmarksByUrl) {
    const open = tabsByUrl.get(key) ?? [];
    if (open.length) mergedUrls.add(key);
    const tabTitles = open.map((t) => t.title).filter((t) => !bookmark.titles.includes(t));
    const titles = [...bookmark.titles, ...new Set(tabTitles)];
    items.push({
      id: `b${bookmark.id}`,
      kind: 'bookmark',
      titles: titles.length ? titles : [bookmark.url],
      url: bookmark.url,
      tabs: open.map((t) => t.ref),
    });
  }

  for (const [key, open] of tabsByUrl) {
    if (mergedUrls.has(key)) continue;
    for (const { ref, title } of open) {
      items.push({ id: `t${ref.tabId}`, kind: 'tab', titles: [title], url: key, tabs: [ref] });
    }
  }

  return items;
}
