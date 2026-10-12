import { describe, expect, it } from 'vitest';
import { toHistoryItems, visitedAgo } from '../../src/history';

const page = (id: number, url: string, title = '', lastVisitTime = 0) => ({ id: String(id), url, title, lastVisitTime });

describe('toHistoryItems', () => {
  it('leaves out open tabs and bookmarks, duplicates and non-web pages', () => {
    const items = toHistoryItems(
      [
        page(1, 'https://kit.example/dev', 'Kit'),
        page(2, 'https://news.example/item?id=1', 'Story'),
        page(3, 'https://news.example/item?id=1', 'Story again'),
        page(4, 'chrome://settings/', 'Settings'),
        page(5, 'https://plain.example/'),
      ],
      ['https://kit.example/dev'],
    );
    expect(items.map((i) => [i.kind, i.titles[0]])).toEqual([
      ['history', 'Story'],
      ['history', 'https://plain.example/'],
    ]);
  });
});

describe('visitedAgo', () => {
  const now = new Date(2026, 9, 13, 10, 0).getTime();
  it('counts calendar days', () => {
    expect(visitedAgo(new Date(2026, 9, 13, 0, 30).getTime(), now)).toBe('Today');
    expect(visitedAgo(new Date(2026, 9, 12, 23, 50).getTime(), now)).toBe('Yesterday');
    expect(visitedAgo(new Date(2026, 9, 8, 12, 0).getTime(), now)).toBe('5 days ago');
  });
});
