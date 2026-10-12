// Renders the extension icons from assets/*.svg into static/icons/*.png.
// Small sizes use icon-small.svg: the second sparkle turns into a speck at 16 px (and 32 px = 16 px on Retina).
// Usage: npm run icons
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const sizes = { 16: 'icon-small.svg', 32: 'icon-small.svg', 48: 'icon.svg', 128: 'icon.svg' };

const browser = await puppeteer.launch();
const page = await browser.newPage();
for (const [size, source] of Object.entries(sizes)) {
  const svg = await readFile(new URL(`../assets/${source}`, import.meta.url), 'utf8');
  await page.setViewport({ width: Number(size), height: Number(size) });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}</style>` +
      `<img src="data:image/svg+xml;utf8,${encodeURIComponent(svg)}" width="${size}" height="${size}">`,
  );
  await page.screenshot({ path: `static/icons/${size}.png`, omitBackground: true });
}
await browser.close();
