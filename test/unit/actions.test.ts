import { describe, expect, it } from 'vitest';
import { describe as describeAction, pickTab, resolveAction, similarOutcome } from '../../src/actions';
import type { Context } from '../../src/types';
import { bookmark, tab } from './fixtures';

const ctx: Context = { currentTabId: 100, currentWindowId: 1 };

describe('resolveAction', () => {
  it('does nothing without a selected result', () => {
    expect(resolveAction(undefined, {}, ctx)).toBeNull();
    expect(resolveAction(undefined, { shift: true }, ctx)).toBeNull();
  });

  it('activates a tab on Enter and on Shift+Enter', () => {
    const t = tab('A', 'https://a.example/', { tabId: 5, windowId: 2 });
    const expected = { type: 'activate', tabId: 5, windowId: 2 };
    expect(resolveAction(t, {}, ctx)).toEqual(expected);
    expect(resolveAction(t, { shift: true }, ctx)).toEqual(expected);
  });

  it('only closes the panel for the current tab', () => {
    expect(resolveAction(tab('Here', 'https://h.example/', { tabId: 100 }), {}, ctx)).toEqual({ type: 'none' });
  });

  it('opens a closed bookmark in a new tab on Enter', () => {
    expect(resolveAction(bookmark('B', 'https://b.example/'), {}, ctx)).toEqual({ type: 'open-new', url: 'https://b.example/' });
  });

  it('opens a bookmark in the current tab on Shift+Enter', () => {
    const expected = { type: 'open-here', tabId: 100, url: 'https://b.example/' };
    expect(resolveAction(bookmark('B', 'https://b.example/'), { shift: true }, ctx)).toEqual(expected);
    const open = bookmark('B', 'https://b.example/', [{ tabId: 5, windowId: 1, lastAccessed: 1 }]);
    expect(resolveAction(open, { shift: true }, ctx)).toEqual(expected);
  });

  it('falls back to a new tab on Shift+Enter when the current tab is unknown', () => {
    expect(resolveAction(bookmark('B', 'https://b.example/'), { shift: true }, {})).toEqual({ type: 'open-new', url: 'https://b.example/' });
  });

  it('switches to an already open bookmark on Enter instead of opening a duplicate', () => {
    const open = bookmark('B', 'https://b.example/', [{ tabId: 5, windowId: 3, lastAccessed: 1 }]);
    expect(resolveAction(open, {}, ctx)).toEqual({ type: 'activate', tabId: 5, windowId: 3 });
  });
});

describe('⌥↵ on a bookmark', () => {
  const similar = { tabId: 7, windowId: 2, lastAccessed: 3 };

  it('switches to a similar tab when the bookmark itself is not open', () => {
    const b = bookmark('App', 'https://app.example/?team=a', [], [similar]);
    expect(resolveAction(b, { alt: true }, ctx)).toEqual({ type: 'activate', tabId: 7, windowId: 2 });
    // Plain Enter stays strict: a new tab.
    expect(resolveAction(b, {}, ctx)).toEqual({ type: 'open-new', url: 'https://app.example/?team=a' });
  });

  it('prefers a tab where the bookmark is open', () => {
    const b = bookmark('App', 'https://app.example/', [{ tabId: 5, windowId: 1, lastAccessed: 1 }], [similar]);
    expect(resolveAction(b, { alt: true }, ctx)).toEqual({ type: 'activate', tabId: 5, windowId: 1 });
  });

  it('does nothing without open or similar tabs', () => {
    expect(resolveAction(bookmark('App', 'https://app.example/'), { alt: true }, ctx)).toBeNull();
  });

  it('only closes the panel when the similar tab is the current one', () => {
    const b = bookmark('App', 'https://app.example/?team=a', [], [{ tabId: 100, windowId: 1, lastAccessed: 0 }]);
    expect(resolveAction(b, { alt: true }, ctx)).toEqual({ type: 'none' });
  });

  it('acts like Enter on a tab result', () => {
    const t = tab('A', 'https://a.example/', { tabId: 5, windowId: 2 });
    expect(resolveAction(t, { alt: true }, ctx)).toEqual({ type: 'activate', tabId: 5, windowId: 2 });
  });
});

