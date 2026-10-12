// PROTOTYPE: the search panel drawn inside the page (closed shadow DOM), injected by the background
// worker on click / shortcut. Measures whether it appears faster than the action popup.
import { describe, resolveAction } from './actions';
import type { LoadResponse, OverlayRequest } from './background';
import { prepare, search, type Prepared } from './search';
import type { Context, Item, Modifiers } from './types';

declare global {
  // Survives re-injection: the content script world is shared by every injection into this page.
  var __summonOverlay: { toggle(): void } | undefined;
}

const STYLE = `
:host { all: initial; }
.backdrop { position: fixed; inset: 0; z-index: 2147483647; background: rgb(0 0 0 / 0.08);
  font: 13px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; -webkit-font-smoothing: antialiased;
  --fg: #1d1d1f; --muted: #5f5f69; --line: rgb(0 0 0 / 0.08); --accent: #0a7aff;
  --glass: rgb(246 246 248 / 0.72); --edge: rgb(255 255 255 / 0.6);
  --sel: rgb(255 255 255 / 0.85); --sel-ring: rgb(10 122 255 / 0.5); --badge: rgb(255 255 255 / 0.75); --open: #1f7a37; }
@media (prefers-color-scheme: dark) {
  .backdrop { --fg: #f5f5f7; --muted: #a9a9b4; --line: rgb(255 255 255 / 0.08); --accent: #0a84ff;
    --glass: rgb(32 32 36 / 0.68); --edge: rgb(255 255 255 / 0.12);
    --sel: rgb(255 255 255 / 0.14); --sel-ring: rgb(10 132 255 / 0.7); --badge: rgb(255 255 255 / 0.12); --open: #30d158; }
}
.panel { position: absolute; top: 18vh; left: 50%; transform: translateX(-50%); width: min(640px, calc(100vw - 32px));
  color: var(--fg); background: var(--glass); backdrop-filter: blur(30px) saturate(180%);
  border-radius: 16px; box-shadow: 0 0 0 0.5px var(--edge) inset, 0 24px 80px rgb(0 0 0 / 0.28), 0 0 0 0.5px rgb(0 0 0 / 0.2);
  overflow: hidden; }
.search { display: flex; align-items: center; gap: 12px; padding: 15px 20px 13px; border-bottom: 1px solid var(--line); }
.search svg { width: 22px; height: 22px; fill: none; stroke: var(--muted); stroke-width: 2; stroke-linecap: round; flex: none; }
input { all: unset; flex: 1; min-width: 0; font-size: 23px; letter-spacing: -0.015em; color: var(--fg); caret-color: var(--accent); }
input::placeholder { color: var(--muted); }
ul { list-style: none; margin: 0; padding: 6px 8px; max-height: 460px; overflow-y: auto; }
ul:empty { display: none; }
li { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 6px 10px; border-radius: 10px; cursor: default; }
li[aria-selected="true"] { background: var(--sel); box-shadow: inset 0 0 0 1px var(--sel-ring); }
li[aria-selected="true"]::after { content: "↵"; color: var(--accent); font-size: 15px; font-weight: 600; }
.tile { width: 30px; height: 30px; flex: none; display: grid; place-items: center; border-radius: 8px; color: #fff;
  font-size: 15px; font-weight: 600; background: linear-gradient(180deg, hsl(var(--hue) 62% 58%), hsl(var(--hue) 58% 46%)); }
.text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.title, .url { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.title { font-size: 14px; font-weight: 500; }
.url { font-size: 12px; color: var(--muted); }
.badge { flex: none; padding: 2px 8px; border-radius: 999px; background: var(--badge); color: var(--muted); font-size: 11px; font-weight: 500; }
.badge.open { color: var(--open); }
.status { margin: 0; padding: 18px 20px; color: var(--muted); text-align: center; }
.status:empty { display: none; }
.hints { display: flex; gap: 16px; padding: 8px 20px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11.5px; }
kbd { font: inherit; font-weight: 500; padding: 0 5px; margin-right: 3px; border-radius: 5px; background: var(--badge); color: var(--fg); }
`;

const MARKUP = `
<div class="backdrop">
  <div class="panel" role="dialog" aria-label="Summon">
    <div class="search">
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>
      <input type="text" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false"
             aria-controls="results" aria-label="Search tabs and bookmarks" placeholder="Search tabs and bookmarks">
    </div>
    <ul id="results" role="listbox" aria-label="Results"></ul>
    <p class="status" role="status" aria-live="polite"></p>
    <footer class="hints" aria-hidden="true"></footer>
  </div>
</div>`;

async function send<T>(request: OverlayRequest): Promise<T> {
  const response = await chrome.runtime.sendMessage(request);
  if (!response?.ok) throw new Error(response?.error ?? 'No response from Summon');
  return response.result as T;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!u.host) return url;
    const path = decodeURI(u.pathname + u.search + u.hash);
    return u.hostname.replace(/^www\./, '') + (path === '/' ? '' : path);
  } catch {
    return url;
  }
}

