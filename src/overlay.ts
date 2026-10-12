// Main shell: the search panel drawn inside the current page, injected by the background worker
// on click / shortcut. The page's renderer is already running, so the panel appears at once
// (the action popup needs a new process and can take about a second in a busy Chrome).
import type { LoadResponse, OverlayRequest } from './background';
import overlayCss from './ui/overlay.css';
import panelCss from './ui/panel.css';
import { mountPanel, PANEL_MARKUP } from './ui/panel';

declare global {
  // Lives in the extension's isolated world, shared by every injection into this page; the page's
  // own scripts can't see it. `root` is there for E2E tests (the shadow root is closed).
  var __summonOverlay: { toggle(): void; readonly root: ShadowRoot | null } | undefined;
}

async function send<T>(request: OverlayRequest): Promise<T> {
  const response = await chrome.runtime.sendMessage(request);
  if (!response?.ok) throw new Error(response?.error ?? 'No response from Summon');
  return response.result as T;
}

/**
 * Inline `!important` styles, set through CSSOM (allowed under a strict style-src CSP, unlike a
 * style attribute), so the site's CSS can't move, hide or restyle the host element.
 */
const HOST_STYLE: Record<string, string> = {
  all: 'initial',
  position: 'fixed',
  inset: '0',
  width: '100vw',
  height: '100vh',
  'max-width': 'none',
  'max-height': 'none',
  margin: '0',
  padding: '0',
  border: '0',
  background: 'transparent',
  overflow: 'visible',
  display: 'block',
  'z-index': '2147483647',
};

function createOverlay(): NonNullable<typeof globalThis.__summonOverlay> {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(panelCss + overlayCss);

  let host: HTMLElement | null = null;
  let root: ShadowRoot | null = null;
  let previousFocus: Element | null = null;
  let stopListening = (): void => {};
  /** While the file picker is open the page loses focus; that must not close the panel. */
  let holdOpen = false;

  function close(): void {
    if (!host) return;
    stopListening();
    host.remove();
    host = null;
    root = null;
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
  }

  function open(): void {
    previousFocus = document.activeElement;
    host = document.createElement('summon-overlay');
    for (const [name, value] of Object.entries(HOST_STYLE)) host.style.setProperty(name, value, 'important');
    // A popover sits in the browser's top layer: above any z-index and above fullscreen elements.
    host.popover = 'manual';
    root = host.attachShadow({ mode: 'closed' });
    root.adoptedStyleSheets = [sheet];
    root.innerHTML = `<div class="backdrop"><div class="panel" role="dialog" aria-label="Summon">${PANEL_MARKUP}</div></div>`;
    document.documentElement.append(host);
    host.showPopover();

    const backdrop = root.querySelector<HTMLElement>('.backdrop')!;
    const panel = root.querySelector<HTMLElement>('.panel')!;

    // Keys typed into the panel must not reach the page's own shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress'] as const) {
      panel.addEventListener(type, (e) => e.stopPropagation());
    }
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) close();
    });
    // Like Spotlight: leaving the page (another window, the address bar, another tab) dismisses it.
    const onLeave = (): void => {
      if (!holdOpen) close();
    };
    const onVisibility = (): void => {
      if (document.hidden && !holdOpen) close();
    };
    window.addEventListener('blur', onLeave);
    window.addEventListener('pagehide', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    stopListening = () => {
      window.removeEventListener('blur', onLeave);
      window.removeEventListener('pagehide', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
    };

    const { input } = mountPanel(panel, {
      async load() {
        const data = await send<LoadResponse>({ type: 'load' });
        console.debug(`[Summon] panel ready ${Date.now() - data.invokedAt} ms after the click/shortcut`);
        return data;
      },
      remember(event) {
        send({ type: 'record', event }).catch((e: unknown) => console.error('[Summon]', e));
      },
      async perform(action) {
        // Close first: switching tabs hides this page anyway, and the panel must not linger.
        close();
        if (action.type !== 'none') await send({ type: 'execute', action });
      },
      apply: (action) => send({ type: 'execute', action }),
      close,
      icons: (urls) => send({ type: 'icons', urls }),
      importMemory: (memory) => send({ type: 'import', memory }),
      holdOpen: (hold) => {
        holdOpen = hold;
      },
    });
    input.focus({ preventScroll: true });
  }

  return {
    toggle: () => (host ? close() : open()),
    get root() {
      return root;
    },
  };
}

(globalThis.__summonOverlay ??= createOverlay()).toggle();
