# Summon — project notes

Chrome MV3 extension: one shortcut → a few letters → Enter → the right tab or bookmark. Personal project.
User-facing docs, run instructions and the manual checklist are in `README.md`; this file records decisions and why.

## Architecture (decided, keep unless there is a reason)

- **Action popup opened by `_execute_action`**, not an in-page overlay or a separate window. It works on every page
  (`chrome://`, Web Store, PDF, NTP) without content scripts or host permissions, closes itself on focus loss, and
  needs no code to bind the shortcut. Cost: the panel is anchored to the toolbar icon, not centered.
- **No service worker, no cache.** The popup reads `tabs.query({})` + `bookmarks.getTree()` fresh on every open, so
  there is no invalidation and no SW lifecycle to manage. Add a SW only if loading becomes measurably slow.
- **Permissions: `tabs`, `bookmarks` only.** No `favicon` (extra install warning, and favicon URLs would mean network
  requests) — site tiles with the domain's first letter instead.
- **Actions dispatch all `chrome.*` calls before the first await** (`src/actions.ts`): the popup dies as soon as
  another tab/window gets focus. Verified by E2E (other-window activation works). If it ever flakes, move
  `execute` into a stateless SW via `runtime.sendMessage`.
- `minimum_chrome_version: 121` because of `Tab.lastAccessed`.
- Summon's own extension pages are filtered out of results.

## Behavior decisions

- A bookmark whose URL is open is **one merged row** (`kind: 'bookmark'`, badge "Open"): Enter switches to the tab,
  Shift+Enter loads the URL in the current tab. Tab rows: Enter and Shift+Enter both activate.
- Tab choice among duplicates: current tab → current window → most recently used.
- URL equality = `new URL(u).href` only; query and hash are significant.
- Empty query = recent tabs (all windows, minus current), so shortcut → Enter = previous tab.
- Bookmarklets (`javascript:`) are skipped.
- UI text is English (chosen by me, user did not object).

## Search (`src/search.ts`)

AND over tokens; per token the best of: whole word / host label 100 > title or host prefix 80 > word prefix 60 >
initials 50 > substring 30 > path/query/hash 10. +5 open tab, −10 current tab; ties → open, recency, shorter title.
Top 8. Initials come from title segments and camelCase words (`gh` → GitHub), not from domains.
Known trade-off: an exact word ("Using git rebase") beats a domain prefix (`github.com`) for `git` — lower
`exactWord` if that annoys in practice.

## Look

"Glass" style, approved by the user (`static/popup.css`). Popups can't see the page behind them, so the glass is drawn
over our own gradient; blobs are px-sized and anchored to the top corners so the panel looks the same at any height.
Selection = white plate + accent ring + accent ↵. Site tiles: first letter of the full hostname, hue from the hostname.
Width 640px. For visual changes, render options from the real popup (Puppeteer) and show them before applying.

## Testing

- `npm test` — Vitest unit tests on pure logic (`search`, `actions`, `data`).
- `npm run e2e` — Puppeteer + Chrome for Testing, headless, throwaway profile; opens the **real** popup via
  `page.triggerExtensionAction`. Screenshots go to `test-results/` — look at them after UI changes.
- Gotchas found:
  - Fixture hosts must be `*.test`: github.com etc. are HSTS-preloaded and get forced to https, while the local fixture
    server is http. Also pass `--disable-features=HttpsUpgrades`.
  - `page.setViewport` on the popup target crashes Puppeteer; for 2× renders use `--force-device-scale-factor=2`.
  - The browser shortcut cannot be pressed via CDP — shortcut, real focus and restricted pages stay manual.
- `popup.html?tab=&window=` overrides the current tab/window, for running the popup inside a normal tab
  (e.g. via Claude in Chrome on the user's own profile).

## Repo conventions

- Personal git identity is set in the repo's local config — don't change it. Commit only when asked.
- npm 11 install scripts allowed only for `esbuild` and `puppeteer` (`allowScripts` in `package.json`).
- No UI framework, no runtime dependencies; build = esbuild bundling `src/popup.ts` + copying `static/` to `dist/`.

## Roadmap

`ROADMAP.md` — order agreed with the user; take items top-down.

## Status (2026-10-12)

MVP done: unit 29/29, E2E 11/11. Pending: the user's manual checklist from README in real Chrome, then a run on the
user's personal profile via Claude in Chrome (ranking on real bookmarks).
