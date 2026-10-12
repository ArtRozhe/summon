// What Summon learns from use: which result you pick for a query, and whether you switch to a similar
// tab of an app (⌥↵) or open its bookmark anew. Pure functions over a JSON-able object; storage is elsewhere.

export const MEMORY_VERSION = 1;

/** A choice fades to half its weight in a week, so new habits quickly win over old ones. */
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_QUERIES = 500;
const MAX_ITEMS_PER_QUERY = 5;
const MAX_SIMILAR = 500;

/** Pinned first: picked at least twice, still about two recent picks' worth, twice the runner-up. */
const PIN_MIN_PICKS = 2;
const PIN_MIN_WEIGHT = 1.5;
const PIN_RATIO = 2;
const EXACT_BONUS_PER_PICK = 15;
const EXACT_BONUS_MAX = 30;
const PREFIX_BONUS_PER_PICK = 5;
const PREFIX_BONUS_MAX = 10;

export interface Pick {
  /** Times picked. */
  n: number;
  /** Decayed weight as of `last`: every pick adds 1. */
  weight: number;
  last: number;
}

export interface SimilarHabit {
  /** Enter on this bookmark switches to a similar tab instead of opening a new one. */
  preferSwitch: boolean;
  /** The last two outcomes, newest last. */
  recent: ('switch' | 'new')[];
  last: number;
}

export interface Memory {
  version: typeof MEMORY_VERSION;
  /** Normalized query → result key (URL) → pick. */
  picks: Record<string, Record<string, Pick>>;
  /** Bookmark key (URL) → habit with its similar tabs. */
  similar: Record<string, SimilarHabit>;
}

export interface PickEvent {
  query: string;
  /** Result key: the result's URL, as `memoryKey` makes it. */
  key: string;
  /** Set when a bookmark had only similar tabs and Enter / ⌥↵ either switched to one or opened it anew. */
  similarOutcome?: 'switch' | 'new';
}

export function emptyMemory(): Memory {
  return { version: MEMORY_VERSION, picks: {}, similar: {} };
}

/** Result identity across sessions: tab ids change after a restart, URLs don't. */
export function memoryKey(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

function weightAt(pick: Pick, now: number): number {
  return pick.weight * 0.5 ** (Math.max(0, now - pick.last) / HALF_LIFE_MS);
}

/** Reads whatever was stored; anything unknown or broken starts empty rather than failing. */
export function migrate(raw: unknown): Memory {
  if (!raw || typeof raw !== 'object') return emptyMemory();
  const data = raw as Partial<Memory>;
  if (data.version !== MEMORY_VERSION) return emptyMemory();
  return {
    version: MEMORY_VERSION,
    picks: data.picks && typeof data.picks === 'object' ? data.picks : {},
    similar: data.similar && typeof data.similar === 'object' ? data.similar : {},
  };
}

export function record(memory: Memory, event: PickEvent, now: number): Memory {
  const next: Memory = { version: MEMORY_VERSION, picks: { ...memory.picks }, similar: { ...memory.similar } };

  const query = normalizeQuery(event.query);
  if (query) {
    const items = { ...next.picks[query] };
    const old = items[event.key];
    items[event.key] = {
      n: (old?.n ?? 0) + 1,
      weight: (old ? weightAt(old, now) : 0) + 1,
      last: now,
    };
    next.picks[query] = items;
  }

  if (event.similarOutcome) {
    const old = next.similar[event.key];
    const recent = [...(old?.recent ?? []), event.similarOutcome].slice(-2);
    let preferSwitch = old?.preferSwitch ?? false;
    // Two in a row flip the habit; a single different choice doesn't.
    if (recent.length === 2 && recent[0] === recent[1]) preferSwitch = recent[0] === 'switch';
    next.similar[event.key] = { preferSwitch, recent, last: now };
  }

  return prune(next, now);
}

function prune(memory: Memory, now: number): Memory {
  const queries = Object.entries(memory.picks)
    .map(([query, items]) => {
      const kept = Object.entries(items)
        .sort(([, a], [, b]) => weightAt(b, now) - weightAt(a, now))
        .slice(0, MAX_ITEMS_PER_QUERY);
      return [query, Object.fromEntries(kept), Math.max(...kept.map(([, p]) => p.last))] as const;
    })
    .sort((a, b) => b[2] - a[2])
    .slice(0, MAX_QUERIES);
  const similar = Object.entries(memory.similar)
    .sort(([, a], [, b]) => b.last - a.last)
    .slice(0, MAX_SIMILAR);
  return {
    version: MEMORY_VERSION,
    picks: Object.fromEntries(queries.map(([query, items]) => [query, items])),
    similar: Object.fromEntries(similar),
  };
}

export interface Learned {
  /** The result to show first for this exact query, if a habit is clear. */
  pinned?: string;
  /** Extra relevance per result key. */
  bonus: Map<string, number>;
}

/** What memory says about a query: a pinned result and bonuses (exact query strong, longer queries it starts weak). */
export function learnedFor(memory: Memory, rawQuery: string, now: number): Learned {
  const query = normalizeQuery(rawQuery);
  const bonus = new Map<string, number>();
  if (!query) return { bonus };

  const add = (key: string, value: number) => bonus.set(key, (bonus.get(key) ?? 0) + value);
  for (const [stored, items] of Object.entries(memory.picks)) {
    if (stored !== query && !stored.startsWith(query)) continue;
    for (const [key, pick] of Object.entries(items)) {
      const w = weightAt(pick, now);
      if (stored === query) add(key, Math.min(EXACT_BONUS_MAX, EXACT_BONUS_PER_PICK * w));
      else add(key, Math.min(PREFIX_BONUS_MAX, PREFIX_BONUS_PER_PICK * w));
    }
  }

  let pinned: string | undefined;
  const ranked = Object.entries(memory.picks[query] ?? {})
    .map(([key, pick]) => ({ key, pick, w: weightAt(pick, now) }))
    .sort((a, b) => b.w - a.w);
  const [top, second] = ranked;
  if (top && top.pick.n >= PIN_MIN_PICKS && top.w >= PIN_MIN_WEIGHT && top.w >= PIN_RATIO * (second?.w ?? 0)) {
    pinned = top.key;
  }
  return { pinned, bonus };
}

export function prefersSwitch(memory: Memory, key: string): boolean {
  return memory.similar[key]?.preferSwitch ?? false;
}
