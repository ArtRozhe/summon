import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, launch, openPanel, type Panel, RESULTS_DIR, reset, seed } from './harness';

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

/** Which rows show a site icon (by title), once icons have had a moment to arrive. */
async function tiles(panel: Panel): Promise<Record<string, 'icon' | 'letter'>> {
  await new Promise((r) => setTimeout(r, 300));
  return panel.query((root) =>
    Object.fromEntries(
      [...root.querySelectorAll('.row')].map((row) => [
        row.querySelector('.title')!.textContent,
        row.querySelector('.tile img') ? 'icon' : 'letter',
      ]),
    ),
  );
}

/** Chrome stores a page's icon a moment after it loads. */
async function waitForStoredIcons(): Promise<void> {
  await new Promise((r) => setTimeout(r, 1000));
}

describe('site icons', () => {
  it('shows the icon Chrome has for a site and the letter tile for a site without one', async () => {
    const [, current] = await seed(h, [
      { url: 'http://github.test/acme', title: 'Acme · GitHub' },
      { url: 'http://blank.test/', title: 'Blank' },
      { url: 'http://noicon.test/', title: 'No icon here' },
    ]);
    await waitForStoredIcons();
    const panel = await openPanel(h, current!);
    expect(await tiles(panel)).toEqual({ 'No icon here': 'letter', 'Acme · GitHub': 'icon' });
    await panel.page.screenshot({ path: `${RESULTS_DIR}/favicons-overlay.png` });
  });

  it('shows icons in the overlay on a page with a strict Content-Security-Policy', async () => {
    const [, strict] = await seed(h, [
      { url: 'http://github.test/acme', title: 'Acme · GitHub' },
      { url: 'http://strict.test/csp', title: 'Strict page' },
    ]);
    await waitForStoredIcons();
    const panel = await openPanel(h, strict!);
    expect(panel.kind).toBe('overlay');
    expect(await tiles(panel)).toEqual({ 'Acme · GitHub': 'icon' });
  });

  it('shows icons in the popup fallback', async () => {
    await seed(h, [{ url: 'http://github.test/acme', title: 'Acme · GitHub' }]);
    await waitForStoredIcons();
    const restricted = await h.control.evaluate(async () => (await chrome.tabs.create({ url: 'chrome://version/' })).id!);
    await new Promise((r) => setTimeout(r, 300));
    const panel = await openPanel(h, restricted);
    expect(panel.kind).toBe('popup');
    expect(await tiles(panel)).toEqual({ 'Acme · GitHub': 'icon' });
  });
});
