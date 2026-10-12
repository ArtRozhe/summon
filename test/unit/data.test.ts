import { describe, expect, it } from 'vitest';
import { buildItems, matchUrls, urlKey } from '../../src/data';

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

describe('matchUrls (is a bookmark open in a tab?)', () => {
  const translate = 'https://translate.example/?sl=ru&tl=en&op=translate';

  it('is open when every bookmark parameter is in the tab, extra ones are fine', () => {
    expect(matchUrls(translate, 'https://translate.example/?sl=ru&tl=en&text=hello&op=translate')).toBe('open');
    expect(matchUrls(translate, 'https://translate.example/?op=translate&tl=en&sl=ru')).toBe('open');
  });

  it('is only similar when a bookmark parameter differs or is missing', () => {
    expect(matchUrls(translate, 'https://translate.example/?sl=en&tl=ru&op=translate')).toBe('similar');
    expect(matchUrls(translate, 'https://translate.example/')).toBe('similar');
  });

  it('treats an app with state in the query as similar in any state', () => {
    const app = 'https://app.example/?company=a&date=2022-02-11';
    expect(matchUrls(app, 'https://app.example/?company=b&date=2024-01-01')).toBe('similar');
    expect(matchUrls(app, 'https://app.example/projects/42')).toBe('similar');
    expect(matchUrls(app, 'https://dev.app.example/?company=a&date=2022-02-11')).toBeNull();
  });

  it('requires the same hash when the bookmark has one', () => {
    const sheet = 'https://docs.example/sheet/1/edit#gid=1';
    expect(matchUrls(sheet, 'https://docs.example/sheet/1/edit#gid=1')).toBe('open');
    expect(matchUrls(sheet, 'https://docs.example/sheet/1/edit#gid=2')).toBe('similar');
    expect(matchUrls('https://docs.example/sheet/1/edit', 'https://docs.example/sheet/1/edit#gid=2')).toBe('open');
  });

  it('counts only tabs at or below the bookmark path, on word boundaries', () => {
    const repo = 'https://code.example/org/app';
    expect(matchUrls(repo, 'https://code.example/org/app/pulls')).toBe('similar');
    expect(matchUrls(repo, 'https://code.example/org/app-old')).toBeNull();
    expect(matchUrls(repo, 'https://code.example/org')).toBeNull();
    expect(matchUrls('https://ci.example/job/build/', 'https://ci.example/job/build/42/console')).toBe('similar');
  });

  it('matches URLs without an origin only exactly', () => {
    expect(matchUrls('chrome://settings/', 'chrome://settings/')).toBe('open');
    expect(matchUrls('chrome://settings/', 'chrome://settings/privacy')).toBeNull();
  });
});

describe('buildItems with similar tabs', () => {
  const bm = (id: string, title: string, url: string) => ({ id, title, url });

  it('keeps a similar tab as its own row and attaches it to the bookmark', () => {
    const items = buildItems([tab(5, 'https://app.example/?company=b', 'Dashboard')], [bm('1', 'AppProd', 'https://app.example/?company=a')]);
    const b = items.find((i) => i.kind === 'bookmark')!;
    expect(b.tabs).toEqual([]);
    expect(b.similarTabs.map((t) => t.tabId)).toEqual([5]);
    expect(items.filter((i) => i.kind === 'tab').map((i) => i.titles[0])).toEqual(['Dashboard']);
  });

  it('shows a tab where a bookmark is open only inside that bookmark, even with extra parameters', () => {
    const items = buildItems(
      [tab(5, 'https://translate.example/?sl=ru&tl=en&text=hi', 'Translate'), tab(6, 'https://translate.example/?sl=en&tl=ru', 'Translate')],
      [bm('1', 'TranslateRuEn', 'https://translate.example/?sl=ru&tl=en'), bm('2', 'TranslateEnRu', 'https://translate.example/?sl=en&tl=ru')],
    );
    const ruEn = items.find((i) => i.titles[0] === 'TranslateRuEn')!;
    const enRu = items.find((i) => i.titles[0] === 'TranslateEnRu')!;
    expect(ruEn.tabs.map((t) => t.tabId)).toEqual([5]);
    expect(ruEn.similarTabs.map((t) => t.tabId)).toEqual([6]);
    expect(enRu.tabs.map((t) => t.tabId)).toEqual([6]);
    expect(items.filter((i) => i.kind === 'tab')).toEqual([]);
  });
});
