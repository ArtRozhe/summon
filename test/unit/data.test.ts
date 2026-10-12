import { describe, expect, it } from 'vitest';
import { buildItems, urlKey } from '../../src/data';

const tree = [
  {
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        title: 'Bar',
        children: [
          { id: '10', title: 'GitHub', url: 'https://github.com' },
          { id: '11', title: 'Deep', children: [{ id: '20', title: 'Nested', url: 'https://nested.example/a?x=1#h' }] },
          { id: '12', title: 'Bookmarklet', url: 'javascript:alert(1)' },
        ],
      },
      { id: '2', title: 'Other', children: [{ id: '30', title: 'GH again', url: 'https://github.com/' }] },
    ],
  },
];

const tab = (id: number, url: string, title = `Tab ${id}`, windowId = 1) => ({ id, windowId, url, title, lastAccessed: id });

describe('urlKey', () => {
  it('keeps query and hash, only canonicalizes', () => {
    expect(urlKey('HTTPS://Example.com')).toBe('https://example.com/');
    expect(urlKey('https://a.example/p?x=1#h')).not.toBe(urlKey('https://a.example/p?x=2#h'));
    expect(urlKey('https://a.example/p#a')).not.toBe(urlKey('https://a.example/p#b'));
  });
});

describe('buildItems', () => {
  it('flattens nested folders, merges duplicate bookmarks and skips bookmarklets', () => {
    const items = buildItems([], tree);
    expect(items.map((i) => i.titles)).toEqual([['GitHub', 'GH again'], ['Nested']]);
  });

  it('merges a bookmark with the tabs that have its URL', () => {
    const items = buildItems([tab(5, 'https://github.com/', 'GitHub: Let’s build'), tab(6, 'https://github.com/', 'GitHub: Let’s build', 2)], tree);
    const gh = items.find((i) => i.url === 'https://github.com')!;
    expect(gh.kind).toBe('bookmark');
    expect(gh.tabs.map((t) => t.tabId)).toEqual([5, 6]);
    expect(gh.titles).toEqual(['GitHub', 'GH again', 'GitHub: Let’s build']);
    expect(items.filter((i) => i.kind === 'tab')).toEqual([]);
  });

  it('does not merge when query or hash differ', () => {
    const items = buildItems([tab(5, 'https://nested.example/a?x=1')], tree);
    expect(items.map((i) => i.kind)).toEqual(['bookmark', 'bookmark', 'tab']);
  });

  it('keeps tabs with the same URL as separate rows when there is no bookmark', () => {
    const items = buildItems([tab(5, 'https://x.example/'), tab(6, 'https://x.example/', 'Tab 6', 2)], []);
    expect(items.map((i) => i.id)).toEqual(['t5', 't6']);
  });

  it('uses the URL when a title is missing and pendingUrl while loading', () => {
    const items = buildItems([{ id: 1, windowId: 1, pendingUrl: 'https://loading.example/', lastAccessed: 0 }], []);
    expect(items[0]!.titles).toEqual(['https://loading.example/']);
  });
});
