# Summon

Keyboard search across open tabs and bookmarks for Chrome. One shortcut, a few letters, Enter.

## Keys

| Key | Tab result | Bookmark result |
|---|---|---|
| Enter | Switch to the tab (and its window) | Switch to it if the bookmark is open, otherwise open in a new tab |
| Shift+Enter | Switch to the tab | Open in the current tab |
| Option+Enter | Switch to the tab | Switch to a *similar* open tab — the same site under the bookmark's path, other parameters |
| ↑ / ↓ | Move selection | |
| `>` | Commands: export / import what Summon has learned | |
| Esc | Close | |

An empty query lists recently used tabs, so shortcut → Enter jumps back to the previous tab.

**New tab page.** Summon also replaces Chrome's New Tab page with the same search, focused, so ⌘T → a few letters →
Enter works too. There the new tab itself is the "current tab": Enter on a bookmark opens it in that tab, switching to
another tab closes the empty one (⌘T → Enter = back to the previous tab), Esc clears the field.

Around the search on the new tab page:
- **Frequent picks** as chips under the field — the results you pick most often across all searches (from what
  Summon has learned, below). **Option+1…6** opens one without typing; the chips step aside while you search.
- **Clock** and date.
- **Tabs untouched for a week** (not pinned, not playing sound): "N tabs untouched for a week · Review" at the bottom
  opens the list, everything checked; close the checked ones in one go, then **Undo** for 10 seconds reopens them
  (as fresh tabs: their back/forward history is gone).

A bookmark is **open** in a tab with the same origin and path where every query parameter of the bookmark is present
with the same value (extra parameters are fine) and, if the bookmark has a hash, the same hash. So a translator bookmark
with `sl=ru&tl=en` is open in a tab that also has `text=…`, but not in one translating the other way.
A tab of the same origin at or below the bookmark's path with other parameters is **similar** ("Similar open"):
handy for apps that keep their state in the URL — Option+Enter jumps into the running app instead of opening it again.

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

### Updating

```sh
git pull && npm run build
```

Then press ↻ on the extension card. Avoid **Remove** + Load unpacked and moving the project folder: both make Chrome
treat it as a new extension, and anything Summon stores locally is lost. A changed `suggested_key` only applies on
first install — set the shortcut by hand at `chrome://extensions/shortcuts` instead of reinstalling.

The extension ID is pinned by `key` in the manifest, so it doesn't depend on the folder. If the `key` ever changes
(or you update from a build before it was added), ↻ is not enough: Chrome keeps a hidden record under the old ID for
the same folder, and at the next start the two clash and Summon disappears. Remove it, then Load unpacked again. If it
still vanishes after a restart, the hidden record is there: build without `key`, Load unpacked (it takes the old ID),
Remove it, then build normally and Load unpacked.

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

- [ ] On a regular page the shortcut shows the panel at once, centered, with focus in the field — also when the
      address bar had focus.
- [ ] On `chrome://settings`, the Chrome Web Store and a PDF the popup opens instead.
- [ ] On the new tab page Option+1 opens the first frequent chip (not typing "¡" into the field).
- [ ] ⌘T shows Summon's new tab with focus in the field (typing right away goes into the field, not the address bar);
      a new window (⌘N) too.
- [ ] Typing in the panel doesn't trigger the site's own shortcuts (GitHub, Google Docs, Jira).
- [ ] The shortcut can be changed at `chrome://extensions/shortcuts`.
- [ ] Clicking outside the panel closes it.
- [ ] Enter on a tab in another window brings that window to the front.
- [ ] With the icon unpinned, the shortcut still opens the panel.
- [ ] VoiceOver reads the selected result while moving with arrows.

## Permissions

- `tabs` — read titles and URLs of open tabs. Chrome shows "Read your browsing history" at install.
- `bookmarks` — read bookmarks. Chrome shows "Read and change your bookmarks"; Summon never changes them.
- `activeTab` + `scripting` — draw the panel inside the current page, only when you invoke Summon. No install warning.
- `storage` — remember your picks (below), on this computer only. No install warning.

No host permissions or network requests. Tabs and bookmarks are read fresh each time the panel opens.

## How the panel opens

On regular pages the panel is drawn **inside the page**, over it, so it appears at once — the toolbar popup needs a
new browser process each time and can take about a second. It lives in a closed shadow root, out of reach of the
page's scripts and styles; the page shows through it blurred. Where extensions can't run scripts (`chrome://` pages,
the Chrome Web Store, PDFs) the same panel opens as the toolbar popup instead.

Chrome always gives a new tab's focus to the address bar, also when an extension provides the page. A tab an extension
creates itself gets page focus, so when a New Tab opens, Summon's background worker opens its page in a fresh tab at
the same place and closes the original. The address bar then shows Summon's page address instead of staying empty.

## What Summon learns

Summon remembers which result you pick for a search. A result you picked at least twice for the same search — and
clearly more often than anything else — comes first, marked with ✦; other past picks get a boost, and a longer search
you used (`ad1`) helps its beginning (`ad`). Picks fade over a few weeks, so a new habit soon wins over an old one.
Learning only reorders results that match; it never shows something that doesn't.

For a bookmark of an app that is open in a *similar* tab, pressing Option+Enter twice in a row makes plain Enter switch
to that tab from then on (Option+Enter then opens the bookmark anew); two opposite choices switch it back.
The hint line always says what each key will do.

The data stays in Chrome's local extension storage on this computer. It survives updates and moving the project
folder (the extension ID is pinned in the manifest) and is deleted when the extension is removed — type `>` and use
**Export Summon data** for a backup and **Import Summon data** to merge one back (fresher records win, nothing is
removed). Import needs a regular web page: in the toolbar popup the file picker would close the popup.

## How search works

Each word of the query must match the title, the domain or the URL path (case-insensitive). Stronger matches rank higher:
whole word or domain label > all initials > start of title/domain > word starts from the first word > start of a word >
word starts with skipped words > substring within a word > URL path. Open tabs win ties, then recently used ones.

Titles split into words at spaces, punctuation, camel case and digits (`AppDev1` → app, dev, 1; a plural acronym
like `PRs` stays whole), so camel-cased bookmark names work as abbreviations, like CamelHumps in JetBrains IDEs:

| Query | Finds | How |
|---|---|---|
| `kd`, `ad1` | KitDev, AppDev1 | all initials |
| `apd1`, `gtrans` | AppDev1, GoogleTranslate… | several letters per word, from the first word |
| `ad` | AppDev1, AppDev2, then AppInfraDeploy | words may be skipped, ranked lower |

Matched characters are highlighted in the title or the URL — for an abbreviation, the letters it was made of
(`ad1` → **A**pp**D**ev**1**).

Typed with the wrong keyboard layout? Summon reads the query in the other layout too (Russian ЙЦУКЕН ↔ QWERTY):
`фв1` finds what `ad1` finds, `rjn` finds «кот». A match as typed ranks a little above the same match after switching.

Initials need the name in the title — a domain alone (`github.com`) has no word boundaries, and arbitrary
abbreviations (`fb` → Meta) are not supported.
