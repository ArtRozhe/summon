# Summon

Keyboard search across open tabs and bookmarks for Chrome. One shortcut, a few letters, Enter.

## Keys

| Key | Tab result | Bookmark result |
|---|---|---|
| Enter | Switch to the tab (and its window) | Switch to it if the URL is already open, otherwise open in a new tab |
| Shift+Enter | Switch to the tab | Open in the current tab |
| ↑ / ↓ | Move selection | |
| Esc | Close | |

An empty query lists recently used tabs, so shortcut → Enter jumps back to the previous tab.

## Run locally

Requires Node 22+ and Chrome 121+.

```sh
npm install
npm run build        # or: npm run watch
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** → select the `dist/` folder.
3. Pin Summon in the toolbar (puzzle icon → pin), so the panel opens next to its icon.
4. Check the shortcut at `chrome://extensions/shortcuts`. Suggested: `⌘⇧Space` on macOS, `Ctrl+Shift+Space` elsewhere.
   If it is taken by another extension, Chrome leaves it unset — assign it there.

After rebuilding, press ↻ on the extension card. A changed `suggested_key` is only applied on first install:
remove and load the extension again, or set the shortcut by hand.

## Tests

```sh
npm test             # unit: search, ranking, actions, data merging
npm run e2e          # builds, then drives the real popup in Chrome for Testing (headless)
npm run typecheck
```

E2E runs in a throwaway profile with fixture pages served locally (`*.test` hosts mapped to a local server),
so it never touches the network or your own tabs. Screenshots land in `test-results/`.

The keyboard shortcut itself cannot be pressed from automation (it is handled by the browser, not the page),
so a few checks stay manual:

- [ ] The shortcut opens the panel with focus in the field on a regular page, `chrome://settings`,
      the Chrome Web Store, the New Tab page, a PDF.
- [ ] The shortcut can be changed at `chrome://extensions/shortcuts`.
- [ ] Clicking outside the panel closes it.
- [ ] Enter on a tab in another window brings that window to the front.
- [ ] With the icon unpinned, the shortcut still opens the panel.
- [ ] VoiceOver reads the selected result while moving with arrows.

## Permissions

- `tabs` — read titles and URLs of open tabs. Chrome shows "Read your browsing history" at install.
- `bookmarks` — read bookmarks. Chrome shows "Read and change your bookmarks"; Summon never changes them.

No host permissions, content scripts, background worker, network requests or storage. All data stays in the popup
and is read fresh each time it opens.

## How search works

Each word of the query must match the title, the domain or the URL path (case-insensitive). Stronger matches rank higher:
whole word or domain label > start of title/domain > start of a word > initials > substring > URL path.
Open tabs win ties, then recently used ones.

Initials come from multi-word and camel-cased titles: `gh` → GitHub, `gd` → Google Docs, `so` → Stack Overflow.
They need the name in the page title — a domain alone (`github.com`) has no word boundaries, and arbitrary
abbreviations (`fb` → Meta) are not supported.
