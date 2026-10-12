import { layoutVariants } from './layout';
import { type Learned, memoryKey } from './memory';
import type { Context, Item } from './types';

export const MAX_RESULTS = 8;

const SCORE = {
  exactWord: 100,
  /** The token is all initials of a title or of a camel-cased word: "gter" → GoogleTranslateEnglishRussian. */
  exactInitials: 95,
  fieldPrefix: 80,
  /** Word-start prefixes from the first word on, in order: "apd1" → AppDev1, "gtrans" → Google Translate. */
  humpsFromStart: 70,
  wordPrefix: 60,
  /** The same, but skipping words: "ad" → AppInfraDeploy. */
  humpsWithSkips: 45,
  substring: 30,
  urlRest: 10,
};
const OPEN_BONUS = 5;
/** A match only after switching the keyboard layout ranks a bit below the same match as typed. */
const LAYOUT_PENALTY = 5;
const CURRENT_PENALTY = 10;

interface PreparedTitle {
  lower: string;
  /** Words split at camel-case and letter/digit boundaries, joined by spaces: "app dev 1". */
  spaced: string;
  words: string[];
  /**
   * Word sequences for hump matching: the whole title, each title segment, each camel-cased word.
   * Lowercase, e.g. [["app", "dev", "1"]].
   */
  humps: string[][];
}

export interface Prepared {
  item: Item;
  /** Identity in memory (`memoryKey` of the URL). */
  key: string;
  titles: PreparedTitle[];
  /** Hostname without `www.`, e.g. `docs.google.com`. */
  host: string;
  /** Host labels except the TLD, e.g. `docs`, `google`. */
  hostLabels: string[];
  /** Path, query and hash, lowercased. For non-hierarchical URLs, the whole URL. */
  rest: string;
  lastAccessed: number;
}

/** Separators that split a page title into parts, e.g. "Pull requests · org/repo · GitHub". */
const SEGMENT_SEPARATOR = /\s+[·|•—–-]\s+|\s*[|•·:]\s*/u;
const NON_WORD = /[^\p{L}\p{N}]+/u;

/**
 * "GitHub" → ["Git", "Hub"], "HTMLParser" → ["HTML", "Parser"], "AppDev1" → ["App", "Dev", "1"].
 * A plural acronym stays whole: "PRs", "APIs".
 */
export function camelParts(word: string): string[] {
  return word
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll}{2,})/gu, '$1 $2')
    .replace(/(\p{L})(\p{N})/gu, '$1 $2')
    .replace(/(\p{N})(\p{L})/gu, '$1 $2')
    .split(' ')
    .filter(Boolean);
}

function humpsOf(text: string): string[] {
  return text.split(NON_WORD).filter(Boolean).flatMap(camelParts).map((h) => h.toLowerCase());
}

function prepareTitle(title: string): PreparedTitle {
  const raw = title.split(NON_WORD).filter(Boolean);
  const all = humpsOf(title);
  const words = new Set<string>([...raw.map((w) => w.toLowerCase()), ...all]);

  const humps = [all];
  const segments = title.split(SEGMENT_SEPARATOR);
  if (segments.length > 1) humps.push(...segments.map(humpsOf));
  for (const word of raw) {
    const parts = humpsOf(word);
    if (parts.length > 1) humps.push(parts);
  }

  return {
    lower: title.toLowerCase(),
    spaced: all.join(' '),
    words: [...words],
    humps: humps.filter((h) => h.length > 1),
  };
}

/**
 * Splits the token into prefixes of words taken in order, using at least two words.
 * 2: from the first word without skipping any; 1: with skipped words; 0: no match.
 */
