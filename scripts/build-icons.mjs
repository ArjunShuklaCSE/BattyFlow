// Icons and fonts are committed; icons are rendered from assets/brand/*.svg by scripts/render-icons.mjs and committed; the build only copies them.
import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('dist/renderer', { recursive: true });
await copyFile('assets/brand/icon.png', 'dist/icon.png');
await copyFile('assets/brand/tray.png', 'dist/tray.png');
await copyFile('assets/brand/tray-recording.png', 'dist/tray-recording.png');
await copyFile('assets/brand/logo.svg', 'dist/renderer/logo.svg');
await copyFile('assets/fonts/Geist.woff2', 'dist/renderer/Geist.woff2');
await copyFile('assets/fonts/GeistMono.woff2', 'dist/renderer/GeistMono.woff2');
