import { describe, expect, it } from 'vitest';
import { emptyMemory, frequent, record } from '../../src/memory';
import { frequentItems, staleTabs } from '../../src/newtab-extras';
import { bookmark, tab } from './fixtures';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 13);

function picked(...picks: [query: string, url: string, daysAgo: number][]) {
  return picks.reduce((m, [query, url, daysAgo]) => record(m, { query, key: url }, NOW - daysAgo * DAY), emptyMemory());
}

describe('frequent', () => {
  it('sums picks over all queries and leaves out one-offs', () => {
    const memory = picked(['kd', 'https://kit.example/dev', 0], ['kit', 'https://kit.example/dev', 0], ['ad1', 'https://app.example/', 0],
      ['ad1', 'https://app.example/', 1], ['ad1', 'https://app.example/', 2], ['hn', 'https://news.example/', 0]);
    expect(frequent(memory, NOW)).toEqual(['https://app.example/', 'https://kit.example/dev']);
  });

  it('lets old habits fade', () => {
    const memory = picked(['old', 'https://old.example/', 30], ['old', 'https://old.example/', 30], ['old', 'https://old.example/', 30]);
    expect(frequent(memory, NOW)).toEqual([]);
  });
});

describe('frequentItems', () => {
  it('maps keys to existing items, preferring the bookmark over a tab with the same URL', () => {
    const memory = picked(['kd', 'https://kit.example/dev', 0], ['kd', 'https://kit.example/dev', 0], ['gone', 'https://gone.example/', 0], ['gone', 'https://gone.example/', 0]);
    const items = [tab('Kit — dev', 'https://kit.example/dev'), bookmark('KitDev', 'https://kit.example/dev')];
    expect(frequentItems(memory, items, NOW).map((i) => i.titles[0])).toEqual(['KitDev']);
  });
});

describe('staleTabs', () => {
  const base = { index: 0, windowId: 1, pinned: false, active: false, audible: false, highlighted: false, incognito: false, selected: false, discarded: false, autoDiscardable: true, groupId: -1, frozen: false };
  const t = (id: number, daysAgo: number, extra: Partial<chrome.tabs.Tab> = {}) =>
    ({ ...base, id, title: `T${id}`, url: `https://t${id}.example/`, lastAccessed: NOW - daysAgo * DAY, ...extra }) as chrome.tabs.Tab;

  it('lists tabs untouched for a week, oldest first', () => {
    expect(staleTabs([t(1, 8), t(2, 3), t(3, 20)], NOW, 'chrome-extension://x/').map((s) => s.tabId)).toEqual([3, 1]);
  });

  it('keeps pinned, audible, active and own tabs', () => {
    const tabs = [t(1, 9, { pinned: true }), t(2, 9, { audible: true }), t(3, 9, { active: true }), t(4, 9, { url: 'chrome-extension://x/newtab.html' })];
    expect(staleTabs(tabs, NOW, 'chrome-extension://x/')).toEqual([]);
  });
});
