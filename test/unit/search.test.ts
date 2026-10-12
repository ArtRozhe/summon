import { describe, expect, it } from 'vitest';
import { MAX_RESULTS, prepare, search } from '../../src/search';
import type { Context, Item } from '../../src/types';
import { bookmark, tab } from './fixtures';

const ctx: Context = { currentTabId: 999, currentWindowId: 1 };

function titlesFor(items: Item[], query: string, context = ctx): string[] {
  return search(items.map(prepare), query, context).map((i) => i.titles[0]!);
}

describe('matching', () => {
  const items = [
    bookmark('GitHub', 'https://github.com/'),
    bookmark('Google Docs', 'https://docs.google.com/document/u/0/'),
    bookmark('Stack Overflow', 'https://stackoverflow.com/'),
    tab('Pull requests · acme/summon · GitHub', 'https://github.com/acme/summon/pulls'),
  ];

  it('ignores case', () => {
    expect(titlesFor(items, 'GITHUB')).toContain('GitHub');
  });

  it('requires every token to match', () => {
    expect(titlesFor(items, 'github pulls')).toEqual(['Pull requests · acme/summon · GitHub']);
    expect(titlesFor(items, 'github nothing-here')).toEqual([]);
  });

  it('matches word prefixes and substrings', () => {
    expect(titlesFor(items, 'overfl')).toEqual(['Stack Overflow']);
    expect(titlesFor(items, 'tackov')).toEqual(['Stack Overflow']);
  });

  it('matches initials of multi-word and camel-cased titles', () => {
    expect(titlesFor(items, 'gh')).toEqual(expect.arrayContaining(['GitHub', 'Pull requests · acme/summon · GitHub']));
    expect(titlesFor(items, 'gd')).toEqual(['Google Docs']);
    expect(titlesFor(items, 'so')).toEqual(['Stack Overflow']);
  });

  it('does not use initials for single-character tokens', () => {
    expect(titlesFor([bookmark('Google Docs', 'https://docs.google.com/')], 'x')).toEqual([]);
  });

  it('matches the URL path, but does not treat the TLD as a word', () => {
    expect(titlesFor(items, 'pulls')).toEqual(['Pull requests · acme/summon · GitHub']);
    expect(titlesFor([bookmark('Example', 'https://example.com/a')], 'com')).toEqual(['Example']);
    const ranked = titlesFor([bookmark('Comics', 'https://x.org/'), bookmark('Example', 'https://example.com/')], 'com');
    expect(ranked).toEqual(['Comics', 'Example']);
  });

  it('decodes percent-encoded paths', () => {
    expect(titlesFor([bookmark('Wiki', 'https://ru.wikipedia.org/wiki/%D0%9A%D0%BE%D1%82')], 'кот')).toEqual(['Wiki']);
  });
});

describe('humps (abbreviations from word starts)', () => {
  const items = [
    bookmark('AppDev1', 'https://dev1.app.example/'),
    bookmark('AppDev2', 'https://dev2.app.example/'),
    bookmark('AppInfraDeploy', 'https://ci.example/job/deploy/'),
    bookmark('AppPRs', 'https://code.example/org/app/pulls'),
    bookmark('UiKitRepo', 'https://code.example/org/ui-kit'),
    bookmark('UiKitDev', 'https://storybook.example/dev'),
    bookmark('TranslateEnglishRussian', 'https://translate.example/?sl=en&tl=ru'),
    bookmark('TranslateRussianEnglish', 'https://translate.example/?sl=ru&tl=en'),
  ];

  it('treats digits as words', () => {
    expect(titlesFor(items, 'ad1')).toEqual(['AppDev1']);
    expect(titlesFor(items, 'ad2')).toEqual(['AppDev2']);
    expect(titlesFor(items, 'dev 1')[0]).toBe('AppDev1');
  });

  it('takes several letters from a word', () => {
    expect(titlesFor(items, 'apd1')).toEqual(['AppDev1']);
    expect(titlesFor(items, 'ainfd')).toEqual(['AppInfraDeploy']);
    expect(titlesFor(items, 'trans')).toEqual(['TranslateEnglishRussian', 'TranslateRussianEnglish']);
  });

  it('ranks exact initials above a shared word prefix', () => {
    expect(titlesFor(items, 'ukr')[0]).toBe('UiKitRepo');
    expect(titlesFor(items, 'ter')).toEqual(['TranslateEnglishRussian']);
    // "Tr-anslate + E-nglish" also fits the other one, but exact initials rank first.
    expect(titlesFor(items, 'tre')).toEqual(['TranslateRussianEnglish', 'TranslateEnglishRussian']);
  });

  it('ranks matches from the first word above ones that skip words', () => {
    expect(titlesFor(items, 'ad')).toEqual(['AppDev1', 'AppDev2', 'AppInfraDeploy']);
  });

  it('keeps plural acronyms whole', () => {
    expect(titlesFor(items, 'prs')).toEqual(['AppPRs']);
    expect(titlesFor(items, 'ap')[0]).toBe('AppPRs');
  });

  it('does not match substrings across camel-case words', () => {
    expect(titlesFor([bookmark('UiKitDev', 'https://s.example/')], 'td')).toEqual([]);
  });
});

