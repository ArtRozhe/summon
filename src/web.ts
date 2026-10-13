// Rows for leaving Summon's own results: go to what was typed if it reads as an address, or search the web for it
// (the user's default search engine, via chrome.search). Pure logic.
import type { Item } from './types';

/** Common top-level domains: "word.com" goes to the site first, "next.js" still searches first. */
const LIKELY_TLDS = new Set(
  'com org net io dev app co ai me info biz edu gov ru uk de fr nl es it pl ua by kz eu us ca au jp cn in br ch se no fi dk cz at be tv xyz site online tech cloud page'.split(
    ' ',
  ),
);

export interface Address {
  url: string;
  /** Typed with a scheme, path, `www.` or a common TLD: offered before searching. */
  likely: boolean;
}

/** The query as an address to open, if it reads as one: a URL with a scheme, a domain, localhost or an IPv4 address. */
export function asAddress(query: string): Address | undefined {
  const q = query.trim();
  if (!q || /\s/.test(q)) return undefined;
  if (/^https?:\/\//i.test(q)) {
    try {
      return { url: new URL(q).href, likely: true };
    } catch {
      return undefined;
    }
  }
  const m = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|(?:[a-z0-9-]+\.)+([a-z]{2,}))(:\d{1,5})?([/?#].*)?$/i.exec(q);
  if (!m) return undefined;
  const [, host, tld, , rest] = m;
  const local = host === 'localhost' || !tld;
  try {
    const url = new URL(`${local ? 'http' : 'https'}://${q}`).href;
    return { url, likely: local || !!rest || /^www\./i.test(q) || LIKELY_TLDS.has(tld!.toLowerCase()) };
  } catch {
    return undefined;
  }
}

/** "Go to …" and "Search for …" rows for a typed query, in the order they are offered. */
export function webItems(query: string): Item[] {
  const text = query.trim();
  if (!text) return [];
  const search: Item = { id: 'web-search', kind: 'search', titles: [`Search for “${text}”`], url: '', tabs: [], similarTabs: [], text };
  const address = asAddress(text);
  if (!address) return [search];
  const display = address.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const go: Item = { id: 'web-go', kind: 'url', titles: [`Go to ${display}`], url: address.url, tabs: [], similarTabs: [] };
  return address.likely ? [go, search] : [search, go];
}
