import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, launch, openPanel, type Panel, RESULTS_DIR, reset, seed, selectedTitle, settledState, titles } from './harness';

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

async function chord(panel: Panel, code: string, ...modifiers: string[]): Promise<void> {
  for (const m of modifiers) await panel.page.keyboard.down(m as never);
  await panel.page.keyboard.press(code as never);
  for (const m of [...modifiers].reverse()) await panel.page.keyboard.up(m as never);
}

async function status(panel: Panel): Promise<string> {
  await new Promise((r) => setTimeout(r, 300));
  return panel.query((root) => root.querySelector('.status')!.textContent ?? '');
}

describe('tab actions', () => {
  it('⇧⌘⌫ closes the selected tab and keeps the panel; ⌘Z reopens it', async () => {
    const [current] = await seed(h, [
      { url: 'http://blank.test/', title: 'Blank' },
      { url: 'http://news.example.test/', title: 'Hacker News' },
      { url: 'http://linear.test/', title: 'Issues · Linear' },
    ]);
    const panel = await openPanel(h, current!);
    expect(await selectedTitle(panel)).toBe('Issues · Linear');
    await chord(panel, 'Backspace', 'Meta', 'Shift');
    expect(await status(panel)).toContain('Closed the tab');
    expect(await titles(panel)).toEqual(['Hacker News']);
    expect((await settledState(h, (s) => !s.urls.includes('http://linear.test/'))).urls).not.toContain('http://linear.test/');
    expect(await panel.isOpen()).toBe(true);

    await chord(panel, 'KeyZ', 'Meta');
    expect(await status(panel)).toContain('Reopened');
    expect((await settledState(h, (s) => s.urls.includes('http://linear.test/'))).urls).toContain('http://linear.test/');
  });

  it('⌘C copies the selected URL, also on a plain-http page', async () => {
    const [current] = await seed(h, [
      { url: 'http://blank.test/', title: 'Blank' },
      { url: 'http://linear.test/team', title: 'Issues · Linear' },
    ]);
    const panel = await openPanel(h, current!);
    await chord(panel, 'KeyC', 'Meta');
    expect(await status(panel)).toContain('Copied');
    // Paste into a field on the page to read the clipboard back.
    await panel.page.keyboard.press('Escape');
    await panel.page.evaluate(() => {
      const field = document.createElement('input');
      field.id = 'paste-here';
      document.body.prepend(field);
      field.focus();
    });
    await panel.page.keyboard.press('KeyV', { commands: ['Paste'] } as never);
    expect(await panel.page.$eval('#paste-here', (e) => (e as HTMLInputElement).value)).toBe('http://linear.test/team');
  });

  it('⌘K lists actions for the selected result; Esc goes back; "Move to this window" brings the tab here', async () => {
    const [current, , linear] = await seed(h, [
      { url: 'http://blank.test/', title: 'Blank' },
      { url: 'http://news.example.test/', title: 'Hacker News' },
      { url: 'http://linear.test/', title: 'Issues · Linear', window: 2 },
    ]);
    const panel = await openPanel(h, current!);
    expect(await selectedTitle(panel)).toBe('Issues · Linear');
    await chord(panel, 'KeyK', 'Meta');
    const menu = () => panel.query((root) => [...root.querySelectorAll('.row.menu .title')].map((e) => e.textContent));
    expect(await menu()).toEqual(['Switch to tab', 'Move to this window', 'Move to new window', 'Copy URL', 'Close tab']);
    expect(await panel.query((root) => root.querySelector('.menu-head')!.textContent)).toBe('Issues · Linear');
    for (const scheme of ['light', 'dark'] as const) {
      await panel.page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
      await panel.page.screenshot({ path: `${RESULTS_DIR}/actions-menu-${scheme}.png` });
    }

    await panel.page.keyboard.press('Escape');
    expect(await selectedTitle(panel)).toBe('Issues · Linear');
    expect(await panel.isOpen()).toBe(true);

    await chord(panel, 'KeyK', 'Meta');
    await panel.page.keyboard.press('ArrowDown');
    await panel.page.keyboard.press('Enter').catch(() => {});
    const s = await settledState(h, (s) => s.activeTabId === linear);
    expect(s.activeTabId).toBe(linear);
    const windowOf = (id: number) => h.control.evaluate(async (id) => (await chrome.tabs.get(id)).windowId, id);
    expect(await windowOf(linear!)).toBe(await windowOf(current!));
  });

  it('⌘K on a closed bookmark offers opening it, not tab actions', async () => {
    const [current] = await seed(h, [{ url: 'http://blank.test/', title: 'Blank' }], [{ title: 'KitDev', url: 'http://kit.test/dev' }]);
    const panel = await openPanel(h, current!);
    await panel.page.keyboard.type('kd');
    await new Promise((r) => setTimeout(r, 200));
    await chord(panel, 'KeyK', 'Meta');
    expect(await panel.query((root) => [...root.querySelectorAll('.row.menu .title')].map((e) => e.textContent))).toEqual([
      'Open in new tab',
      'Open in this tab',
      'Open in new window',
      'Copy URL',
    ]);
  });
});
