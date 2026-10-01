// End-to-end check of the real app: setup download, recording from a synthetic WAV, transcription, history,
// overlay behaviour and the IPC boundary. Nothing is pasted into other apps (delivery is "show in BattyFlow").
//
//   npm run build && node scripts/smoke.mjs [--model tiny.en] [--keep]
//
// Needs network access for the first run (about 52 MB). Downloads are cached in .local/smoke-assets.
import { _electron as electron } from 'playwright';
import { mkdir, rm, writeFile, cp, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const model = arg('--model', 'tiny.en');
const profile = resolve('.local/smoke-profile');
const cache = resolve('.local/smoke-assets');
const wav = resolve('benchmark/fixtures/generated/plain.wav');
await stat(wav).catch(() => {
  throw Error('Run `npm run fixtures` first to generate the synthetic test audio.');
});
await rm(profile, { recursive: true, force: true });
await mkdir(profile, { recursive: true });
// Reuse earlier downloads so repeated runs don't hit the network.
await cp(cache, resolve(profile, 'assets'), { recursive: true }).catch(() => {});
await writeFile(resolve(profile, 'settings.json'), JSON.stringify({ schemaVersion: 2, ...defaults() }));

function defaults() {
  // Test shortcuts that won't collide with a BattyFlow you may have running; push-to-talk off.
  return {
    microphone: '',
    language: 'en',
    profile: 'neutral',
    autoProfile: true,
    mode: 'dictation',
    pushToTalk: 'off',
    shortcut: 'CommandOrControl+Alt+Shift+F9',
    commandShortcut: 'CommandOrControl+Alt+Shift+F10',
    editShortcut: 'CommandOrControl+Alt+Shift+F11',
    maxSeconds: 30,
    silenceStop: false,
    preview: false,
    delivery: 'none',
    restoreClipboard: true,
    trailingSpace: true,
    removeFillers: true,
    vocabularyPrompt: true,
    polish: false,
    history: true,
    sounds: false,
    launchAtLogin: false,
    theme: 'dark',
    threads: 4,
    gpu: false,
    targetLanguage: 'es',
    translationPairs: [],
  };
}

const checks = [];
const ok = message => (checks.push(message), console.log(`  ✓ ${message}`));
const app = await electron.launch({
  args: [
    '.',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}%noloop`,
  ],
  env: { ...process.env, BATTYFLOW_DATA_DIR: profile },
  timeout: 30000,
});
const errors = [];
try {
  let ui;
  for (let i = 0; i < 100 && !ui; i++) {
    ui = app.windows().find(w => w.url() === 'batty://app/index.html');
    if (!ui) await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ui, 'main window');
  ui.on('pageerror', e => errors.push(e.message));
  await ui.waitForSelector('#record');
  const view = () => ui.evaluate(() => window.batty.snapshot());
  // Polls the app state from the test side (waitForFunction doesn't await promises).
  const until = async (check, timeout = 30000) => {
    const end = Date.now() + timeout;
    for (;;) {
      const v = await view();
      if (check(v)) return v;
      if (Date.now() > end) throw Error(`Timed out in state ${v.state}: ${v.notice}`);
      await new Promise(r => setTimeout(r, 100));
    }
  };

  // 1. Setup: download the engine and a model through the UI, exactly as a user would.
  await ui.waitForSelector('#setup:not([hidden])');
  ok('fresh profile shows the setup card');
  for (const id of ['whisper-cpu', model]) {
    if (!(await view()).installed.includes(id)) {
      await ui.evaluate(id => window.batty.download(id), id);
    } else {
      await ui.evaluate(id => window.batty.useAsset(id), id);
    }
  }
  await until(v => v.engineReady, 120000);
  await ui.waitForSelector('#setup', { state: 'hidden' });
  let v = await view();
  assert.equal(v.settings.whisper.catalogId, 'whisper-cpu');
  assert.equal(v.settings.asrModel.catalogId, model);
  ok(`engine and ${model} downloaded, SHA-256 verified and activated`);
  await cp(resolve(profile, 'assets'), cache, { recursive: true });

  // 2. Record the synthetic sentence through Chromium's fake microphone and the AudioWorklet.
  await ui.click('#record');
  await until(v => ['recording', 'error'].includes(v.state));
  v = await view();
  assert.equal(v.state, 'recording', v.notice);
  ok(`microphone opened in ${Math.round(v.timings.recordingFeedbackMs)} ms`);
  await ui.waitForTimeout(4200);
  await ui.click('#record');
  await until(v => ['ready', 'error'].includes(v.state), 120000);
  v = await view();
  assert.equal(v.state, 'ready', v.notice);
  assert.match(v.text, /review the changes/i);
  assert.equal(v.delivered, 'kept');
  ok(`transcribed "${v.text}" in ${Math.round(v.timings.stopToReadyMs)} ms after stop`);
  assert.equal(await ui.textContent('#result'), v.text);
  assert.equal(v.stats.sessions, 1);
  assert.ok((await ui.evaluate(() => window.batty.history()))[0].text === v.text);
  ok('result shown, history and stats updated');
  await ui.screenshot({ path: resolve('.local/smoke-home.png') });

  // 3. Overlay never takes focus; cancel discards.
  const overlay = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('overlay.html'));
    return { focusable: w.isFocusable(), focused: w.isFocused() };
  });
  assert.deepEqual(overlay, { focusable: false, focused: false });
  ok('overlay is not focusable');
  await ui.click('#record');
  await until(v => v.state === 'recording');
  await ui.evaluate(() => window.batty.cancel());
  await ui.waitForTimeout(300);
  v = await view();
  assert.equal(v.state, 'cancelled');
  assert.equal(v.text, '');
  ok('cancel discards the recording');

  // 4. Boundaries: the UI window can't impersonate the capture window, and has no network or Node.
  const rejected = await app.evaluate(async ({ BrowserWindow, ipcMain }) => {
    const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('index.html'));
    try {
      await ipcMain._invokeHandlers.get('capture:frame')(
        { sender: w.webContents, senderFrame: w.webContents.mainFrame },
        'x',
        0,
        new Float32Array(320),
      );
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(rejected, true);
  const isolated = await ui.evaluate(async () => {
    let blocked = false;
    try {
      await fetch('https://example.com');
    } catch {
      blocked = true;
    }
    return { blocked, require: typeof globalThis.require, process: typeof globalThis.process };
  });
  assert.deepEqual(isolated, { blocked: true, require: 'undefined', process: 'undefined' });
  ok('IPC roles enforced; renderer has no network and no Node');
  assert.deepEqual(errors, []);
} finally {
  await app.close();
  if (!process.argv.includes('--keep')) await rm(profile, { recursive: true, force: true });
}
console.log(`\n${checks.length} checks passed.`);
