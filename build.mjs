import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('static', 'dist', { recursive: true });

const common = {
  outdir: 'dist',
  bundle: true,
  target: 'chrome120',
  sourcemap: 'linked',
  logLevel: 'info',
};
const builds = [
  { ...common, entryPoints: ['src/popup.ts', 'src/background.ts'], format: 'esm' },
  // Injected with scripting.executeScript, which runs classic scripts only.
  { ...common, entryPoints: ['src/overlay.ts'], format: 'iife' },
];

if (watch) {
  for (const options of builds) await (await esbuild.context(options)).watch();
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
