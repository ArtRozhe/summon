import { describe, expect, it } from 'vitest';
import { highlight, type Range } from '../../src/highlight';

/** Renders highlights as [brackets] for readable expectations. */
function show(text: string, ranges: Range[]): string {
  let out = '';
  let at = 0;
  for (const [start, end] of ranges) {
    out += `${text.slice(at, start)}[${text.slice(start, end)}]`;
    at = end;
  }
  return out + text.slice(at);
}

function title(text: string, query: string, url = 'example.test'): string {
  return show(text, highlight(text, url, query).title);
}

describe('highlight in titles', () => {
  it('marks a whole word and a word start', () => {
    expect(title('Pull requests · GitHub', 'github')).toBe('Pull requests · [GitHub]');
    expect(title('Stack Overflow', 'over')).toBe('Stack [Over]flow');
    expect(title('Roadmap Q4 - Google Docs', 'road')).toBe('[Road]map Q4 - Google Docs');
  });

  it('marks the letters of an abbreviation', () => {
    expect(title('AppDev1', 'ad1')).toBe('[A]pp[D]ev[1]');
    expect(title('AppDev1', 'apd1')).toBe('[Ap]p[D]ev[1]');
    expect(title('GoogleTranslateEnglishRussian', 'gter')).toBe('[G]oogle[T]ranslate[E]nglish[R]ussian');
    expect(title('AppInfraDeploy', 'ad')).toBe('[A]ppInfra[D]eploy');
  });

  it('marks every word of the query', () => {
    expect(title('Pull requests · GitHub', 'pull hub')).toBe('[Pull] requests · Git[Hub]');
  });

  it('marks a substring within a word', () => {
    expect(title('Stack Overflow', 'flow')).toBe('Stack Over[flow]');
  });

  it('marks what was typed with the other keyboard layout', () => {
    expect(title('AppDev1', 'фв1')).toBe('[A]pp[D]ev[1]');
  });
});

describe('highlight in URLs', () => {
  it('marks the URL when the title doesn’t match', () => {
    const h = highlight('Some page', 'docs.example.test/guide/intro', 'intro');
    expect(h.title).toEqual([]);
    expect(show('docs.example.test/guide/intro', h.url)).toBe('docs.example.test/guide/[intro]');
  });

  it('prefers a host label', () => {
    const h = highlight('Some page', 'grafana.test/d/abc', 'graf');
    expect(show('grafana.test/d/abc', h.url)).toBe('[graf]ana.test/d/abc');
  });
});
