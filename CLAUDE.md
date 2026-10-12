# Summon — project notes

Chrome MV3 extension: one shortcut → a few letters → Enter → the right tab or bookmark. Personal project.
User-facing docs, run instructions and the manual checklist are in `README.md`; this file records decisions and why.

## Architecture (decided, keep unless there is a reason)

- **Two shells, one panel.** `src/ui/panel.ts` (+ `panel.css`) is the search panel: rows, keys, hints, states.
  - **Overlay** (`src/overlay.ts`, `ui/overlay.css`) — main shell. The icon click / `_execute_action` shortcut reach
    `action.onClicked` in the background worker (the action has no default popup), which injects `overlay.js` into the
    current tab with `activeTab` + `scripting`. Why: the action popup needs a new renderer process per opening and
    took ~1 s in the user's Chrome (other extensions' popups too); the overlay appears in 2–6 ms.
  - **Popup** (`src/popup.ts`, `ui/popup.css`) — fallback where scripts can't run (chrome://, Web Store, PDF, NTP):
    `executeScript` throws, the worker sets a per-tab popup, calls `action.openPopup()` (Chrome 127+), unsets it.
- **Overlay isolation:** closed shadow root in a custom element, made a `popover` (top layer: above any z-index and
  fullscreen). Host styles via CSSOM `setProperty(..., 'important')`, panel CSS via constructed stylesheets — both work
  under a strict page CSP (E2E covers it). Keys stop propagating at the panel, so site shortcuts don't fire.
  Closes on Esc, click outside, window blur, tab hidden, re-invocation (toggle via a global in the isolated world).
  No `performance.mark` in the overlay: the page would see it. Known limit: a page's own capture-phase key listener
  registered on window could still observe what is typed.
- **Glass:** overlay = real `backdrop-filter` over the page. Its entrance animation is scale-only: animating opacity
  switches the backdrop blur off until the animation ends (seen in E2E screenshots). Popup = our gradient (it can't
  see the page).
- **Background worker** is stateless: `load` (tabs + bookmarks → items, context from `sender.tab`) and `execute`
  messages from the overlay. The popup still reads data and executes itself.
- **No cache.** Tabs and bookmarks are read fresh on every opening. Add one only if loading becomes measurably slow.
- **Permissions: `tabs`, `bookmarks`, `activeTab`, `scripting`, `storage`.** No host permissions, no `favicon` (extra install
  warning) — site tiles with the domain's first letter instead.
- **Actions dispatch all `chrome.*` calls before the first await** (`src/actions.ts`); the overlay closes itself first.
- `minimum_chrome_version: 127` (`action.openPopup`; `Tab.lastAccessed` needs 121).
- Summon's own extension pages are filtered out of results.

## Behavior decisions

- A bookmark that is open is **one merged row** (`kind: 'bookmark'`, badge "Open"): Enter switches to the tab,
  Shift+Enter loads the URL in the current tab. Tab rows: Enter and Shift+Enter both activate.
- "Open" (`src/data.ts` `matchTab`): same origin + path, bookmark's query params ⊆ tab's, same hash if the bookmark
  has one. "Similar": same origin, tab path at/below the bookmark path (segment boundary), params differ — the tab
  keeps its own row, the bookmark shows "Similar open", **⌥↵** switches to it; plain Enter stays strict.
  Why: the user's bookmarks include apps with state in the query (environments: any state of that env should count)
  and a translator where params are the point (RU→EN ≠ EN→RU). No URL-only rule satisfies both, so the user picks
  with ⌥↵. Agreed next step: learn per bookmark when ⌥↵ is used (roadmap item 1). Origin alone is too coarse
  (all github.com / docs.google.com bookmarks would look open).
- Tab choice among duplicates: current tab → current window → most recently used.
- Duplicate bookmarks collapse by `new URL(u).href`.
- Empty query = recent tabs (all windows, minus current), so shortcut → Enter = previous tab.
- Bookmarklets (`javascript:`) are skipped.
- UI text is English (chosen by me, user did not object).

