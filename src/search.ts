import type { Context, Item } from './types';

export const MAX_RESULTS = 8;

const SCORE = {
  exactWord: 100,
  fieldPrefix: 80,
  wordPrefix: 60,
  initials: 50,
  substring: 30,
  urlRest: 10,
};
const OPEN_BONUS = 5;
const CURRENT_PENALTY = 10;

interface PreparedTitle {
  lower: string;
  words: string[];
  initials: string[];
}

export interface Prepared {
  item: Item;
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

/** "GitHub" → ["Git", "Hub"], "iPhone" → ["i", "Phone"], "HTMLParser" → ["HTML", "Parser"]. */
function camelParts(word: string): string[] {
  return word
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(' ')
    .filter(Boolean);
}

function prepareTitle(title: string): PreparedTitle {
  const raw = title.split(NON_WORD).filter(Boolean);
  const words = new Set<string>();
  for (const word of raw) {
    words.add(word.toLowerCase());
    for (const part of camelParts(word)) words.add(part.toLowerCase());
  }

  // Initials per title segment ("Stack Overflow" → "so") and per camel-cased word ("GitHub" → "gh"),
  // so a long title like "Pull requests · GitHub" still yields "gh".
  const initials = new Set<string>();
  for (const segment of title.split(SEGMENT_SEPARATOR)) {
    const parts = segment.split(NON_WORD).filter(Boolean).flatMap(camelParts);
    if (parts.length > 1) initials.add(parts.map((p) => p[0]).join('').toLowerCase());
  }
  for (const word of raw) {
    const parts = camelParts(word);
    if (parts.length > 1) initials.add(parts.map((p) => p[0]).join('').toLowerCase());
  }

  return { lower: title.toLowerCase(), words: [...words], initials: [...initials] };
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
  if (titles.some((t) => t.lower.startsWith(token)) || host.startsWith(token)) return SCORE.fieldPrefix;
  if (titles.some((t) => t.words.some((w) => w.startsWith(token))) || hostLabels.some((l) => l.startsWith(token))) {
    return SCORE.wordPrefix;
  }
  if (token.length >= 2 && titles.some((t) => t.initials.some((i) => i.startsWith(token)))) return SCORE.initials;
  if (titles.some((t) => t.lower.includes(token)) || host.includes(token)) return SCORE.substring;
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

export function search(prepared: Prepared[], query: string, ctx: Context, limit = MAX_RESULTS): Item[] {
  const tokens = tokenize(query);
  if (!tokens.length) return recent(prepared, ctx, limit);
  return prepared
    .map((p) => ({ p, s: score(p, tokens, ctx) }))
    .filter((r) => r.s > 0)
    .sort(compare)
    .slice(0, limit)
    .map((r) => r.p.item);
}