describe('describe', () => {
  it('offers ⌥↵ only for a bookmark with similar tabs and no exact one', () => {
    const similar = [{ tabId: 7, windowId: 1, lastAccessed: 0 }];
    expect(describeAction(bookmark('App', 'https://app.example/?a=1', [], similar), ctx)?.altEnter).toBe('Switch to open tab');
    expect(describeAction(bookmark('App', 'https://app.example/', similar, similar), ctx)?.altEnter).toBeUndefined();
    expect(describeAction(bookmark('App', 'https://app.example/'), ctx)?.altEnter).toBeUndefined();
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

describe('learned preference to switch to a similar tab', () => {
  const similar = { tabId: 7, windowId: 2, lastAccessed: 3 };
  const app = bookmark('App', 'https://app.example/?team=a', [], [similar]);

  it('makes Enter switch and ⌥↵ open anew; ⇧↵ is unchanged', () => {
    expect(resolveAction(app, {}, ctx, true)).toEqual({ type: 'activate', tabId: 7, windowId: 2 });
    expect(resolveAction(app, { alt: true }, ctx, true)).toEqual({ type: 'open-new', url: 'https://app.example/?team=a' });
    expect(resolveAction(app, { shift: true }, ctx, true)).toEqual({ type: 'open-here', tabId: 100, url: 'https://app.example/?team=a' });
  });

  it('falls back to opening when nothing similar is open', () => {
    expect(resolveAction(bookmark('App', 'https://app.example/'), {}, ctx, true)).toEqual({ type: 'open-new', url: 'https://app.example/' });
  });

  it('is spelled out in the hints', () => {
    expect(describeAction(app, ctx, true)).toEqual({ enter: 'Switch to open tab', shiftEnter: 'Open in this tab', altEnter: 'Open in new tab' });
    expect(describeAction(app, ctx, false)).toEqual({ enter: 'Open in new tab', shiftEnter: 'Open in this tab', altEnter: 'Switch to open tab' });
  });

  it('records the outcome only when only similar tabs were open and Shift was not held', () => {
    expect(similarOutcome(app, { alt: true }, { type: 'activate', tabId: 7, windowId: 2 })).toBe('switch');
    expect(similarOutcome(app, {}, { type: 'open-new', url: app.url })).toBe('new');
    expect(similarOutcome(app, { shift: true }, { type: 'open-here', tabId: 100, url: app.url })).toBeUndefined();
    const open = bookmark('App', 'https://app.example/', [{ tabId: 5, windowId: 1, lastAccessed: 1 }], [similar]);
    expect(similarOutcome(open, {}, { type: 'activate', tabId: 5, windowId: 1 })).toBeUndefined();
  });
});

describe('blank Summon tab (new tab page)', () => {
  const blank: Context = { ...ctx, blankTab: true };
  const other = { tabId: 7, windowId: 1, lastAccessed: 3 };

  it('opens bookmarks in place instead of a new tab', () => {
    expect(resolveAction(bookmark('B', 'https://b.example/'), {}, blank)).toEqual({ type: 'open-here', tabId: 100, url: 'https://b.example/' });
    expect(describeAction(bookmark('B', 'https://b.example/'), blank)).toEqual({ enter: 'Open in this tab', shiftEnter: undefined, altEnter: undefined });
  });

  it('still switches to open tabs', () => {
    expect(resolveAction(tab('T', 'https://t.example/', other), {}, blank)).toEqual({ type: 'activate', tabId: 7, windowId: 1 });
  });

  it('counts opening in place as opening anew for the ⌥↵ habit', () => {
    const app = bookmark('App', 'https://app.example/?team=a', [], [other]);
    expect(similarOutcome(app, {}, resolveAction(app, {}, blank)!)).toBe('new');
    expect(describeAction(app, blank)).toEqual({ enter: 'Open in this tab', shiftEnter: undefined, altEnter: 'Switch to open tab' });
  });
});
