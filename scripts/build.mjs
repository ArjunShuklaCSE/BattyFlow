import { build } from 'esbuild';
import { mkdir, cp } from 'node:fs/promises';
import './build-native.mjs';
import './build-icons.mjs';
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/main/app.ts'],
  outfile: 'dist/main/app.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  external: ['electron'],
  format: 'cjs',
});
await build({
  entryPoints: ['src/preload/ui.ts', 'src/preload/capture.ts'],
  outdir: 'dist/preload',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  external: ['electron'],
  format: 'cjs',
});
await build({
  entryPoints: ['src/renderer/ui.ts', 'src/renderer/overlay.ts', 'src/renderer/capture.ts', 'src/renderer/worklet.ts'],
  outdir: 'dist/renderer',
  bundle: true,
  platform: 'browser',
  target: 'chrome130',
});
for (const file of ['index.html', 'overlay.html', 'capture.html', 'style.css', 'overlay.css'])
  await cp(`src/renderer/${file}`, `dist/renderer/${file}`);
