import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type Harness,
  launch,
  openPanel,
  reloadExtension,
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
    // Typing appends, so the field ends with what was typed.
    if ((await panel.query((root) => (root.querySelector('.query') as HTMLInputElement).value)).endsWith(query)) return;
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
    // The web search row comes last, then the list wraps around.
    await panel.page.keyboard.press('ArrowDown');
    expect(await selectedTitle(panel)).toBe('Search for “docs”');
    await panel.page.keyboard.press('ArrowDown');
    expect(await selectedTitle(panel)).toBe('Docs one');
    await panel.page.keyboard.press('ArrowUp');
    await panel.page.keyboard.press('ArrowUp');
    expect(await selectedTitle(panel)).toBe('Docs two');
    expect(await focusIsInField(panel)).toBe(true);
    expect(await panel.query((root) => root.querySelector('.query')!.getAttribute('aria-activedescendant'))).toBe('summon-option-1');
  });

  it('with no matches offers a web search, and Enter runs it in a new tab', async () => {
    const [tabId] = await seed(h, WORK);
    const before = await state(h);
    const panel = await openPanel(h, tabId!);
    await search(panel, 'zzzz');
    expect(await titles(panel)).toEqual([]);
    expect(await selectedTitle(panel)).toBe('Search for “zzzz”');
    await screenshot(panel, 'no-matches');
    await press(panel, 'Enter');
    // (Not checking the active tab or the count: with no network, Chrome may add its own connectivity-check tab.)
    const s = await settledState(h, (s) => s.urls.some((u) => u.includes('zzzz')));
    expect(s.urls.filter((u) => u.includes('zzzz'))).toHaveLength(1);
    expect(s.urls).toEqual(expect.arrayContaining(before.urls));
  });

  it('opens an address typed into the field', async () => {
    const [tabId] = await seed(h, WORK);
    const panel = await openPanel(h, tabId!);
    await search(panel, 'http://kit.test/dev');
    expect(await selectedTitle(panel)).toBe('Go to kit.test/dev');
    await panel.page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await screenshot(panel, 'go-to-address');
    await press(panel, 'Enter');
    expect((await settledState(h, (s) => s.activeUrl === 'http://kit.test/dev')).activeUrl).toBe('http://kit.test/dev');
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

describe('memory', () => {
  const APPS = [
    { title: 'AppDev1', url: 'http://dev1.app.test/' },
    { title: 'AppDev2', url: 'http://dev2.app.test/' },
  ];

  async function pickSecond(here: number): Promise<void> {
    const panel = await openPanel(h, here);
    await search(panel, 'ad');
    // After one pick it may already be first (a bonus), so select it by title.
    for (let i = 0; i < 2 && (await selectedTitle(panel)) !== 'AppDev2'; i++) await panel.page.keyboard.press('ArrowDown');
    expect(await selectedTitle(panel)).toBe('AppDev2');
    await press(panel, 'Enter');
    await waitClosed(panel);
  }

  it('puts your usual pick first, and it survives an extension reload', async () => {
    const [here] = await seed(h, [{ url: 'http://blank.test/', title: 'Blank' }], APPS);
    let panel = await openPanel(h, here!);
    await search(panel, 'ad');
    expect(await titles(panel)).toEqual(['AppDev1', 'AppDev2']);
    await press(panel, 'Escape');
    await waitClosed(panel);

    await pickSecond(here!);
    await pickSecond(here!);

    panel = await openPanel(h, here!);
    await search(panel, 'ad');
    expect(await titles(panel)).toEqual(['AppDev2', 'AppDev1']);
    expect(await panel.query((root) => !!root.querySelector('.results .row.pinned'))).toBe(true);
    await screenshot(panel, 'learned');
    await press(panel, 'Escape');
    await waitClosed(panel);

    // An update: the extension reloads while the page stays open with the old overlay script in it.
    await reloadExtension(h);
    panel = await openPanel(h, here!);
    await search(panel, 'ad');
    expect(await titles(panel)).toEqual(['AppDev2', 'AppDev1']);
  });
});

describe('learned ⌥↵', () => {
  it('after two ⌥↵ in a row, Enter switches to the similar tab', async () => {
    const [here, app] = await seed(
      h,
      [
        { url: 'http://blank.test/', title: 'Blank' },
        { url: 'http://app.test/projects/7?company=b', title: 'Project 7 · App' },
      ],
      [{ title: 'AppProd', url: 'http://app.test/?company=a' }],
    );
    for (let i = 0; i < 2; i++) {
      const panel = await openPanel(h, here!);
      await search(panel, 'appprod');
      await press(panel, 'Enter', 'Alt');
      await waitClosed(panel);
      expect((await settledState(h, (s) => s.activeTabId === app)).activeTabId).toBe(app);
    }
    const panel = await openPanel(h, here!);
    await search(panel, 'appprod');
    const hints = await text(panel, '.hints');
    expect(hints).toContain('↵ Switch to open tab');
    expect(hints).toContain('⌥↵ Open in new tab');
    await press(panel, 'Enter');
    await waitClosed(panel);
    const s = await settledState(h, (s) => s.activeTabId === app);
    expect(s.activeTabId).toBe(app);
    expect(s.tabCount).toBe(2);
  });
});

describe('export and import', () => {
  const APPS = [
    { title: 'AppDev1', url: 'http://dev1.app.test/' },
    { title: 'AppDev2', url: 'http://dev2.app.test/' },
  ];

  async function command(panel: Panel, query: string): Promise<void> {
    await search(panel, query);
    expect(await text(panel, '.results .title')).toBe(query.includes('export') ? 'Export Summon data' : 'Import Summon data');
    expect(await titles(panel)).toHaveLength(1);
  }

  it('exports to a file that imports back into an empty Summon', async () => {
    const downloads = `${RESULTS_DIR}/downloads`;
    await rm(downloads, { recursive: true, force: true });
    await mkdir(downloads, { recursive: true });
    const cdp = await h.browser.target().createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });

    // Learn something, then export it.
    const [here] = await seed(h, [{ url: 'http://blank.test/', title: 'Blank' }], APPS);
    await h.control.evaluate(
      (memory) => chrome.storage.local.set({ memory }),
      { version: 1, similar: {}, picks: { ad: { 'http://dev2.app.test/': { n: 3, weight: 3, last: Date.now() } } } },
    );
    let panel = await openPanel(h, here!);
    await search(panel, '>');
    await screenshot(panel, 'commands');
    await command(panel, ' export');
    await press(panel, 'Enter');
    expect(await text(panel, '.status')).toBe('Exported 1 search Summon remembers');
    let file = '';
    for (let i = 0; i < 50 && !file; i++) {
      file = (await readdir(downloads)).find((f) => f.startsWith('summon-') && f.endsWith('.json')) ?? '';
      if (!file) await new Promise((r) => setTimeout(r, 100));
    }
    const exported = JSON.parse(await readFile(`${downloads}/${file}`, 'utf8'));
    expect(exported.format).toBe('summon-memory');
    await press(panel, 'Escape');
    await waitClosed(panel);

    // Forget everything, then import the file.
    await h.control.evaluate(() => chrome.storage.local.clear());
    panel = await openPanel(h, here!);
    await command(panel, '> import');
    const [chooser] = await Promise.all([panel.page.waitForFileChooser(), press(panel, 'Enter')]);
    await chooser.accept([`${downloads}/${file}`]);
    for (let i = 0; i < 50 && !(await text(panel, '.status')).startsWith('Imported'); i++) await new Promise((r) => setTimeout(r, 50));
    expect(await text(panel, '.status')).toBe('Imported — Summon now remembers 1 search');
    expect(await panel.isOpen()).toBe(true);

    await panel.page.keyboard.press('Escape');
    await waitClosed(panel);
    panel = await openPanel(h, here!);
    await search(panel, 'ad');
    expect(await titles(panel)).toEqual(['AppDev2', 'AppDev1']);
  });

  it('rejects a file that is not a Summon export', async () => {
    const bad = `${RESULTS_DIR}/not-summon.json`;
    await writeFile(bad, '{"hello": "world"}');
    const [here] = await seed(h, [{ url: 'http://blank.test/', title: 'Blank' }]);
    const panel = await openPanel(h, here!);
    await command(panel, '> import');
    const [chooser] = await Promise.all([panel.page.waitForFileChooser(), press(panel, 'Enter')]);
    await chooser.accept([bad]);
    for (let i = 0; i < 50 && !(await text(panel, '.status')); i++) await new Promise((r) => setTimeout(r, 50));
    expect(await text(panel, '.status')).toBe('This is not a Summon export');
  });

  it('explains that import needs a regular page in the popup', async () => {
    await seed(h, [{ url: 'http://blank.test/', title: 'Blank' }]);
    const restricted = await h.control.evaluate(async () => (await chrome.tabs.create({ url: 'chrome://version/' })).id!);
    await new Promise((r) => setTimeout(r, 300));
    const panel = await openPanel(h, restricted);
    expect(panel.kind).toBe('popup');
    await command(panel, '> import');
    await press(panel, 'Enter');
    expect(await text(panel, '.status')).toContain('Import works on a regular web page');
  });
});

describe('wrong keyboard layout', () => {
  it('finds results and commands typed with the Russian layout on', async () => {
    const [here] = await seed(h, [{ url: 'http://blank.test/', title: 'Blank' }], [
      { title: 'AppDev1', url: 'http://dev1.app.test/' },
      { title: 'AppDev2', url: 'http://dev2.app.test/' },
    ]);
    let panel = await openPanel(h, here!);
    await search(panel, 'фв1');
    expect(await titles(panel)).toEqual(['AppDev1']);
    await press(panel, 'Escape');
    await waitClosed(panel);

    panel = await openPanel(h, here!);
    await search(panel, 'Ю учзщке');
    expect(await titles(panel)).toEqual(['Export Summon data']);
  });
});
