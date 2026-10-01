// Renders the committed icon files from the SVG sources in assets/brand. Run after changing the logo:
//   node scripts/render-icons.mjs
// Uses Playwright's Chromium. Set CHROMIUM_PATH to use a different Chrome/Chromium binary.
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
async function png(svgFile, size) {
  const svg = (await readFile(svgFile, 'utf8')).replace(
    '<svg ',
    `<svg style="display:block;width:${size}px;height:${size}px" `,
  );
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  return page.locator('svg').screenshot({ omitBackground: true });
}

// Small sizes use the simpler mark: the echo arcs blur into noise below 48 px.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = [];
for (const size of sizes)
  images.push(await png(size <= 32 ? 'assets/brand/logo-small.svg' : 'assets/brand/logo.svg', size));

// ICO container with PNG entries (supported since Windows Vista).
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((image, i) => {
  const entry = 6 + i * 16;
  header[entry] = sizes[i] >= 256 ? 0 : sizes[i];
  header[entry + 1] = sizes[i] >= 256 ? 0 : sizes[i];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(image.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += image.length;
});
await writeFile('assets/icon.ico', Buffer.concat([header, ...images]));
await writeFile('assets/brand/icon.png', images.at(-1));
await writeFile('assets/brand/tray.png', await png('assets/brand/logo-small.svg', 32));
await writeFile('assets/brand/tray-recording.png', await png('assets/brand/logo-recording.svg', 32));
await browser.close();
console.log('Wrote assets/icon.ico, assets/brand/icon.png, tray.png and tray-recording.png');
