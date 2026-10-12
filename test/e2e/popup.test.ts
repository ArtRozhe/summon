import type { Page } from 'puppeteer';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type Harness,
  launch,
  openPopup,
  reset,
  RESULTS_DIR,
  seed,
  selectedTitle,
  settledState,
  state,
  titles,
  waitClosed,
} from './harness';

let h: Harness;

beforeAll(async () => {
  h = await launch();
});

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  await reset(h);
});

/** Presses a key that may close the popup; the press itself can then fail mid-way. */
async function press(popup: Page, key: 'Enter' | 'Escape', modifier?: 'Shift' | 'Alt'): Promise<void> {
  try {
    if (modifier) await popup.keyboard.down(modifier);
    await popup.keyboard.press(key);
    if (modifier) await popup.keyboard.up(modifier);
  } catch {
    // The popup closed during the key press.
  }
}

async function search(popup: Page, query: string): Promise<void> {
  await popup.keyboard.type(query);
  await popup.waitForFunction(
    (q) => (document.getElementById('query') as HTMLInputElement).value === q,
    {},
    query,
  );
}

const WORK = [
  { url: 'http://github.test/acme/summon/pulls', title: 'Pull requests · acme/summon · GitHub' },
  { url: 'http://docs.google.test/document/d/1', title: 'Roadmap Q4 - Google Docs' },
  { url: 'http://news.example.test/', title: 'Hacker News' },
];

describe('opening', () => {
  it('opens with focus in the search field and recent tabs listed', async () => {
    const [, second, third] = await seed(h, WORK);
    const popup = await openPopup(h, third!);
    expect(await popup.evaluate(() => document.activeElement?.id)).toBe('query');
    // Empty query: recent tabs without the current one, most recent first.
    expect(await titles(popup)).toEqual(['Roadmap Q4 - Google Docs', 'Pull requests · acme/summon · GitHub']);
    await popup.screenshot({ path: `${RESULTS_DIR}/empty-query.png` });

    // Shortcut → Enter goes back to the previous tab.
    await press(popup, 'Enter');
    await waitClosed(popup);
    expect((await state(h)).activeTabId).toBe(second);
  });

  it('closes on Escape without doing anything', async () => {
    const [tabId] = await seed(h, WORK);
    const before = await state(h);
    const popup = await openPopup(h, tabId!);
    await press(popup, 'Escape');
    await waitClosed(popup);
    expect(await state(h)).toEqual({ ...before, activeTabId: tabId, activeUrl: WORK[0]!.url });
  });
});

describe('search', () => {
  it('finds GitHub by "gh", including bookmarks in nested folders', async () => {
    const [tabId] = await seed(h, [{ url: 'http://news.example.test/', title: 'Hacker News' }, ...WORK.slice(0, 1)], [
      { title: 'GitHub', url: 'http://github.test/', folder: ['Work', 'Code'] },
      { title: 'Highlights', url: 'http://highlights.test/' },
    ]);
    const popup = await openPopup(h, tabId!);
    await search(popup, 'gh');
    expect(await titles(popup)).toEqual(['Pull requests · acme/summon · GitHub', 'GitHub', 'Highlights']);
    expect(await selectedTitle(popup)).toBe('Pull requests · acme/summon · GitHub');
    await popup.screenshot({ path: `${RESULTS_DIR}/search-gh.png` });
  });

  it('moves the selection with arrows while focus stays in the field', async () => {
    const [tabId] = await seed(h, [{ url: 'http://blank.test/', title: 'Blank' }], [
      { title: 'Docs one', url: 'http://docs.test/1' },
      { title: 'Docs two', url: 'http://docs.test/2' },
    ]);
    const popup = await openPopup(h, tabId!);
    await search(popup, 'docs');
    expect(await selectedTitle(popup)).toBe('Docs one');
    await popup.keyboard.press('ArrowDown');
    expect(await selectedTitle(popup)).toBe('Docs two');
    await popup.keyboard.press('ArrowDown');
    expect(await selectedTitle(popup)).toBe('Docs one');
    await popup.keyboard.press('ArrowUp');
    expect(await selectedTitle(popup)).toBe('Docs two');
    expect(await popup.evaluate(() => document.activeElement?.id)).toBe('query');
    expect(await popup.$eval('#query', (e) => e.getAttribute('aria-activedescendant'))).toBe('option-1');
  });

  it('shows "no matches" and ignores Enter on an empty list', async () => {
    const [tabId] = await seed(h, WORK);
    const before = await state(h);
    const popup = await openPopup(h, tabId!);
    await search(popup, 'zzzz');
    expect(await titles(popup)).toEqual([]);
    expect(await popup.$eval('#status', (e) => e.textContent)).toBe('No matches for “zzzz”');
    await press(popup, 'Enter');
    await new Promise((r) => setTimeout(r, 300));
    expect(popup.isClosed()).toBe(false);
    expect((await state(h)).tabCount).toBe(before.tabCount);
    await popup.screenshot({ path: `${RESULTS_DIR}/no-matches.png` });
  });
});

