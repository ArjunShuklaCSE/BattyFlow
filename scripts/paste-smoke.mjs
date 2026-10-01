// Desktop check of the native paste path against a browser window this script controls. It never pastes unless
// the foreground window belongs to that browser, and it verifies your clipboard text is restored afterwards.
//
//   npm run build && node scripts/paste-smoke.mjs
//
// It briefly takes focus. Don't type while it runs (about 10 seconds).
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const helper = spawn(resolve('dist/native/BattyHelper.exe'), [], {
  stdio: ['pipe', 'pipe', 'ignore'],
  windowsHide: true,
});
const waiting = new Map();
let next = 1;
let ready;
const isReady = new Promise(r => (ready = r));
createInterface({ input: helper.stdout }).on('line', line => {
  const message = JSON.parse(line);
  if (message.event === 'ready') ready();
  waiting.get(message.id)?.(message);
});
const call = (op, extra = {}) =>
  new Promise(r => {
    const id = next++;
    waiting.set(id, r);
    helper.stdin.write(JSON.stringify({ id, op, ...extra }) + '\n');
  });
const clipboardText = () =>
  spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8' }).stdout;
// Windows won't let a background process take focus; borrow the foreground thread's input state to do it.
// Test-only: the app itself never moves focus.
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

const server = await chromium.launchServer({
  headless: false,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--window-size=720,420'],
});
const browser = await chromium.connect(server.wsEndpoint());
const checks = [];
const ok = message => (checks.push(message), console.log(`  ✓ ${message}`));
try {
  await isReady;
  const page = await browser.newPage();
  await page.setContent(
    '<textarea id="t" style="width:600px;height:200px">Before: </textarea><input id="p" type="password">',
  );
  await page.bringToFront();
  focusProcess(server.process().pid);
  await page.focus('#t');
  await page.evaluate(() => {
    const t = document.querySelector('#t');
    t.setSelectionRange(t.value.length, t.value.length);
  });
  await page.waitForTimeout(600);

  const { target } = await call('target');
  const browserPid = server.process().pid;
  if (target.pid !== browserPid)
    throw Error(`Foreground window is not the test browser (pid ${target.pid}); not pasting.`);
  ok(`target probe found the test window (${target.app}, field ${target.field ? 'identified' : 'unknown'})`);

  const before = clipboardText();
  const text = `pasted by BattyFlow ${Date.now().toString(36)}`;
  const result = await call('paste', {
    text,
    identity: target.identity,
    terminal: false,
    restore: true,
    restoreDelayMs: 700,
  });
  assert.equal(result.result, 'pasted');
  await page.waitForTimeout(900);
  assert.equal(await page.inputValue('#t'), `Before: ${text}`);
  ok('text arrived at the cursor');
  assert.equal(clipboardText(), before);
  ok('clipboard restored to what it was');

  const stale = await call('paste', { text: 'must not appear', identity: '1:2:3', restore: true });
  assert.equal(stale.result, 'focus-changed');
  assert.equal(await page.inputValue('#t'), `Before: ${text}`);
  ok('a different window is refused, nothing typed');

  await page.focus('#p');
  await page.waitForTimeout(300);
  const secure = await call('target');
  assert.equal(secure.target.secure, true);
  const refused = await call('paste', { text: 'secret?', identity: secure.target.identity, restore: true });
  assert.equal(refused.result, 'secure');
  assert.equal(await page.inputValue('#p'), '');
  ok('password fields are refused');
} finally {
  helper.stdin.end();
  await browser.close();
  await server.close();
}
console.log(`\n${checks.length} paste checks passed.`);