## Memory (`src/memory.ts`, `src/storage.ts`)

- `storage.local` key `memory`: `{ version: 1, picks: query → url → { n, weight, last }, similar: url → habit }`.
  Result identity = URL (`memoryKey`), tab ids don't survive restarts. Queries normalized (case, spaces).
- Weight decays (half-life 7 days, updated on write). **Pinned first** (✦ via CSS `::before`, not in the title text):
  ≥2 picks, weight ≥1.5, ≥2× the runner-up, exact query only. Others: bonus ≤30 exact, ≤10 from longer stored queries
  starting with this one. Learning only reorders matches. Limits: 500 queries × 5 results, 500 habits.
- ⌥↵ habit: last two outcomes equal → `preferSwitch` flips (Enter switches to a similar tab, ⌥↵ opens anew).
  Recorded only when the bookmark had similar tabs and no exact one, without Shift.
- **Single writer: the background worker** (`record`, `import` messages, serialized). The popup reads storage itself
  but sends picks to the worker. Unknown/broken stored data → empty, never a crash.
- Export/import: commands after `>` in the field (no settings page). Export = JSON download via a blob link (no
  `downloads` permission). Import merges (later `last` wins). Overlay keeps itself open while the file picker has
  focus (`holdOpen`); the popup refuses import (a file dialog closes the popup).
