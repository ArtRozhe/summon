import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type Harness,
  launch,
  openPanel,
  type Panel,
  reset,
  RESULTS_DIR,
  seed,
  selectedTitle,
  settledState,
  state,
  text,
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

/** Presses a key that may close the panel (a popup press can then fail mid-way). */
async function press(panel: Panel, key: 'Enter' | 'Escape', modifier?: 'Shift' | 'Alt'): Promise<void> {
  try {
    if (modifier) await panel.page.keyboard.down(modifier);
    await panel.page.keyboard.press(key);
    if (modifier) await panel.page.keyboard.up(modifier);
  } catch {
    // The panel closed during the key press.
  }
}

async function search(panel: Panel, query: string): Promise<void> {
  await panel.page.keyboard.type(query);
  for (let i = 0; i < 50; i++) {
    if ((await panel.query((root) => (root.querySelector('.query') as HTMLInputElement).value)) === query) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Query never became "${query}"`);
}

function focusIsInField(panel: Panel): Promise<boolean> {
  return panel.query((root) => !!root.activeElement?.classList.contains('query'));
}

/** The overlay is part of the page, so a page screenshot shows it over the blurred content. */
function screenshot(panel: Panel, name: string): Promise<unknown> {
  return panel.page.screenshot({ path: `${RESULTS_DIR}/${name}.png` });
}

const WORK = [
  { url: 'http://github.test/acme/summon/pulls', title: 'Pull requests · acme/summon · GitHub' },
  { url: 'http://docs.google.test/document/d/1', title: 'Roadmap Q4 - Google Docs' },
  { url: 'http://news.example.test/', title: 'Hacker News' },
];

describe('opening', () => {
  it('opens with focus in the search field and recent tabs listed', async () => {
    const [, second, third] = await seed(h, WORK);
    const panel = await openPanel(h, third!);
    expect(await focusIsInField(panel)).toBe(true);
    // Empty query: recent tabs without the current one, most recent first.
    expect(await titles(panel)).toEqual(['Roadmap Q4 - Google Docs', 'Pull requests · acme/summon · GitHub']);
    await screenshot(panel, 'empty-query');

    // Shortcut → Enter goes back to the previous tab.
    await press(panel, 'Enter');
    await waitClosed(panel);
    expect((await state(h)).activeTabId).toBe(second);
  });

  it('closes on Escape without doing anything', async () => {
    const [tabId] = await seed(h, WORK);
    const before = await state(h);
    const panel = await openPanel(h, tabId!);
    await press(panel, 'Escape');
    await waitClosed(panel);
    expect(await state(h)).toEqual({ ...before, activeTabId: tabId, activeUrl: WORK[0]!.url });
  });
});

describe('search', () => {
  it('finds GitHub by "gh", including bookmarks in nested folders', async () => {
    const [tabId] = await seed(h, [{ url: 'http://news.example.test/', title: 'Hacker News' }, ...WORK.slice(0, 1)], [
      { title: 'GitHub', url: 'http://github.test/', folder: ['Work', 'Code'] },
      { title: 'Highlights', url: 'http://highlights.test/' },
    ]);
    const panel = await openPanel(h, tabId!);
    await search(panel, 'gh');
    expect(await titles(panel)).toEqual(['Pull requests · acme/summon · GitHub', 'GitHub', 'Highlights']);
    expect(await selectedTitle(panel)).toBe('Pull requests · acme/summon · GitHub');
    await screenshot(panel, 'search-gh');
  });

  it('moves the selection with arrows while focus stays in the field', async () => {
    const [tabId] = await seed(h, [{ url: 'http://blank.test/', title: 'Blank' }], [
      { title: 'Docs one', url: 'http://docs.test/1' },
      { title: 'Docs two', url: 'http://docs.test/2' },
    ]);
    const panel = await openPanel(h, tabId!);
    await search(panel, 'docs');
    expect(await selectedTitle(panel)).toBe('Docs one');
    await panel.page.keyboard.press('ArrowDown');
    expect(await selectedTitle(panel)).toBe('Docs two');
    await panel.page.keyboard.press('ArrowDown');
    expect(await selectedTitle(panel)).toBe('Docs one');
    await panel.page.keyboard.press('ArrowUp');
    expect(await selectedTitle(panel)).toBe('Docs two');
    expect(await focusIsInField(panel)).toBe(true);
    expect(await panel.query((root) => root.querySelector('.query')!.getAttribute('aria-activedescendant'))).toBe('summon-option-1');
  });

  it('shows "no matches" and ignores Enter on an empty list', async () => {
    const [tabId] = await seed(h, WORK);
    const before = await state(h);
    const panel = await openPanel(h, tabId!);
    await search(panel, 'zzzz');
    expect(await titles(panel)).toEqual([]);
    expect(await text(panel, '.status')).toBe('No matches for “zzzz”');
    await press(panel, 'Enter');
    await new Promise((r) => setTimeout(r, 300));
    expect(await panel.isOpen()).toBe(true);
    expect((await state(h)).tabCount).toBe(before.tabCount);
    await screenshot(panel, 'no-matches');
  });
});

describe('actions', () => {
  it('Enter on a tab in another window activates it and focuses that window', async () => {
    const [here, there] = await seed(h, [
      { url: 'http://blank.test/', title: 'Blank', window: 1 },
      { url: 'http://linear.test/team/issues', title: 'Issues · Linear', window: 2 },
    ]);
    const panel = await openPanel(h, here!);
    await search(panel, 'linear');
    expect(await text(panel, '.results [aria-selected="true"] .badges')).toContain('Other window');
    await press(panel, 'Enter');
    await waitClosed(panel);
    const s = await state(h);
    expect(s.activeTabId).toBe(there);
    expect(s.tabCount).toBe(2);
  });

  it('Enter on a closed bookmark opens it in a new active tab', async () => {
    const [here] = await seed(h, [{ url: 'http://blank.test/', title: 'Blank' }], [
      { title: 'Grafana', url: 'http://grafana.test/d/abc?from=now-1h' },
    ]);
    const panel = await openPanel(h, here!);
    await search(panel, 'graf');
    await press(panel, 'Enter');
    await waitClosed(panel);
    const s = await settledState(h, (s) => s.activeUrl === 'http://grafana.test/d/abc?from=now-1h');
    expect(s.activeTabId).not.toBe(here);
    expect(s.activeUrl).toBe('http://grafana.test/d/abc?from=now-1h');
    expect(s.tabCount).toBe(2);
  });

  it('Shift+Enter on a bookmark opens it in the current tab', async () => {
    const [here] = await seed(h, [{ url: 'http://blank.test/', title: 'Blank' }], [
      { title: 'Grafana', url: 'http://grafana.test/' },
    ]);
    const panel = await openPanel(h, here!);
    await search(panel, 'graf');
    await press(panel, 'Enter', 'Shift');
    await waitClosed(panel);
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
    const panel = await openPanel(h, here!);
    await search(panel, 'graf');
    // One merged row, marked as open, with both actions spelled out.
    expect(await titles(panel)).toEqual(['Grafana']);
    expect(await text(panel, '.results .badges')).toContain('Open');
    expect(await text(panel, '.hints')).toContain('Switch to tab');
    expect(await text(panel, '.hints')).toContain('Open in this tab');
    await screenshot(panel, 'open-bookmark');
    await press(panel, 'Enter');
    await waitClosed(panel);
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
    const panel = await openPanel(h, here!);
    await search(panel, 'tre');
    expect(await selectedTitle(panel)).toBe('TranslateRussianEnglish');
    await press(panel, 'Enter');
    await waitClosed(panel);
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
    const panel = await openPanel(h, here!);
    await search(panel, 'ap');
    expect(await selectedTitle(panel)).toBe('AppProd');
    expect(await text(panel, '.results [aria-selected="true"] .badges')).toContain('Similar open');
    expect(await text(panel, '.hints')).toContain('Switch to open tab');
    expect(await text(panel, '.hints')).toContain('Open in new tab');
    await screenshot(panel, 'similar-open');
    await press(panel, 'Enter', 'Alt');
    await waitClosed(panel);
    const s = await state(h);
    expect(s.activeTabId).toBe(app);
    expect(s.tabCount).toBe(2);
  });

  it('Shift+Enter on a tab still just activates it', async () => {
    const [here, other] = await seed(h, [
      { url: 'http://blank.test/', title: 'Blank' },
      { url: 'http://linear.test/', title: 'Linear' },
    ]);
    const panel = await openPanel(h, here!);
    await search(panel, 'linear');
    await press(panel, 'Enter', 'Shift');
    await waitClosed(panel);
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
    const panel = await openPanel(h, tabId!);
    await search(panel, 'j');
    await panel.page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await screenshot(panel, 'long-light');
    const width = await panel.query((root) => root.querySelector('.panel')!.getBoundingClientRect().width);
    expect(width).toBeLessThanOrEqual(680);
    await panel.page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await screenshot(panel, 'long-dark');
  });
});

describe('overlay in the page', () => {
  it('keeps typed keys away from the page’s own shortcuts', async () => {
    const [here] = await seed(h, [{ url: 'http://site.test/', title: 'Site' }]);
    const panel = await openPanel(h, here!);
    expect(panel.kind).toBe('overlay');
    await search(panel, 'abc');
    await panel.page.keyboard.press('ArrowDown');
    const pageKeys = () => panel.page.evaluate(() => (window as { __pageKeys?: number }).__pageKeys);
    expect(await pageKeys()).toBe(0);
    // Control: once the panel is closed, the page does get keys.
    await press(panel, 'Escape');
    await waitClosed(panel);
    await panel.page.keyboard.press('a');
    expect(await pageKeys()).toBe(1);
  });

  it('is styled under a strict Content-Security-Policy', async () => {
    const [here] = await seed(h, [{ url: 'http://site.test/csp', title: 'Strict site' }]);
    const panel = await openPanel(h, here!);
    // Control: the policy is in force — the page's own inline script was blocked.
    expect(await panel.page.evaluate(() => 'x' + typeof (window as { __pageKeys?: number }).__pageKeys)).toBe('xundefined');
    const look = await panel.query((root) => {
      const style = getComputedStyle(root.querySelector('.panel')!);
      return { radius: style.borderTopLeftRadius, blur: style.backdropFilter };
    });
    expect(look.radius).toBe('18px');
    expect(look.blur).toContain('blur');
  });

  it('closes when invoked again and when clicking outside', async () => {
    const [here] = await seed(h, [{ url: 'http://site.test/', title: 'Site' }]);
    const extension = (await h.browser.extensions()).get(h.extensionId)!;

    let panel = await openPanel(h, here!);
    await panel.page.triggerExtensionAction(extension);
    await waitClosed(panel);

    panel = await openPanel(h, here!);
    await panel.page.mouse.click(20, 20);
    await waitClosed(panel);
    // Focus goes back to the page and a fresh invocation works.
    panel = await openPanel(h, here!);
    expect(await focusIsInField(panel)).toBe(true);
  });

  it('shows the page through the glass', async () => {
    const [here] = await seed(h, WORK);
    const panel = await openPanel(h, here!);
    // Right away, during the entrance animation: the page must already be blurred.
    await screenshot(panel, 'overlay-opening');
    await search(panel, 'o');
    await panel.page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await screenshot(panel, 'overlay-light');
    await panel.page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await screenshot(panel, 'overlay-dark');
    await panel.page.emulateMediaFeatures([]);
  });
});

describe('popup fallback on restricted pages', () => {
  it('opens the popup on chrome:// pages and works the same', async () => {
    const [, linear] = await seed(h, [
      { url: 'http://blank.test/', title: 'Blank' },
      { url: 'http://linear.test/', title: 'Issues · Linear' },
    ]);
    const restricted = await h.control.evaluate(async () => (await chrome.tabs.create({ url: 'chrome://version/' })).id!);
    await new Promise((r) => setTimeout(r, 300));
    const panel = await openPanel(h, restricted);
    expect(panel.kind).toBe('popup');
    expect(await focusIsInField(panel)).toBe(true);
    await search(panel, 'lin');
    expect(await selectedTitle(panel)).toBe('Issues · Linear');
    await panel.page.screenshot({ path: `${RESULTS_DIR}/popup-fallback.png` });
    await press(panel, 'Enter');
    await waitClosed(panel);
    expect((await settledState(h, (s) => s.activeTabId === linear)).activeTabId).toBe(linear);
  });
});
