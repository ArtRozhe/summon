import { describe, expect, it } from 'vitest';
import { emptyMemory, learnedFor, type Memory, migrate, normalizeQuery, prefersSwitch, record } from '../../src/memory';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 1);
const DEV1 = 'https://dev1.app.example/';
const DEV2 = 'https://dev2.app.example/';

function picks(events: [query: string, key: string, at: number][], start = emptyMemory()): Memory {
  return events.reduce((m, [query, key, at]) => record(m, { query, key }, at), start);
}

describe('normalizeQuery', () => {
  it('ignores case and extra spaces', () => {
    expect(normalizeQuery('  OD  1 ')).toBe('od 1');
  });
});

describe('learnedFor', () => {
  it('pins a result picked twice for the exact query', () => {
    const m = picks([
      ['od', DEV2, T0],
      ['od', DEV2, T0 + 1000],
    ]);
    expect(learnedFor(m, 'od', T0 + 2000).pinned).toBe(DEV2);
    expect(learnedFor(m, 'OD ', T0 + 2000).pinned).toBe(DEV2);
  });

  it('does not pin after a single pick, but gives a bonus', () => {
    const m = picks([['od', DEV2, T0]]);
    const learned = learnedFor(m, 'od', T0);
    expect(learned.pinned).toBeUndefined();
    expect(learned.bonus.get(DEV2)).toBe(15);
  });

  it('does not pin without a clear winner', () => {
    const m = picks([
      ['od', DEV1, T0],
      ['od', DEV2, T0 + 1],
      ['od', DEV1, T0 + 2],
      ['od', DEV2, T0 + 3],
    ]);
    expect(learnedFor(m, 'od', T0 + 4).pinned).toBeUndefined();
  });

  it('lets a new habit take over an old one', () => {
    const old = picks([
      ['od', DEV1, T0],
      ['od', DEV1, T0 + 1],
      ['od', DEV1, T0 + 2],
    ]);
    expect(learnedFor(old, 'od', T0 + 3).pinned).toBe(DEV1);
    const later = T0 + 21 * DAY;
    const changed = picks(
      [
        ['od', DEV2, later],
        ['od', DEV2, later + 1],
      ],
      old,
    );
    expect(learnedFor(changed, 'od', later + 2).pinned).toBe(DEV2);
  });

  it('fades: an old habit is no longer pinned after a few weeks', () => {
    const m = picks([
      ['od', DEV1, T0],
      ['od', DEV1, T0 + 1],
    ]);
    expect(learnedFor(m, 'od', T0 + 2 * DAY).pinned).toBe(DEV1);
    expect(learnedFor(m, 'od', T0 + 30 * DAY).pinned).toBeUndefined();
  });

  it('gives a weak bonus from longer queries that start with this one', () => {
    const m = picks([
      ['od1', DEV1, T0],
      ['od1', DEV1, T0 + 1],
    ]);
    const learned = learnedFor(m, 'od', T0 + 2);
    expect(learned.pinned).toBeUndefined();
    expect(learned.bonus.get(DEV1)).toBeCloseTo(10);
    expect(learnedFor(m, 'x', T0).bonus.size).toBe(0);
  });

  it('learns nothing for an empty query', () => {
    const m = picks([['', DEV1, T0]]);
    expect(m.picks).toEqual({});
    expect(learnedFor(m, '', T0).bonus.size).toBe(0);
  });
});

describe('similar habit', () => {
  const B = 'https://app.example/?company=a';
  const choose = (m: Memory, outcome: 'switch' | 'new', at: number) =>
    record(m, { query: 'ap', key: B, similarOutcome: outcome }, at);

  it('switches after two ⌥↵ in a row and switches back after two opposite choices', () => {
    let m = choose(emptyMemory(), 'switch', T0);
    expect(prefersSwitch(m, B)).toBe(false);
    m = choose(m, 'switch', T0 + 1);
    expect(prefersSwitch(m, B)).toBe(true);
    m = choose(m, 'new', T0 + 2);
    expect(prefersSwitch(m, B)).toBe(true);
    m = choose(m, 'new', T0 + 3);
    expect(prefersSwitch(m, B)).toBe(false);
  });
});

describe('limits and storage format', () => {
  it('keeps at most 5 results per query, dropping the weakest', () => {
    const events: [string, string, number][] = [];
    for (let i = 0; i < 7; i++) for (let k = 0; k <= i; k++) events.push(['q', `https://r${i}.example/`, T0 + i * 10 + k]);
    const kept = Object.keys(picks(events).picks.q!);
    expect(kept).toHaveLength(5);
    expect(kept).not.toContain('https://r0.example/');
  });

  it('keeps at most 500 queries, dropping the least recent', () => {
    const events: [string, string, number][] = [];
    for (let i = 0; i < 510; i++) events.push([`q${i}`, DEV1, T0 + i]);
    const m = picks(events);
    expect(Object.keys(m.picks)).toHaveLength(500);
    expect(m.picks.q0).toBeUndefined();
    expect(m.picks.q509).toBeDefined();
  });

  it('starts empty from missing, broken or unknown-version data', () => {
    expect(migrate(undefined)).toEqual(emptyMemory());
    expect(migrate('nope')).toEqual(emptyMemory());
    expect(migrate({ version: 99, picks: { a: {} } })).toEqual(emptyMemory());
    const stored = picks([['od', DEV1, T0]]);
    expect(migrate(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });
});