- Extension ID pinned by `key` in the manifest (public key only; the private key wasn't kept — not needed unpacked):
  `jkoklgjjpogkefkdfbfknllnjihelmfb`. Changing the ID under an installed unpacked extension (adding/changing `key`,
  then ↻) left a hidden record with the old ID for the same path (`disable_reasons [4]` in the profile's Secure
  Preferences); at every Chrome start the two clashed and Summon vanished. Remove in the UI doesn't touch it — fix:
  build without `key`, Load unpacked (takes the old ID), Remove, rebuild, Load unpacked. Never change `key` again.
  E2E reloads the extension by loading the folder again (`chrome.runtime.reload()`
  doesn't come back under Puppeteer) and checks the old context really died.

## Search (`src/search.ts`)

AND over tokens; per token the best of: whole word / host label 100 > exact initials 95 > title or host prefix 80 >
humps from the first word 70 > word prefix 60 > humps with skipped words 45 > substring within words 30 >
path/query/hash 10. +5 open tab, −10 current tab; ties → open, recency, shorter title. Top 8.
Humps = CamelHumps: the user names bookmarks in PascalCase on purpose (`KitDev`, `GoogleTranslateEnglishRussian`,
`AppDev1`) and types abbreviations (`kd`, `gter`, `ad1`, `apd1`). Words split at camel case and letter/digit
boundaries; plural acronyms (`PRs`) stay whole. Substrings across camel words (`td` in KitDev) don't count.
Hump sequences: whole title, each title segment, each camel word; a hump match needs ≥2 words.
Wrong layout (`src/layout.ts`): every query is also read in the other layout (Russian PC ЙЦУКЕН ↔ QWERTY, only
when it has letters of that script); each result takes its best score, −5 if only the converted spelling matched.
Memory is looked up for all spellings (`learnedForAny`); picks are recorded under the query as typed. Commands work
with a shifted Ю (= `>`); lowercase ю never turns a search into commands.
Search by folder names was considered and dropped: the user's folders are for order, names carry the abbreviations.
Known trade-off: an exact word ("Using git rebase") beats a domain prefix (`github.com`) for `git` — lower
`exactWord` if that annoys in practice.

## Look

"Glass" style, approved by the user (`static/popup.css`). Popups can't see the page behind them, so the glass is drawn
over our own gradient; blobs are px-sized and anchored to the top corners so the panel looks the same at any height.
Selection = white plate + lavender ring (same violet as ✦) + ↵ drawn as a small key (like the hint line).
✦ (usual pick) is a soft violet from the icon (`--spark`, lighter lavender in dark). System blue and the full icon
gradient were both too loud for small glyphs on dark glass (user's call). Site tiles: first letter of the full hostname, hue from the hostname.
Width 640px.
Match highlight (`src/highlight.ts`, `.hl`): "E" = faint violet wash + violet-leaning text. The user hesitated between
violet text only (best for whole words) and wash only (best for single abbreviation letters); E is on trial — if it
annoys, switch `.hl` in `panel.css` to one of those. For visual changes, render options from the real popup (Puppeteer) and show them before applying.

## Testing

- `npm test` — Vitest unit tests on pure logic (`search`, `actions`, `data`, `memory`, `layout`, `highlight`).
- `npm run e2e` — Puppeteer + Chrome for Testing, headless, throwaway profile. `openPanel` invokes Summon via
  `page.triggerExtensionAction` and returns a driver for whichever shell opened: the overlay is read through the
  page's extension realm (`page.extensionRealms()`, `__summonOverlay.root`), the popup through its target.
  Screenshots go to `test-results/` — look at them after UI changes (force `prefers-color-scheme`: headless follows
  the system theme).
- Gotchas found:
  - Fixture hosts must be `*.test`: github.com etc. are HSTS-preloaded and get forced to https, while the local fixture
    server is http. Also pass `--disable-features=HttpsUpgrades`.
  - `page.setViewport` on the popup target crashes Puppeteer; for 2× renders use `--force-device-scale-factor=2`.
  - The browser shortcut cannot be pressed via CDP — shortcut and real focus stay manual.
  - Right after install the worker may not be listening yet; the first click can be lost (scripts outside the harness).
- `popup.html?tab=&window=` overrides the current tab/window, for running the popup inside a normal tab
  (e.g. via Claude in Chrome on the user's own profile).

## Repo conventions

- Personal git identity is set in the repo's local config — don't change it. Commit only when asked.
- Workflow agreed for this project: once the user approves a change, commit and push together (logical commits,
  `Co-Authored-By: Claude`). Bigger features go on a branch and are fast-forwarded into `main` after the user
  has tried them in Chrome.
- Public repo: local hooks `.git/hooks/pre-commit` + `commit-msg` block words listed in `.git/info/blocked-words`
  (work names, personal paths). Never `--no-verify`; tests and docs use neutral examples (AppDev1, KitDev).
- npm 11 install scripts allowed only for `esbuild` and `puppeteer` (`allowScripts` in `package.json`).
- `local/` (gitignored) holds personal data such as the user's bookmark export — use it to check ranking on real
  bookmarks, never copy its contents into the repo (tests and docs use neutral examples).
- Icon: "Spark" (sparkle on the Glass gradient), picked by the user from rendered options. Sources in `assets/`
  (`icon-small.svg` for 16/32 px drops the second sparkle); `npm run icons` renders `static/icons/*.png`.
- No UI framework, no runtime dependencies; build = esbuild (`popup`, `background` as ESM, `overlay` as IIFE, CSS as
  text) + copying `static/` to `dist/`.

## Roadmap

`ROADMAP.md` — order agreed with the user; take items top-down.

## Status (2026-10-12)

Done: MVP, CamelHumps search, open/similar rule (⌥↵), in-page overlay with popup fallback, memory (usual picks ✦,
⌥↵ habit, export/import via `>`), wrong-layout search, match highlighting (style "E" on trial), Spark icon,
lavender accents. Unit 86/86, E2E 24/24, all pushed.
Pending: rest of the README manual checklist in real Chrome — shortcut with focus in the address bar, sites with
their own shortcuts (GitHub, Google Docs, Jira), restricted pages (chrome://settings, Web Store, PDF). What the user
used day to day works. Next on the roadmap: new tab page (starts with a focus prototype).
Claude in Chrome can't open chrome:// or extension pages, so it can't drive Summon itself.
