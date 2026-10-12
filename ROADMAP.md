# Roadmap

Ordered by value for the core flow (shortcut → a few letters → Enter). Top-down.

## Next — tune to real use

1. **Remember choices per query.** If `ad` led to AppDev2 three times, it ranks first for `ad`. Learns from use
   instead of hand-tuned weights. Also per bookmark: once ⌥↵ (switch to a similar tab) is the usual choice for a
   bookmark, plain Enter does the same. Needs `storage` (no install warning); data stays local.
   Storage groundwork, part of this item — the learned data must survive updates:
   - Keep it in `chrome.storage.local`: cleared only when the extension is removed (`storage.session` is cleared on
     every reload). Add an E2E test: write, reload the extension, read back.
   - Pin the extension ID with `key` in the manifest. An unpacked extension's ID comes from its folder path, so moving
     or re-cloning the project would otherwise start with empty storage.
   - Version the stored format (`{ version: 1, … }`) and migrate on read.
   - Export / import as a JSON file, a safety net against an accidental Remove; without a settings page, e.g. a
     command typed into the search field.
   - Not `storage.sync`: ~100 KB quota, and the data would leave the machine.
2. **Wrong keyboard layout.** Also search the query converted between Russian ЙЦУКЕН and QWERTY (`фв1` → `ad1`).
   Cheap, no new permissions.
3. **Highlight matched characters** in titles and URLs — shows why a result is there and makes ranking easier to debug.

## Then — more capability

4. **New tab page.** The New Tab page is one of the places where the overlay can't run (it falls back to the slow
   popup). `chrome_url_overrides.newtab` with the search field centered over a bundled wallpaper, plus local-only
   extras: recent tabs, frequent picks (needs 1), stale tabs to close in one go, clock. Start with a **focus prototype**: Chrome gives new tabs' focus to the address
   bar, so check manually whether ⌘T → typing can reach our field (e.g. the page re-navigating itself via
   `chrome.tabs.update`). If it can't without a click, reconsider the item and lean on 5.
   Behavior differs from the popup: the current tab is the Summon page itself, so Enter on a bookmark opens it in place,
   and switching to another tab closes the empty Summon tab. Trade-offs: replaces Chrome's own new tab (tiles,
   "Customize Chrome"), can't be toggled without a settings page — or ship it as a separate small extension from the
   same code. Not available in incognito.
5. **Address bar search** via `chrome.omnibox`: type `s`, Tab, then the query; suggestions come from tabs and
   bookmarks. Focus is already in the address bar after ⌘T, no install warning. Plainer UI (suggestion rows only).
6. **Real favicons** via the `favicon` permission. Icons come from Chrome's local cache, no network requests.
   Cost: install warning "Read the icons of the websites you visit". Sites are recognized faster by icon than by letter.
7. **Tab actions from results:** close a tab (⌘⌫), move it to the current window, copy its URL (⌘C).
8. **More modifiers:** ⌘↵ opens in the background, ⇧⌘↵ opens in a new window (⌥↵ is taken by "switch to a similar tab").
9. **History search** as a separate section below tabs and bookmarks when there are few matches. Needs `history`
   (same "Read your browsing history" warning that `tabs` already shows).

## Later — when needed

10. **Tab group names in search** — "work" finds every tab in the Work group.
11. **Performance check** on 5–10k bookmarks: an E2E test with timing; add a cache in the background worker only if slow.
12. **CI:** GitHub Actions running unit and E2E tests, plus a zip build for installing. Groundwork for the Chrome Web Store.
