import { describe, expect, it } from 'vitest';
import { resolveAction } from '../../src/actions';
import { asAddress, webItems } from '../../src/web';

describe('asAddress', () => {
  it('reads URLs, domains, localhost and IPs as addresses', () => {
    expect(asAddress('https://example.com/a?b=1')).toEqual({ url: 'https://example.com/a?b=1', likely: true });
    expect(asAddress('github.com')).toEqual({ url: 'https://github.com/', likely: true });
    expect(asAddress('kit.test/dev')).toEqual({ url: 'https://kit.test/dev', likely: true });
    expect(asAddress('localhost:3000')).toEqual({ url: 'http://localhost:3000/', likely: true });
    expect(asAddress('192.168.0.1')).toEqual({ url: 'http://192.168.0.1/', likely: true });
  });

  it('keeps an uncommon TLD without a path as a maybe ("next.js" is more likely a search)', () => {
    expect(asAddress('next.js')).toEqual({ url: 'https://next.js/', likely: false });
  });

  it('ignores words, phrases and abbreviations', () => {
    for (const q of ['kd', 'git rebase', 'e.g', 'AppDev1', 'node .js', '']) expect(asAddress(q)).toBeUndefined();
  });
});

describe('webItems', () => {
  it('offers going to a likely address before searching, and searching first otherwise', () => {
    expect(webItems('github.com').map((i) => i.titles[0])).toEqual(['Go to github.com', 'Search for “github.com”']);
    expect(webItems('next.js').map((i) => i.titles[0])).toEqual(['Search for “next.js”', 'Go to next.js']);
    expect(webItems('git rebase').map((i) => i.titles[0])).toEqual(['Search for “git rebase”']);
    expect(webItems('  ')).toEqual([]);
  });

  it('resolve to a web search and to opening the address', () => {
    const [go, search] = webItems('github.com');
    expect(resolveAction(search, {}, {})).toEqual({ type: 'web-search', text: 'github.com' });
    expect(resolveAction(go, {}, { currentTabId: 1 })).toEqual({ type: 'open-new', url: 'https://github.com/' });
  });
});
