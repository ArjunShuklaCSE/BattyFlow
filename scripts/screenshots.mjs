// Regenerates the README images from the real app:
//   docs/images/demo.png      animated (APNG): a dictation pasted into an editor window, with the real overlay
//   docs/images/<page>.png    the main window pages, dark theme
//
//   npm run build && node scripts/screenshots.mjs
//
// Uses the CPU engine and Base (English) from .local/smoke-assets or .local/downloads, downloading them if
// missing, a synthetic voice clip made with Windows' built-in speech synthesizer, and Playwright's Chromium for
// the editor window (set CHROMIUM_PATH to use another build). The editor window briefly takes focus.
import { _electron as electron, chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile, stat } from 'node:fs/promises';
import { deflateSync, crc32 } from 'node:zlib';
import { resolve, join } from 'node:path';

const root = resolve('.local/shots');
const profile = join(root, 'profile');
const out = resolve('docs/images');
const demoWav = join(root, 'demo.wav');
const sentence = 'Move the OAuth token refresh into use effect, then open a pull request on GitHub.';
await rm(profile, { recursive: true, force: true });
await mkdir(join(profile, 'assets/models'), { recursive: true });
await mkdir(out, { recursive: true });
await cp(resolve('.local/smoke-assets/runtimes'), join(profile, 'assets/runtimes'), { recursive: true }).catch(
  () => {},
);
await cp(resolve('.local/downloads/ggml-base.en-q8_0.bin'), join(profile, 'assets/models/ggml-base.en-q8_0.bin')).catch(
  () => {},
);

// Synthetic speech for the demo; no human recording involved.
spawnSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Zira Desktop'); $s.Rate = 0
$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile('${demoWav}', $f); $s.Speak('${sentence}'); $s.Dispose()`,
  ],
  { stdio: 'inherit' },
);

await writeFile(
  join(profile, 'settings.json'),
  JSON.stringify({
    schemaVersion: 2,
    microphone: '',
    language: 'en',
    profile: 'code',
    autoProfile: true,
    mode: 'dictation',
    pushToTalk: 'off',
    shortcut: 'CommandOrControl+Alt+Shift+F9',
    commandShortcut: 'CommandOrControl+Alt+Shift+F10',
    editShortcut: 'CommandOrControl+Alt+Shift+F11',
    maxSeconds: 60,
    silenceStop: false,
    preview: false,
    delivery: 'paste',
    restoreClipboard: true,
    trailingSpace: true,
    removeFillers: true,
    vocabularyPrompt: true,
    polish: false,
    history: true,
    sounds: false,
    launchAtLogin: false,
    theme: 'dark',
    threads: 8,
    gpu: false,
    targetLanguage: 'es',
    translationPairs: [],
  }),
);
// Real Base (English) outputs from the benchmark suite, so the History page isn't empty.
const now = Date.now();
const past = [
  ['Start the dev server on localhost port 3000.', 9, 2.9, 0.4],
  ['The Node.js process crashes when the cache is empty.', 9, 3.1, 0.9],
  ['Rotate the OAuth client secret after the audit.', 8, 2.8, 1.6],
  ['Convert the helper to TypeScript and add strict null checks.', 10, 3.4, 2.2],
  ['We should cache the GraphQL responses for 5 minutes.', 9, 3.2, 26],
  ['I like this API, but I do not like the timeout.', 11, 4, 27],
  ['Wrap the fetch call in useEffect with an empty dependency array.', 11, 3.8, 28.5],
];
await writeFile(
  join(profile, 'history.json'),
  JSON.stringify(
    past.map(([text, words, seconds, hoursAgo], i) => ({
      id: `sample-${i}`,
      at: now - hoursAgo * 3600000,
      text,
      mode: 'dictation',
      seconds,
      words,
      delivered: 'pasted',
    })),
  ),
);

const app = await electron.launch({
  args: [
    '.',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${demoWav}%noloop`,
  ],
  env: { ...process.env, BATTYFLOW_DATA_DIR: profile },
  colorScheme: null,
});
const find = async test => {
  for (let i = 0; i < 100; i++) {
    const page = app.windows().find(w => test(w.url()));
    if (page) return page;
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error('window not found');
};
const ui = await find(url => url.endsWith('index.html'));
const overlay = await find(url => url.endsWith('overlay.html'));
await ui.waitForSelector('#record');
const view = () => ui.evaluate(() => window.batty.snapshot());
const until = async (check, timeout = 60000) => {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await view();
    if (check(v)) return v;
    if (Date.now() > end) throw Error(`Timed out in state ${v.state}: ${v.notice}`);
    await new Promise(r => setTimeout(r, 50));
  }
};
for (const id of ['whisper-cpu', 'base.en']) {
  if ((await view()).installed.includes(id)) await ui.evaluate(id => window.batty.useAsset(id), id);
  else await ui.evaluate(id => window.batty.download(id), id);
}
await until(v => v.engineReady, 180000);
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('index.html'));
  w.setSize(1200, 800);
  w.center();
});

