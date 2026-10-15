// Which characters of a result's title and URL to highlight for a query. Mirrors how search matches
// (whole word, start of title or word, word-start abbreviations, substring within a word, URL), so the
// highlight shows why a result is there. Only for the few rows on screen, never in the ranking loop.
import { layoutVariants } from './layout';
import { camelParts, humpPath, isUrlTitle, tokenize } from './search';

export type Range = [start: number, end: number];

interface Word {
  start: number;
  end: number;
  lower: string;
}

const WORD = /[\p{L}\p{N}]+/gu;
const NON_WORD = /[^\p{L}\p{N}]/u;

/** Raw words ("GitHub") and their camel/digit parts ("Git", "Hub") with their positions in the text. */
function wordsOf(text: string): { raw: Word[]; parts: Word[] } {
  const raw: Word[] = [];
  const parts: Word[] = [];
  for (const match of text.matchAll(WORD)) {
    const start = match.index!;
    raw.push({ start, end: start + match[0].length, lower: match[0].toLowerCase() });
    let offset = start;
    for (const part of camelParts(match[0])) {
      parts.push({ start: offset, end: offset + part.length, lower: part.toLowerCase() });
      offset += part.length;
    }
  }
  return { raw, parts };
}

function inTitle(title: string, token: string): Range[] | null {
  const lower = title.toLowerCase();
  if (NON_WORD.test(token)) {
    const at = lower.indexOf(token);
    return at < 0 ? null : [[at, at + token.length]];
  }
  const { raw, parts } = wordsOf(title);
  const words = [...raw, ...parts];

  const whole = words.find((w) => w.lower === token);
  if (whole) return [[whole.start, whole.end]];
  if (lower.startsWith(token)) return [[0, token.length]];
  const prefix = words.find((w) => w.lower.startsWith(token));
  if (prefix) return [[prefix.start, prefix.start + token.length]];

  if (token.length >= 2) {
    const humps = parts.map((p) => p.lower);
    const path = humpPath(token, humps, false) ?? humpPath(token, humps, true);
    if (path) return path.map(({ word, length }) => [parts[word]!.start, parts[word]!.start + length]);
  }

  for (const w of parts) {
    const at = w.lower.indexOf(token);
    if (at >= 0) return [[w.start + at, w.start + at + token.length]];
  }
  return null;
}

/** `url` as displayed: host, then path. Host first, as search ranks it. */
function inUrl(url: string, token: string): Range[] | null {
  const lower = url.toLowerCase();
  const hostEnd = lower.includes('/') ? lower.indexOf('/') : lower.length;
  const host = lower.slice(0, hostEnd);
  let at = 0;
  for (const label of host.split('.')) {
    if (label.startsWith(token)) return [[at, at + token.length]];
    at += label.length + 1;
  }
  const inHost = host.indexOf(token);
  if (inHost >= 0) return [[inHost, inHost + token.length]];
  const inPath = lower.indexOf(token, hostEnd);
  return inPath >= 0 ? [[inPath, inPath + token.length]] : null;
}

function merge(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/**
 * Ranges to highlight in the displayed title and URL. Tries the query as typed and in the other keyboard
 * layout, and keeps the spelling that explains the most words of the query.
 */
export function highlight(title: string, url: string, query: string): { title: Range[]; url: Range[] } {
  let best = { title: [] as Range[], url: [] as Range[], found: 0 };
  const titleSearched = !isUrlTitle(title);
  for (const variant of layoutVariants(query)) {
    const current = { title: [] as Range[], url: [] as Range[], found: 0 };
    for (const token of tokenize(variant)) {
      const t = titleSearched ? inTitle(title, token) : null;
      const u = t ? null : inUrl(url, token);
      if (t) current.title.push(...t);
      if (u) current.url.push(...u);
      if (t || u) current.found++;
    }
    if (current.found > best.found) best = current;
  }
  return { title: merge(best.title), url: merge(best.url) };
}
