# Roadmap

Ordered by value for the core flow (shortcut → a few letters → Enter). Top-down.

## Next — more capability

1. **New tab page** — done on branch `newtab`: focused search on ⌘T via the worker's tab swap, blank-tab behavior,
   frequent chips (⌥1…⌥6), clock, tabs untouched for a week. Left: a way to turn the page off (it replaces Chrome's own
   new tab: tiles, "Customize Chrome") — a settings page, or a separate small extension from the same code. Not
   available in incognito.
2. **Address bar search** via `chrome.omnibox`: type `s`, Tab, then the query; suggestions come from tabs and
   bookmarks. Focus is already in the address bar after ⌘T, no install warning. Plainer UI (suggestion rows only).
3. **Real favicons** via the `favicon` permission. Icons come from Chrome's local cache, no network requests.
   Cost: install warning "Read the icons of the websites you visit". Sites are recognized faster by icon than by letter.
4. **Tab actions from results:** close a tab (⌘⌫), move it to the current window, copy its URL (⌘C).
5. **More modifiers:** ⌘↵ opens in the background, ⇧⌘↵ opens in a new window (⌥↵ is taken by "switch to a similar tab").
6. **History search** as a separate section below tabs and bookmarks when there are few matches. Needs `history`
   (same "Read your browsing history" warning that `tabs` already shows).

## Later — when needed

7. **Tab group names in search** — "work" finds every tab in the Work group.
8. **Performance check** on 5–10k bookmarks: an E2E test with timing; add a cache in the background worker only if slow.
9. **CI:** GitHub Actions running unit and E2E tests, plus a zip build for installing. Groundwork for the Chrome Web Store.