function tileOf(item: Item): { letter: string; hue: number } {
  let host = '';
  try {
    host = new URL(item.url).hostname.replace(/^www\./, '');
  } catch {
    // Unparseable URL: fall back to the title.
  }
  const source = host || item.titles[0]!;
  let hue = 0;
  for (const char of source) hue = (hue * 31 + char.charCodeAt(0)) % 360;
  return { letter: (source.match(/[\p{L}\p{N}]/u)?.[0] ?? '•').toUpperCase(), hue };
}

function createOverlay(): { toggle(): void } {
  let host: HTMLElement | null = null;
  let previousFocus: Element | null = null;

  function close(): void {
    host?.remove();
    host = null;
    if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
  }

  function open(): void {
    previousFocus = document.activeElement;
    host = document.createElement('summon-overlay');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${STYLE}</style>${MARKUP}`;
    document.documentElement.append(host);

    const backdrop = root.querySelector<HTMLElement>('.backdrop')!;
    const input = root.querySelector('input')!;
    const list = root.querySelector('ul')!;
    const status = root.querySelector<HTMLElement>('.status')!;
    const hints = root.querySelector<HTMLElement>('.hints')!;
    input.focus();

    let ctx: Context = {};
    let prepared: Prepared[] = [];
    let results: Item[] = [];
    let selected = 0;
    let ready = false;

    function renderHints(): void {
      const d = describe(results[selected], ctx);
      const parts = d ? [`<kbd>↵</kbd> ${d.enter}`] : [];
      if (d?.altEnter) parts.push(`<kbd>⌥↵</kbd> ${d.altEnter}`);
      if (d?.shiftEnter) parts.push(`<kbd>⇧↵</kbd> ${d.shiftEnter}`);
      parts.push('<kbd>esc</kbd> Close');
      hints.innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
    }

    function select(index: number): void {
      if (!results.length) return;
      selected = (index + results.length) % results.length;
      list.querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', String(i === selected)));
      input.setAttribute('aria-activedescendant', `option-${selected}`);
      list.children[selected]?.scrollIntoView({ block: 'nearest' });
      renderHints();
    }

    function update(): void {
      if (!ready) return;
      results = search(prepared, input.value, ctx);
      list.replaceChildren(
        ...results.map((item, i) => {
          const li = document.createElement('li');
          li.id = `option-${i}`;
          li.setAttribute('role', 'option');
          const { letter, hue } = tileOf(item);
          const tile = Object.assign(document.createElement('span'), { className: 'tile', textContent: letter });
          tile.style.setProperty('--hue', String(hue));
          const text = Object.assign(document.createElement('span'), { className: 'text' });
          text.append(
            Object.assign(document.createElement('span'), { className: 'title', textContent: item.titles[0] }),
            Object.assign(document.createElement('span'), { className: 'url', textContent: shortUrl(item.url) }),
          );
          const open = item.kind === 'bookmark' && (item.tabs.length || item.similarTabs.length);
          const label = item.kind === 'tab' ? 'Tab' : item.tabs.length ? 'Open' : open ? 'Similar open' : 'Bookmark';
          const badge = Object.assign(document.createElement('span'), {
            className: label.includes('Open') || label.includes('open') ? 'badge open' : 'badge',
            textContent: label,
          });
          li.append(tile, text, badge);
          li.addEventListener('mousemove', () => i !== selected && select(i));
          li.addEventListener('click', (e) => run({ shift: e.shiftKey, alt: e.altKey }));
          return li;
        }),
      );
      input.setAttribute('aria-expanded', String(results.length > 0));
      if (results.length) {
        status.textContent = '';
        select(0);
      } else {
        status.textContent = input.value.trim() ? `No matches for “${input.value.trim()}”` : 'Type to search tabs and bookmarks';
        renderHints();
      }
    }

    function run(mods: Modifiers): void {
      const action = resolveAction(results[selected], mods, ctx);
      if (!action) return;
      close();
      if (action.type !== 'none') send({ type: 'execute', action }).catch((e) => console.error('[Summon]', e));
    }

    // Keys typed into the panel must not reach the page's own shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress'] as const) {
      input.addEventListener(type, (e) => e.stopPropagation());
    }
    input.addEventListener('input', update);
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        select(selected + (e.key === 'ArrowDown' ? 1 : -1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        run({ shift: e.shiftKey, alt: e.altKey });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) close();
    });

    send<LoadResponse>({ type: 'load' }).then(
      (data) => {
        ctx = data.ctx;
        prepared = data.items.map(prepare);
        ready = true;
        update();
        console.debug(`[Summon] panel ready ${Date.now() - data.invokedAt} ms after the click/shortcut`);
      },
      (error: unknown) => {
        status.textContent = `Couldn’t read tabs or bookmarks: ${error instanceof Error ? error.message : String(error)}`;
      },
    );
  }

  return {
    toggle() {
      if (host) close();
      else open();
    },
  };
}

(globalThis.__summonOverlay ??= createOverlay()).toggle();