export function humpMatch(token: string, humps: string[]): 0 | 1 | 2 {
  const memo = new Map<string, boolean>();
  const fits = (i: number, j: number, used: number, skip: boolean): boolean => {
    if (i === token.length) return used >= 2;
    const key = `${i},${j},${Math.min(used, 2)},${skip}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let ok = false;
    for (let k = j; k < humps.length && !ok; k++) {
      if (k > j && !skip) break;
      const hump = humps[k]!;
      for (let len = Math.min(hump.length, token.length - i); len >= 1 && !ok; len--) {
        if (hump.startsWith(token.slice(i, i + len))) ok = fits(i + len, k + 1, used + 1, skip);
      }
    }
    memo.set(key, ok);
    return ok;
  };
  if (fits(0, 0, 0, false)) return 2;
  return fits(0, 0, 0, true) ? 1 : 0;
}

function initials(humps: string[]): string {
  return humps.map((h) => h[0]).join('');
}

function splitUrl(url: string): { host: string; rest: string } {
  try {
    const u = new URL(url);
    if (!u.host) return { host: '', rest: url.toLowerCase() };
    return {
      host: u.hostname.replace(/^www\./, ''),
      rest: decodeSafe(u.pathname + u.search + u.hash).toLowerCase(),
    };
  } catch {
    return { host: '', rest: url.toLowerCase() };
  }
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function prepare(item: Item): Prepared {
  const { host, rest } = splitUrl(item.url);
  const labels = host.split('.').filter(Boolean);
  return {
    item,
    key: memoryKey(item.url),
    titles: item.titles.map(prepareTitle),
    host,
    hostLabels: labels.length > 1 ? labels.slice(0, -1) : labels,
    rest,
    lastAccessed: Math.max(0, ...item.tabs.map((t) => t.lastAccessed)),
  };
}

function tokenScore(p: Prepared, token: string): number {
  const { titles, host, hostLabels, rest } = p;
  if (titles.some((t) => t.lower === token || t.words.includes(token)) || hostLabels.includes(token)) {
    return SCORE.exactWord;
  }
  if (token.length >= 2 && titles.some((t) => t.humps.some((h) => initials(h) === token))) return SCORE.exactInitials;
  if (titles.some((t) => t.lower.startsWith(token)) || host.startsWith(token)) return SCORE.fieldPrefix;

  let hump = 0;
  if (token.length >= 2) {
    for (const t of titles) for (const h of t.humps) hump = Math.max(hump, humpMatch(token, h));
  }
  if (hump === 2) return SCORE.humpsFromStart;
  if (titles.some((t) => t.words.some((w) => w.startsWith(token))) || hostLabels.some((l) => l.startsWith(token))) {
    return SCORE.wordPrefix;
  }
  if (hump === 1) return SCORE.humpsWithSkips;

  // Substrings count within words only: "td" must not match across "Kit|Dev".
  // A token with punctuation ("acme/summon") is looked up in the raw title.
  const inTitle = NON_WORD.test(token)
    ? titles.some((t) => t.lower.includes(token))
    : titles.some((t) => t.spaced.includes(token));
  if (inTitle || host.includes(token)) return SCORE.substring;
  if (rest.includes(token)) return SCORE.urlRest;
  return 0;
}

function isCurrent(item: Item, ctx: Context): boolean {
  return item.tabs.some((t) => t.tabId === ctx.currentTabId);
}

export function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every token must match somewhere; returns 0 when the item does not match. */
export function score(p: Prepared, tokens: string[], ctx: Context): number {
  let total = 0;
  for (const token of tokens) {
    const s = tokenScore(p, token);
    if (!s) return 0;
    total += s;
  }
  if (p.item.tabs.length) total += OPEN_BONUS;
  if (isCurrent(p.item, ctx)) total -= CURRENT_PENALTY;
  return total;
}

function compare(a: { p: Prepared; s: number }, b: { p: Prepared; s: number }): number {
  return (
    b.s - a.s ||
    Number(b.p.item.tabs.length > 0) - Number(a.p.item.tabs.length > 0) ||
    b.p.lastAccessed - a.p.lastAccessed ||
    a.p.item.titles[0]!.length - b.p.item.titles[0]!.length
  );
}

/** Empty query: recently used tabs (any window), most recent first, without the current tab. */
function recent(prepared: Prepared[], ctx: Context, limit: number): Item[] {
  return prepared
    .filter((p) => p.item.tabs.length && !isCurrent(p.item, ctx))
    .sort((a, b) => b.lastAccessed - a.lastAccessed)
    .slice(0, limit)
    .map((p) => p.item);
}

/**
 * Matching results, best first. What was learned from earlier picks only reorders matches: a bonus per
 * result, and a pinned result moved to the top — it never brings in a result that doesn't match.
 */
export function search(prepared: Prepared[], query: string, ctx: Context, learned?: Learned): Item[] {
  const tokens = tokenize(query);
  if (!tokens.length) return recent(prepared, ctx, MAX_RESULTS);
  // The query as typed and as it reads in the other keyboard layout ("фв1" → "ad1"); each result takes its best.
  const variants = layoutVariants(query).map(tokenize);
  const best = (p: Prepared): number =>
    Math.max(
      ...variants.map((v, i) => {
        const s = score(p, v, ctx);
        return s && i ? s - LAYOUT_PENALTY : s;
      }),
    );
  const ranked = prepared
    .map((p) => ({ p, s: best(p) }))
    .filter((r) => r.s > 0)
    .map((r) => ({ ...r, s: r.s + (learned?.bonus.get(r.p.key) ?? 0) }))
    .sort(compare);
  const pinned = learned?.pinned ? ranked.findIndex((r) => r.p.key === learned.pinned) : -1;
  if (pinned > 0) ranked.unshift(...ranked.splice(pinned, 1));
  return ranked.slice(0, MAX_RESULTS).map((r) => r.p.item);
}

/** Whether the result is first because of a learned habit (for the row marker). */
export function isPinned(item: Item, learned?: Learned): boolean {
  return !!learned?.pinned && memoryKey(item.url) === learned.pinned;
}
