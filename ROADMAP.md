# Roadmap

Ordered by value for the core flow (shortcut → a few letters → Enter). Top-down.

## Next — more capability

1. **Tab actions from results:** close a tab (⌘⌫), move it to the current window, copy its URL (⌘C).
2. **More modifiers:** ⌘↵ opens in the background, ⇧⌘↵ opens in a new window (⌥↵ is taken by "switch to a similar tab").
3. **History search** as a separate section below tabs and bookmarks when there are few matches. Needs `history`
   (same "Read your browsing history" warning that `tabs` already shows).

## Later — when needed

4. **Tab group names in search** — "work" finds every tab in the Work group.
5. **Performance check** on 5–10k bookmarks: an E2E test with timing; add a cache in the background worker only if slow.
6. **Turn the new tab page off** — it replaces Chrome's own new tab (tiles, "Customize Chrome"): a settings page, or
   a separate small extension from the same code.
7. **CI:** GitHub Actions running unit and E2E tests, plus a zip build for installing. Groundwork for the Chrome Web Store.

## Doubtful — low priority

8. **Address bar search** via `chrome.omnibox`: keyword (`s`), space, then the query; suggestions from tabs and
   bookmarks, no install warning. Lost most of its point once ⌘T opens the focused new tab page; what's left is a fast
   path on restricted pages (chrome://, Web Store, PDF), where the popup is slow. Chrome's own `@tabs` / `@bookmarks`
   cover the basics. Notes if it comes back: ~5 rows, text only (`<match>`, `<url>`, `<dim>`); no modifiers, only
   `disposition` (Enter = current tab, ⌥Enter = new tab), so ⌥↵ "similar" works only via the learned habit; a letter
   keyword doesn't trigger in the Russian layout.