describe('ranking', () => {
  it('ranks domain matches above path matches', () => {
    const items = [bookmark('Some page', 'https://example.com/docs/intro'), bookmark('Google Docs', 'https://docs.google.com/')];
    expect(titlesFor(items, 'docs')).toEqual(['Google Docs', 'Some page']);
  });

  it('ranks prefix matches above substring matches', () => {
    const items = [bookmark('Email settings', 'https://a.example/'), bookmark('Gmail', 'https://mail.google.com/')];
    expect(titlesFor(items, 'mai')).toEqual(['Gmail', 'Email settings']);
  });

  it('ranks GitHub above a weak host substring for "gh"', () => {
    const items = [bookmark('Highlights', 'https://highlights.example/'), tab('Pull requests · GitHub', 'https://github.com/pulls')];
    expect(titlesFor(items, 'gh')[0]).toBe('Pull requests · GitHub');
  });

  it('prefers an open tab when relevance is comparable', () => {
    const items = [bookmark('Linear', 'https://linear.app/a'), tab('Linear', 'https://linear.app/b')];
    expect(search(items.map(prepare), 'linear', ctx).map((i) => i.kind)).toEqual(['tab', 'bookmark']);
  });

  it('breaks ties by recency', () => {
    const items = [
      tab('Notes A', 'https://notes.example/a', { lastAccessed: 1 }),
      tab('Notes B', 'https://notes.example/b', { lastAccessed: 5 }),
    ];
    expect(titlesFor(items, 'notes')).toEqual(['Notes B', 'Notes A']);
  });

  it('pushes the current tab below an equal match', () => {
    const items = [tab('Docs', 'https://a.example/', { tabId: 999 }), tab('Docs', 'https://b.example/', { tabId: 5 })];
    expect(search(items.map(prepare), 'docs', ctx).map((i) => i.tabs[0]!.tabId)).toEqual([5, 999]);
  });

  it(`returns at most ${MAX_RESULTS} results`, () => {
    const items = Array.from({ length: 20 }, (_, i) => bookmark(`Page ${i}`, `https://p.example/${i}`));
    expect(titlesFor(items, 'page')).toHaveLength(MAX_RESULTS);
  });
});

describe('empty query', () => {
  it('lists recent tabs from all windows without the current one and without bookmarks', () => {
    const items = [
      tab('Old', 'https://old.example/', { lastAccessed: 1 }),
      tab('Current', 'https://cur.example/', { tabId: 999, lastAccessed: 10 }),
      tab('Other window', 'https://w2.example/', { windowId: 2, lastAccessed: 5 }),
      bookmark('Bookmark', 'https://b.example/'),
      bookmark('Open bookmark', 'https://ob.example/', [{ tabId: 7, windowId: 1, lastAccessed: 3 }]),
    ];
    expect(titlesFor(items, '   ')).toEqual(['Other window', 'Open bookmark', 'Old']);
  });
});
