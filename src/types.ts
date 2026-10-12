export interface TabRef {
  tabId: number;
  windowId: number;
  lastAccessed: number;
}

/**
 * One search result. A bookmark whose URL is open in one or more tabs is a single
 * merged item: `kind: 'bookmark'` with those tabs in `tabs`.
 */
export interface Item {
  id: string;
  kind: 'tab' | 'bookmark';
  /** Display title first, then other titles that should also match (other bookmark names, tab titles). */
  titles: string[];
  url: string;
  /** For a tab: exactly that tab. For a bookmark: open tabs with the same URL, possibly none. */
  tabs: TabRef[];
}

/** The tab and window the panel was invoked from. */
export interface Context {
  currentTabId?: number;
  currentWindowId?: number;
}

export type Action =
  | { type: 'activate'; tabId: number; windowId: number }
  | { type: 'open-new'; url: string }
  | { type: 'open-here'; tabId: number; url: string }
  /** The target is already the current tab: just close the panel. */
  | { type: 'none' };
