import { describe, expect, it } from 'vitest';
import { layoutVariants } from '../../src/layout';
import { emptyMemory, learnedFor, learnedForAny, record } from '../../src/memory';
import { isPinned, MAX_RESULTS, prepare, search } from '../../src/search';
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

  it('does not search an untitled page\'s URL as a title (random query words would match anything)', () => {
    const url =
      'https://sso.example.test/callback?client_id=oidc-identity&code=AE9vKOlWHASVz6GzrfhGHFhuyMBJJ2MYTnwsu6m4C-0' +
      '&nonce=OTgxYzIzN2QtOTMxMi00OGI4LWI1ZGUtMjc2NTJiODU2NDM1YjYxYjJmMTgtZWZmYS00ZjQwLWE0ZTktMWZlNWFkOTBlNWE3' +
      '&token=CfDJ8Dv1Rm0WJ1dGoELh9ccg0G5tLxvSQBHW_0a5UkfjOrAEJQrEskfIDVoZ40TMZLXEBAgQZYwvLdndynwL-OcdHW2IW4D00HmYiDc' +
      '_VSiuRjjLmhpNDbiryJ1rTKhL5jUsXXuzW2ZmMP_rvCieb_CqOPbTnHmMf2GOEGpqnEE0FAY8lASGwsc6AbbzzX_UfyRns1IsHZPI6pueWfYS';
    const untitled = [tab(url, url)];
    expect(titlesFor(untitled, 'как сделать так')).toEqual([]);
    expect(titlesFor(untitled, 'asdfasdfasdf')).toEqual([]);
    // The URL itself is still searched.
    expect(titlesFor(untitled, 'sso')).toEqual([url]);
    expect(titlesFor(untitled, 'callback')).toEqual([url]);
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

describe('learned picks', () => {
  const items = [
    bookmark('AppDev1', 'https://dev1.app.example/'),
    bookmark('AppDev2', 'https://dev2.app.example/'),
    bookmark('Docs', 'https://docs.example/'),
  ];
  const now = Date.UTC(2026, 9, 1);
  const twice = (query: string, url: string) =>
    record(record(emptyMemory(), { query, key: url }, now), { query, key: url }, now + 1);

  it('moves the usual pick to the top', () => {
    const learned = learnedFor(twice('ad', 'https://dev2.app.example/'), 'ad', now + 2);
    const results = search(items.map(prepare), 'ad', ctx, learned);
    expect(results.map((i) => i.titles[0])).toEqual(['AppDev2', 'AppDev1']);
    expect(isPinned(results[0]!, learned)).toBe(true);
  });

  it('never brings in a result that does not match', () => {
    const learned = learnedFor(twice('ad', 'https://docs.example/'), 'ad', now + 2);
    expect(search(items.map(prepare), 'ad', ctx, learned).map((i) => i.titles[0])).toEqual(['AppDev1', 'AppDev2']);
  });
});

describe('wrong keyboard layout', () => {
  const items = [
    bookmark('AppDev1', 'https://dev1.app.example/'),
    bookmark('TranslateEnglishRussian', 'https://translate.example/?sl=en&tl=ru'),
    bookmark('Котики', 'https://cats.example/'),
  ];

  it('finds results typed with the other layout on', () => {
    expect(titlesFor(items, 'фв1')).toEqual(['AppDev1']);
    expect(titlesFor(items, 'еук')).toEqual(['TranslateEnglishRussian']);
    expect(titlesFor(items, 'rjnbrb')).toEqual(['Котики']);
  });

  it('ranks a match as typed above the same strength after switching layouts', () => {
    // "ao" and "фщ" are the same keys: each matches one title exactly as typed and the other after switching.
    const mixed = [bookmark('ao', 'https://a.example/'), bookmark('фщ', 'https://b.example/')];
    expect(titlesFor(mixed, 'ao')).toEqual(['ao', 'фщ']);
    expect(titlesFor(mixed, 'фщ')).toEqual(['фщ', 'ao']);
  });

  it('uses habits learned in either layout', () => {
    const now = Date.UTC(2026, 9, 1);
    const twice = record(record(emptyMemory(), { query: 'ad', key: 'https://dev2.app.example/' }, now), { query: 'ad', key: 'https://dev2.app.example/' }, now + 1);
    const apps = [bookmark('AppDev1', 'https://dev1.app.example/'), bookmark('AppDev2', 'https://dev2.app.example/')];
    const learned = learnedForAny(twice, layoutVariants('фв'), now + 2);
    expect(search(apps.map(prepare), 'фв', ctx, learned).map((i) => i.titles[0])).toEqual(['AppDev2', 'AppDev1']);
  });
});
