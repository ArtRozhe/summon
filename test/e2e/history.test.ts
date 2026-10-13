import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, launch, openPanel, type Panel, RESULTS_DIR, reset, seed, settledState } from './harness';

let h: Harness;

beforeAll(async () => {
  h = await launch({ grant: ['history'] });
});

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  await reset(h);
  await h.control.evaluate(() => chrome.history.deleteAll());
});

/** Visits pages so they land in history, then closes their tabs. */
async function visit(urls: { url: string; title: string }[]): Promise<void> {
  const ids = await seed(h, urls);
  await h.control.evaluate((ids) => chrome.tabs.remove(ids), ids);
}

function rows(panel: Panel): Promise<string[]> {
  return panel.query((root) =>
    [...root.querySelectorAll('.results > li:not(.web)')].map((li) => (li.classList.contains('section') ? `— ${li.textContent}` : li.querySelector('.title')!.textContent!)),
  );
}

describe('history search', () => {
  it('lists visited pages below tabs and bookmarks, with the same matching', async () => {
    await visit([{ url: 'http://kit.test/releases', title: 'KitReleases' }]);
    const [current] = await seed(h, [
      { url: 'http://blank.test/', title: 'Blank' },
      { url: 'http://kit.test/', title: 'Kit home' },
    ]);
    const panel = await openPanel(h, current!);
    await panel.page.keyboard.type('kr');
    await new Promise((r) => setTimeout(r, 500));
    expect(await rows(panel)).toEqual(['— History', 'KitReleases']);
    await panel.page.keyboard.press('Backspace');
    await panel.page.keyboard.press('Backspace');
    await panel.page.keyboard.type('kit');
    await new Promise((r) => setTimeout(r, 300));
    // The open tab first, history below its header.
    expect(await rows(panel)).toEqual(['Kit home', '— History', 'KitReleases']);
    for (const scheme of ['light', 'dark'] as const) {
      await panel.page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
      await panel.page.screenshot({ path: `${RESULTS_DIR}/history-${scheme}.png` });
    }
    // Enter on a history row opens it in a new tab.
    await panel.page.keyboard.press('ArrowDown');
    await panel.page.keyboard.press('Enter').catch(() => {});
    const s = await settledState(h, (s) => s.activeUrl === 'http://kit.test/releases');
    expect(s.activeUrl).toBe('http://kit.test/releases');
  });

  // Granting and removing the optional permission need Chrome's prompt / a non-required permission: manual check.
  it('offers the command to switch it off', async () => {
    const [current] = await seed(h, [{ url: 'http://blank.test/', title: 'Blank' }]);
    const panel = await openPanel(h, current!);
    await panel.page.keyboard.type('>hist');
    await new Promise((r) => setTimeout(r, 300));
    expect(await panel.query((root) => [...root.querySelectorAll('.row .title')].map((e) => e.textContent))).toEqual([
      'Disable history search',
    ]);
  });
});
