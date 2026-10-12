export interface TabRef {
  tabId: number;
  windowId: number;
  lastAccessed: number;
  /** Position in its window, to reopen a closed tab where it was. */
  index?: number;
}

/**
 * One search result. A bookmark whose URL is open in one or more tabs is a single
 * merged item: `kind: 'bookmark'` with those tabs in `tabs`.
 */
export interface Item {
  id: string;
  /** `history`: a page from browsing history that is neither open nor bookmarked (optional permission). */
  kind: 'tab' | 'bookmark' | 'history';
  /** Display title first, then other titles that should also match (other bookmark names, tab titles). */
  titles: string[];
  url: string;
  /**
   * For a tab: exactly that tab. For a bookmark: tabs where it is open — same origin and path,
   * every query parameter of the bookmark present with the same value, same hash if the bookmark has one.
   */
  tabs: TabRef[];
  /** Bookmarks only: tabs of the same origin under the bookmark's path, with other parameters (⌥↵ switches to them). */
  similarTabs: TabRef[];
  /** History only: last visit, epoch ms. */
  lastVisit?: number;
}

/** The tab and window the panel was invoked from. */
export interface Context {
  currentTabId?: number;
  currentWindowId?: number;
  /** The current tab is Summon's own new tab page: opening replaces it, switching away closes it. */
  blankTab?: boolean;
}

export interface Modifiers {
  shift?: boolean;
  alt?: boolean;
}

export type Action =
  | { type: 'activate'; tabId: number; windowId: number }
  | { type: 'open-new'; url: string }
  | { type: 'open-here'; tabId: number; url: string }
  /** The target is already the current tab: just close the panel. */
  | { type: 'none' }
  /** Tab actions (⌘K, ⇧⌘⌫): the panel stays open for close and reopen. */
  | { type: 'close'; tabId: number }
  | { type: 'reopen'; url: string; windowId: number; index?: number }
  | { type: 'open-background'; url: string }
  | { type: 'move-here'; tabId: number }
  | { type: 'new-window'; tabId?: number; url: string };
