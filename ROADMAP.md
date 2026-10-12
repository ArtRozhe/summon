# Roadmap

Ordered by value for the core flow (shortcut → a few letters → Enter). Top-down.

## Next — tune to real use

1. **Remember choices per query.** If `gr` led to Grafana three times, Grafana ranks first for `gr`. Learns from use
   instead of hand-tuned weights. Needs `storage` (no install warning); data stays local.
2. **Wrong keyboard layout.** Also search the query converted between Russian ЙЦУКЕН and QWERTY (`пр` → `gh`).
   Cheap, no new permissions.
3. **Highlight matched characters** in titles and URLs — shows why a result is there and makes ranking easier to debug.

## Then — more capability

4. **Real favicons** via the `favicon` permission. Icons come from Chrome's local cache, no network requests.
   Cost: install warning "Read the icons of the websites you visit". Sites are recognized faster by icon than by letter.
5. **Tab actions from results:** close a tab (⌘⌫), move it to the current window, copy its URL (⌘C).
6. **More modifiers:** ⌘↵ opens in the background, ⌥↵ opens in a new window.
7. **History search** as a separate section below tabs and bookmarks when there are few matches. Needs `history`
   (same "Read your browsing history" warning that `tabs` already shows).

## Later — when needed

8. **Tab group names in search** — "work" finds every tab in the Work group.
9. **Performance check** on 5–10k bookmarks: an E2E test with timing; add a service worker cache only if slow.
10. **CI:** GitHub Actions running unit and E2E tests, plus a zip build for installing. Groundwork for the Chrome Web Store.
11. **Centered in-page overlay** on regular sites, falling back to the popup where pages are restricted. Closest to the
    Spotlight feel and the only way to real translucency, but it is a second UI implementation — last, and only if the
    toolbar-anchored panel turns out to be annoying.