// ---------------------------------------------------------------- the editor window that receives the paste

const server = await chromium.launchServer({
  headless: false,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--window-size=900,640'],
});
const browser = await chromium.connect(server.wsEndpoint());
const editor = await browser.newPage({ viewport: { width: 880, height: 520 }, deviceScaleFactor: 1.5 });
await editor.setContent(`<!doctype html><html><head><style>
  body{margin:0;background:#16161c;color:#d6d6de;font:15px/1.7 'Cascadia Code',Consolas,monospace;height:100vh;display:flex;flex-direction:column}
  .tabs{display:flex;gap:2px;background:#0f0f14;padding:8px 10px 0}
  .tab{padding:8px 16px;border-radius:8px 8px 0 0;color:#8a8a99;font:13px 'Segoe UI',sans-serif}
  .tab.on{background:#16161c;color:#e6e6ee}
  .body{display:flex;flex:1;padding:18px 0}
  .gutter{width:52px;text-align:right;padding-right:16px;color:#4b4b58;user-select:none;white-space:pre}
  textarea{flex:1;background:transparent;border:0;outline:0;color:#d6d6de;font:inherit;resize:none;caret-color:#a78bfa}
</style></head><body><div class="tabs"><div class="tab on">notes.md</div><div class="tab">auth.ts</div></div>
<div class="body"><div class="gutter">1\n2\n3\n4\n5\n6\n7\n8\n9</div><textarea id="t" spellcheck="false">## Auth follow-ups

- Token refresh fires twice on login
- </textarea></div></body></html>`);
const focusProcess = pid =>
  spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Add-Type @'
using System; using System.Runtime.InteropServices;
public static class F {
  delegate bool Enum(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(Enum cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  public static bool Focus(uint target) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == target && IsWindowVisible(h) && GetWindowTextLength(h) > 0) { found = h; return false; } return true; }, IntPtr.Zero);
    if (found == IntPtr.Zero) return false;
    uint ignored; uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out ignored); uint me = GetCurrentThreadId();
    AttachThreadInput(me, fg, true); BringWindowToTop(found); SetForegroundWindow(found); AttachThreadInput(me, fg, false);
    return GetForegroundWindow() == found;
  }
}
'@; [F]::Focus(${pid})`,
    ],
    { encoding: 'utf8' },
  ).stdout.trim() === 'True';
await editor.bringToFront();
focusProcess(server.process().pid);
await editor.focus('#t');
await editor.evaluate(() => {
  const t = document.querySelector('#t');
  t.setSelectionRange(t.value.length, t.value.length);
});
await editor.waitForTimeout(500);

// ---------------------------------------------------------------- record the dictation

const frames = [];
let scene = await editor.screenshot();
const overlayVisible = () =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find(w => w.webContents.getURL().endsWith('overlay.html'))
      .isVisible(),
  );
const grab = async () =>
  frames.push({ t: Date.now(), scene, pill: await overlay.screenshot({ omitBackground: true, timeout: 3000 }) });
await overlay.evaluate(() => window.batty.toggle()); // same path as the start/stop shortcut
await until(v => v.state === 'recording');
const speechEnds = Date.now() + 5600;
while (Date.now() < speechEnds) await grab();
await overlay.evaluate(() => window.batty.toggle());
let done = null;
while (!done) {
  await grab();
  const v = await view();
  if (v.delivered || v.state === 'error') done = v;
}
await editor.waitForTimeout(150);
scene = await editor.screenshot();
// The pill hides itself shortly after pasting; capture until then.
const pastedUntil = Date.now() + 700;
while (Date.now() < pastedUntil && (await overlayVisible())) await grab();
console.log(`Dictated: ${done.text} (${done.delivered})`);
if (done.delivered !== 'pasted')
  console.warn('The editor window lost focus, so the demo shows a copy instead of a paste.');

// ---------------------------------------------------------------- composite frames and encode an APNG

