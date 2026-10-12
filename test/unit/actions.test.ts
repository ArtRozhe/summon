import { describe, expect, it } from 'vitest';
import { pickTab, resolveAction } from '../../src/actions';
import type { Context } from '../../src/types';
import { bookmark, tab } from './fixtures';

const ctx: Context = { currentTabId: 100, currentWindowId: 1 };

describe('resolveAction', () => {
  it('does nothing without a selected result', () => {
    expect(resolveAction(undefined, false, ctx)).toBeNull();
    expect(resolveAction(undefined, true, ctx)).toBeNull();
  });

  it('activates a tab on Enter and on Shift+Enter', () => {
    const t = tab('A', 'https://a.example/', { tabId: 5, windowId: 2 });
    const expected = { type: 'activate', tabId: 5, windowId: 2 };
    expect(resolveAction(t, false, ctx)).toEqual(expected);
    expect(resolveAction(t, true, ctx)).toEqual(expected);
  });

  it('only closes the panel for the current tab', () => {
    expect(resolveAction(tab('Here', 'https://h.example/', { tabId: 100 }), false, ctx)).toEqual({ type: 'none' });
  });

  it('opens a closed bookmark in a new tab on Enter', () => {
    expect(resolveAction(bookmark('B', 'https://b.example/'), false, ctx)).toEqual({ type: 'open-new', url: 'https://b.example/' });
  });

  it('opens a bookmark in the current tab on Shift+Enter', () => {
    const expected = { type: 'open-here', tabId: 100, url: 'https://b.example/' };
    expect(resolveAction(bookmark('B', 'https://b.example/'), true, ctx)).toEqual(expected);
    const open = bookmark('B', 'https://b.example/', [{ tabId: 5, windowId: 1, lastAccessed: 1 }]);
    expect(resolveAction(open, true, ctx)).toEqual(expected);
  });

  it('falls back to a new tab on Shift+Enter when the current tab is unknown', () => {
    expect(resolveAction(bookmark('B', 'https://b.example/'), true, {})).toEqual({ type: 'open-new', url: 'https://b.example/' });
  });

  it('switches to an already open bookmark on Enter instead of opening a duplicate', () => {
    const open = bookmark('B', 'https://b.example/', [{ tabId: 5, windowId: 3, lastAccessed: 1 }]);
    expect(resolveAction(open, false, ctx)).toEqual({ type: 'activate', tabId: 5, windowId: 3 });
  });
});

describe('pickTab', () => {
  it('prefers the current tab, then the current window, then recency', () => {
    const current = { tabId: 100, windowId: 1, lastAccessed: 0 };
    const sameWindow = { tabId: 2, windowId: 1, lastAccessed: 1 };
    const otherRecent = { tabId: 3, windowId: 2, lastAccessed: 9 };
    const otherOld = { tabId: 4, windowId: 2, lastAccessed: 2 };
    expect(pickTab([otherRecent, sameWindow, current], ctx)).toBe(current);
    expect(pickTab([otherRecent, sameWindow], ctx)).toBe(sameWindow);
    expect(pickTab([otherOld, otherRecent], ctx)).toBe(otherRecent);
    expect(pickTab([], ctx)).toBeUndefined();
  });
});
