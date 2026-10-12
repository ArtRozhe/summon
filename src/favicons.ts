// Site icons from Chrome's own favicon cache (`favicon` permission, no extra install warning next to `tabs`):
// no network requests. Runs in extension contexts only (worker, popup, new tab page); the overlay gets icons
// from the worker, so `_favicon/` is never exposed to web pages.

/** Page URL → icon as a data URL, or null when Chrome has none for it (the letter tile stays). */
export type IconMap = Record<string, string | null>;

const SIZE = 32;
/** Cached "no icon" answers are retried after this, in case the site has been visited since. */
const NONE_RETRY_MS = 5 * 60 * 1000;
const PREFIX = 'icon:';

/** In `storage.session`: memory only, cleared when the browser quits. */
interface Cached {
  icon: string | null;
  at: number;
}

async function fetchDataUrl(pageUrl: string): Promise<string> {
  const response = await fetch(chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${SIZE}`));
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${response.headers.get('content-type') || 'image/png'};base64,${btoa(binary)}`;
}

/** What Chrome returns for a page it has no icon for (a generic globe): compared against to detect "none". */
let fallbackIcon: Promise<string> | undefined;

async function fetchIcon(pageUrl: string): Promise<string | null> {
  if (!/^https?:/.test(pageUrl)) return null;
  fallbackIcon ??= fetchDataUrl('https://summon.invalid/');
  const [icon, fallback] = await Promise.all([fetchDataUrl(pageUrl), fallbackIcon]);
  return icon === fallback ? null : icon;
}

/** Icons already known this browser session, without fetching anything. */
export async function cachedIcons(urls: string[], now = Date.now()): Promise<IconMap> {
  if (!urls.length) return {};
  const stored = (await chrome.storage.session.get(urls.map((u) => PREFIX + u))) as Record<string, Cached>;
  const known: IconMap = {};
  for (const url of urls) {
    const entry = stored[PREFIX + url];
    if (entry && (entry.icon !== null || now - entry.at < NONE_RETRY_MS)) known[url] = entry.icon;
  }
  return known;
}

/** Icons for these pages: from the session cache, the rest read from Chrome and cached. */
export async function loadIcons(urls: string[]): Promise<IconMap> {
  const now = Date.now();
  const known = await cachedIcons(urls, now);
  const missing = urls.filter((u) => !(u in known));
  const fetched = await Promise.all(missing.map(async (u) => [u, await fetchIcon(u).catch(() => null)] as const));
  if (fetched.length) {
    await chrome.storage.session.set(Object.fromEntries(fetched.map(([u, icon]) => [PREFIX + u, { icon, at: now } satisfies Cached])));
  }
  return { ...known, ...Object.fromEntries(fetched) };
}