const compositor = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await compositor.setContent('<canvas id="c"></canvas>');
const W = 1060;
const H = 720;
await compositor.evaluate(
  ([W, H]) => {
    const c = document.getElementById('c');
    c.width = W;
    c.height = H;
    window.prev = null;
    window.drawFrame = async (sceneB64, pillB64) => {
      const load = b64 =>
        new Promise(r => {
          const i = new Image();
          i.onload = () => r(i);
          i.src = 'data:image/png;base64,' + b64;
        });
      const [s, p] = await Promise.all([load(sceneB64), load(pillB64)]);
      const g = c.getContext('2d');
      const bg = g.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#1b1530');
      bg.addColorStop(1, '#0b0b10');
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      // window frame
      const x = 90,
        y = 46,
        w = 880,
        h = 520 + 38;
      g.save();
      g.shadowColor = 'rgba(0,0,0,.55)';
      g.shadowBlur = 50;
      g.shadowOffsetY = 18;
      g.beginPath();
      g.roundRect(x, y, w, h, 12);
      g.fillStyle = '#0f0f14';
      g.fill();
      g.restore();
      g.save();
      g.beginPath();
      g.roundRect(x, y, w, h, 12);
      g.clip();
      g.fillStyle = '#0f0f14';
      g.fillRect(x, y, w, 38);
      g.fillStyle = '#8a8a99';
      g.font = '13px Segoe UI';
      g.fillText('notes.md — Editor', x + 16, y + 24);
      g.strokeStyle = '#8a8a99';
      g.lineWidth = 1.2;
      const cx = x + w - 30;
      g.beginPath();
      g.moveTo(cx - 5, y + 14);
      g.lineTo(cx + 5, y + 24);
      g.moveTo(cx + 5, y + 14);
      g.lineTo(cx - 5, y + 24);
      g.stroke();
      g.strokeRect(cx - 50, y + 14, 10, 10);
      g.beginPath();
      g.moveTo(cx - 100, y + 19);
      g.lineTo(cx - 90, y + 19);
      g.stroke();
      g.drawImage(s, x, y + 38, w, 520);
      g.restore();
      // the overlay sits at the bottom centre of the screen
      const pw = p.width / 1.5,
        ph = p.height / 1.5;
      g.drawImage(p, (W - pw) / 2, H - ph - 8, pw, ph);
      const img = g.getImageData(0, 0, W, H);
      let box = null;
      if (!window.prev) box = [0, 0, W, H];
      else {
        const a = img.data,
          b = window.prev.data;
        let x0 = W,
          y0 = H,
          x1 = -1,
          y1 = -1;
        for (let yy = 0; yy < H; yy++)
          for (let xx = 0; xx < W; xx++) {
            const k = (yy * W + xx) * 4;
            if (a[k] !== b[k] || a[k + 1] !== b[k + 1] || a[k + 2] !== b[k + 2]) {
              if (xx < x0) x0 = xx;
              if (xx > x1) x1 = xx;
              if (yy < y0) y0 = yy;
              if (yy > y1) y1 = yy;
            }
          }
        if (x1 >= 0) box = [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
      }
      window.prev = img;
      if (!box) return null;
      const region = g.getImageData(...box).data;
      let bin = '';
      for (let i = 0; i < region.length; i += 0x8000) bin += String.fromCharCode(...region.subarray(i, i + 0x8000));
      return { box, rgba: btoa(bin) };
    };
  },
  [W, H],
);

const encoded = [];
for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  const delay = Math.max(40, (frames[i + 1]?.t ?? f.t + 2200) - f.t);
  const region = await compositor.evaluate(
    ([s, p]) => window.drawFrame(s, p),
    [f.scene.toString('base64'), f.pill.toString('base64')],
  );
  if (!region) {
    if (encoded.length) encoded.at(-1).delay += delay;
    continue;
  }
  const [x, y, w, h] = region.box;
  const rgba = Buffer.from(region.rgba, 'base64');
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let row = 0; row < h; row++) rgba.copy(raw, row * (w * 4 + 1) + 1, row * w * 4, (row + 1) * w * 4);
  encoded.push({ x, y, w, h, delay, data: deflateSync(raw, { level: 9 }) });
}
encoded.at(-1).delay += 1800; // linger on the result before looping

const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};
const u32 = (...values) => {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeUInt32BE(v, i * 4));
  return b;
};
const ihdr = Buffer.concat([u32(W, H), Buffer.from([8, 6, 0, 0, 0])]);
const parts = [
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('acTL', u32(encoded.length, 0)),
];
let seq = 0;
encoded.forEach((f, i) => {
  const fctl = Buffer.alloc(26);
  fctl.writeUInt32BE(seq++, 0);
  fctl.writeUInt32BE(f.w, 4);
  fctl.writeUInt32BE(f.h, 8);
  fctl.writeUInt32BE(f.x, 12);
  fctl.writeUInt32BE(f.y, 16);
  fctl.writeUInt16BE(Math.min(65535, f.delay), 20);
  fctl.writeUInt16BE(1000, 22);
  parts.push(chunk('fcTL', fctl));
  parts.push(i === 0 ? chunk('IDAT', f.data) : chunk('fdAT', Buffer.concat([u32(seq++), f.data])));
});
parts.push(chunk('IEND', Buffer.alloc(0)));
await writeFile(join(out, 'demo.png'), Buffer.concat(parts));
console.log(`demo.png: ${encoded.length} frames, ${((await stat(join(out, 'demo.png'))).size / 1024).toFixed(0)} KB`);
await browser.close();
await server.close();

// ---------------------------------------------------------------- static page screenshots

await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('index.html'));
  w.show();
});
await ui.evaluate(() => document.getElementById('scratch').blur());
for (const page of ['home', 'history', 'vocabulary', 'models', 'settings']) {
  await ui.click(`[data-page="${page}"]`);
  await ui.waitForTimeout(500);
  await ui.screenshot({ path: join(out, `${page}.png`) });
}
await app.close();
console.log(`Wrote ${out}`);