describe('actions', () => {
  it('Enter on a tab in another window activates it and focuses that window', async () => {
    const [here, there] = await seed(h, [
      { url: 'http://blank.test/', title: 'Blank', window: 1 },
      { url: 'http://linear.test/team/issues', title: 'Issues · Linear', window: 2 },
    ]);
    const popup = await openPopup(h, here!);
    await search(popup, 'linear');
    expect(await popup.$eval('#results [aria-selected="true"] .badges', (e) => e.textContent)).toContain('Other window');
    await press(popup, 'Enter');
    await waitClosed(popup);
    const s = await state(h);
    expect(s.activeTabId).toBe(there);
    expect(s.tabCount).toBe(2);
  });

  it('Enter on a closed bookmark opens it in a new active tab', async () => {
    const [here] = await seed(h, [{ url: 'http://blank.test/', title: 'Blank' }], [
      { title: 'Grafana', url: 'http://grafana.test/d/abc?from=now-1h' },
    ]);
    const popup = await openPopup(h, here!);
    await search(popup, 'graf');
    await press(popup, 'Enter');
    await waitClosed(popup);
    const s = await settledState(h, (s) => s.activeUrl === 'http://grafana.test/d/abc?from=now-1h');
    expect(s.activeTabId).not.toBe(here);
    expect(s.activeUrl).toBe('http://grafana.test/d/abc?from=now-1h');
    expect(s.tabCount).toBe(2);
  });

  it('Shift+Enter on a bookmark opens it in the current tab', async () => {
    const [here] = await seed(h, [{ url: 'http://blank.test/', title: 'Blank' }], [
      { title: 'Grafana', url: 'http://grafana.test/' },
    ]);
    const popup = await openPopup(h, here!);
    await search(popup, 'graf');
    await press(popup, 'Enter', 'Shift');
    await waitClosed(popup);
    const s = await settledState(h, (s) => s.activeUrl === 'http://grafana.test/');
    expect(s.activeTabId).toBe(here);
    expect(s.activeUrl).toBe('http://grafana.test/');
    expect(s.tabCount).toBe(1);
  });

  it('Enter on a bookmark that is already open switches to it instead of opening a duplicate', async () => {
    const [here, open] = await seed(
      h,
      [
        { url: 'http://blank.test/', title: 'Blank', window: 1 },
        { url: 'http://grafana.test/', title: 'Home - Grafana', window: 2 },
      ],
      [{ title: 'Grafana', url: 'http://grafana.test/' }],
    );
    const popup = await openPopup(h, here!);
    await search(popup, 'graf');
    // One merged row, marked as open, with both actions spelled out.
    expect(await titles(popup)).toEqual(['Grafana']);
    expect(await popup.$eval('#results .badges', (e) => e.textContent)).toContain('Open');
    expect(await popup.$eval('#hints', (e) => e.textContent)).toContain('Switch to tab');
    expect(await popup.$eval('#hints', (e) => e.textContent)).toContain('Open in this tab');
    await popup.screenshot({ path: `${RESULTS_DIR}/open-bookmark.png` });
    await press(popup, 'Enter');
    await waitClosed(popup);
    const s = await state(h);
    expect(s.activeTabId).toBe(open);
    expect(s.tabCount).toBe(2);
  });

  it('Enter switches to a tab where the bookmark is open with extra parameters', async () => {
    const [here, open] = await seed(
      h,
      [
        { url: 'http://blank.test/', title: 'Blank' },
        { url: 'http://translate.test/?sl=ru&tl=en&text=hello', title: 'Translate' },
        { url: 'http://translate.test/?sl=en&tl=ru', title: 'Translate' },
      ],
      [
        { title: 'TranslateRussianEnglish', url: 'http://translate.test/?sl=ru&tl=en' },
        { title: 'TranslateEnglishRussian', url: 'http://translate.test/?sl=en&tl=ru' },
      ],
    );
    const popup = await openPopup(h, here!);
    await search(popup, 'tre');
    expect(await selectedTitle(popup)).toBe('TranslateRussianEnglish');
    await press(popup, 'Enter');
    await waitClosed(popup);
    const s = await state(h);
    expect(s.activeTabId).toBe(open);
    expect(s.tabCount).toBe(3);
  });

  it('⌥↵ switches to a similar tab of the same app; Enter stays strict', async () => {
    const [here, app] = await seed(
      h,
      [
        { url: 'http://blank.test/', title: 'Blank' },
        { url: 'http://app.test/projects/7?company=b', title: 'Project 7 · App' },
      ],
      [{ title: 'AppProd', url: 'http://app.test/?company=a&date=2022-02-11' }],
    );
    const popup = await openPopup(h, here!);
    await search(popup, 'ap');
    expect(await selectedTitle(popup)).toBe('AppProd');
    expect(await popup.$eval('#results [aria-selected="true"] .badges', (e) => e.textContent)).toContain('Similar open');
    expect(await popup.$eval('#hints', (e) => e.textContent)).toContain('Switch to open tab');
    expect(await popup.$eval('#hints', (e) => e.textContent)).toContain('Open in new tab');
    await popup.screenshot({ path: `${RESULTS_DIR}/similar-open.png` });
    await press(popup, 'Enter', 'Alt');
    await waitClosed(popup);
    const s = await state(h);
    expect(s.activeTabId).toBe(app);
    expect(s.tabCount).toBe(2);
  });

  it('Shift+Enter on a tab still just activates it', async () => {
    const [here, other] = await seed(h, [
      { url: 'http://blank.test/', title: 'Blank' },
      { url: 'http://linear.test/', title: 'Linear' },
    ]);
    const popup = await openPopup(h, here!);
    await search(popup, 'linear');
    await press(popup, 'Enter', 'Shift');
    await waitClosed(popup);
    const s = await state(h);
    expect(s.activeTabId).toBe(other);
    expect(s.urls.sort()).toEqual(['http://blank.test/', 'http://linear.test/']);
  });
});

describe('looks', () => {
  const LONG = [
    {
      url: 'http://jira.test/browse/PROJ-1234?focusedCommentId=99887766&page=com.atlassian.jira.plugin.system.issuetabpanels',
      title: '[PROJ-1234] A very long issue title that keeps going to check how the row truncates without breaking the layout - Jira',
    },
    { url: 'http://wiki.test/spaces/ENG/pages/123/Onboarding', title: 'Onboarding guide for new engineers · Wiki' },
  ];

  it('renders long titles and dark mode', async () => {
    const [tabId] = await seed(h, [{ url: 'http://blank.test/', title: 'Blank' }, ...LONG], [
      { title: 'PROJ board', url: 'http://jira.test/secure/RapidBoard.jspa?rapidView=42' },
    ]);
    const popup = await openPopup(h, tabId!);
    await search(popup, 'j');
    await popup.screenshot({ path: `${RESULTS_DIR}/long-light.png` });
    const width = await popup.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(640);
    await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await popup.screenshot({ path: `${RESULTS_DIR}/long-dark.png` });
  });
});
