import type { Item } from '../../src/types';

let nextId = 1;

export function tab(title: string, url: string, opts: { tabId?: number; windowId?: number; lastAccessed?: number } = {}): Item {
  const tabId = opts.tabId ?? nextId++;
  return {
    id: `t${tabId}`,
    kind: 'tab',
    titles: [title],
    url,
    tabs: [{ tabId, windowId: opts.windowId ?? 1, lastAccessed: opts.lastAccessed ?? 0 }],
    similarTabs: [],
  };
}

export function bookmark(title: string, url: string, openTabs: Item['tabs'] = [], similarTabs: Item['tabs'] = []): Item {
  return { id: `b${nextId++}`, kind: 'bookmark', titles: [title], url, tabs: openTabs, similarTabs };
}
