import { app, BrowserWindow, session as electronSession, ipcMain, Menu, Tray, nativeImage, dialog, clipboard, globalShortcut, powerMonitor, protocol, net as electronNet, screen } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Asset, Dictionary, Mode, Settings, View } from '../shared/types';
import { Session } from './session';
import { EnergyVad, FRAME, RATE, rms } from '../shared/audio';
import { defaults, atomicJson, validateSettings, importManifest, verifyAsset, privateTempRoot } from './settings/store';
import { starter, validateDictionary } from './vocabulary/resolver';
import { denyNodeNetwork } from './privacy/network';
import { Whisper } from './asr/whisper';
import { Llama } from './llm/llama';
import { PreviewScheduler } from './asr/preview';
import { finalPipeline } from './pipeline';
import { platformAdapter } from './platform';
import { WindowsPlatform } from './platform/windows';

app.setName('BattyFlow');
if (process.env['BATTYFLOW_DATA_DIR']) app.setPath('userData', process.env['BATTYFLOW_DATA_DIR']);
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
protocol.registerSchemesAsPrivileged([{ scheme: 'batty', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const single = app.requestSingleInstanceLock(); if (!single) app.quit();
let settings: Settings = structuredClone(defaults); let dictionary: Dictionary = structuredClone(starter);
let ui: BrowserWindow; let overlay: BrowserWindow; let capture: BrowserWindow; let tray: Tray | null = null;
let quitting = false; let s: Session | null = null; let opening = false; let stopped = false; let launchGeneration = 0;
let pcm = new Float32Array(0); let used = 0; let sequence = 0; let level = 0; let startedAt = 0; let lastFrame = 0; let lastPaint = 0; let lastToggle = 0;
let processing: Promise<void> | null = null; let whisper: Whisper | null = null;
let notice = 'Add a local speech runtime and model in Local models to begin.';
const nativeHelper = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked/dist/native/TargetProbe.exe') : join(__dirname, '../native/TargetProbe.exe');
const platform = process.platform === 'win32' ? new WindowsPlatform(nativeHelper) : platformAdapter(); const vad = new EnergyVad(); const preview = new PreviewScheduler();
let tempRoot: string; let lastPreview = 0; let devicePending: ((items: {deviceId: string;label: string}[]) => void) | null = null;
function view(): View { return { id: s?.id ?? null, state: s?.state ?? 'idle', mode: s?.mode ?? settings.mode, level, elapsed: used / RATE, text: s?.text ?? '', partial: s?.partial ?? '', notice: s?.notice || notice, settings, capabilities: platform.capabilities(), timings: s?.timings ?? {} }; }
function emit(): void {
  const data = view(); for (const window of [ui, overlay]) if (window && !window.isDestroyed()) window.webContents.send('view', data);
  if (tray) tray.setToolTip(`BattyFlow · ${data.state}`);
}
function showOverlay(): void {
  // Reposition on every activation, including after monitor changes. Never take focus.
  const work = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const { width, height } = overlay.getBounds();
  overlay.setPosition(Math.round(work.x + Math.max(0, (work.width - width) / 2)), work.y + Math.max(0, work.height - height - 24));
  overlay.showInactive();
}
function fail(code: string): void {
  if (s && !['idle','cancelled','error'].includes(s.state)) {
    s.controller.abort(); s.text = ''; s.partial = ''; s.state = 'error'; s.notice = code;
    capture?.webContents.send('capture-command', { action: 'cancel', id: s.id });
  } else { notice = code; if (s) s.notice = code; }
  pcm = new Float32Array(0); used = 0; level = 0; void preview.stop(); emit();
}
function cancel(): void {
  launchGeneration++;
  if (s) { s.cancel(); capture.webContents.send('capture-command', { action: 'cancel', id: s.id }); }
  pcm = new Float32Array(0); used = 0; level = 0; void preview.stop(); emit();
}
function stopRecording(): void { if (!s || s.state !== 'recording' || stopped) return; stopped = true; capture.webContents.send('capture-command', { action: 'stop', id: s.id }); }
async function toggle(mode: Mode = settings.mode): Promise<void> {
  if (Date.now() - lastToggle < 300) return; lastToggle = Date.now();
  if (s?.state === 'recording') { stopRecording(); return; }
  if (s?.state === 'arming') { cancel(); return; }
  if (opening || processing || s?.state === 'inserting') return;
  if (!['dictation','edit','command','translation'].includes(mode)) throw new Error('INVALID_MODE');
  opening = true;
  const generation = ++launchGeneration;
  const activationAt = Date.now();
  try {
    if (s?.alive()) s.cancel();
    const target = await platform.capture(mode === 'edit');
    if (generation !== launchGeneration || quitting) return;
    s = new Session(mode, target); stopped = false; sequence = 0; used = 0; level = 0; lastPreview = 0; vad.reset();
    startedAt = activationAt;
    s.timings['targetCaptureMs'] = Date.now() - activationAt;
    s.notice = 'Preparing microphone…';
    showOverlay(); s.timings['overlayShownMs'] = Date.now() - activationAt; emit();
    if (!settings.whisper || !settings.asrModel) { fail('Speech setup is incomplete. Open Local models and import the Whisper 1.8.3 runtime and a speech model.'); return; }
    if (mode !== 'dictation' && (!settings.llama || !settings.llmModel)) { fail('This mode needs a local transformation model. Add it in Local models, or choose Dictation.'); return; }
    if (mode === 'translation' && !settings.translationPairs.includes(`${settings.language}:${settings.targetLanguage}`)) { fail('This translation pair has not been configured and verified.'); return; }
    if (mode === 'edit') {
      const selection = await platform.read(target);
      if (generation !== launchGeneration || quitting) return;
      if (!selection) { fail('No valid selection is available. Select text in a supported app and try again.'); return; }
    }
    whisper = new Whisper(settings.whisper, settings.asrModel, tempRoot, settings.threads);
    pcm = new Float32Array(settings.maxSeconds * RATE); startedAt = activationAt; lastFrame = Date.now();
    capture.webContents.send('capture-command', { action: 'start', id: s.id, device: settings.microphone, maxSeconds: settings.maxSeconds });
  } finally { opening = false; }
}
function authorize(event: IpcMainInvokeEvent, role: 'ui' | 'settings' | 'capture'): void {
  const allowed = role === 'capture' ? [capture] : role === 'settings' ? [ui] : [ui, overlay];
  if (!allowed.some(w => w && event.sender === w.webContents) || event.senderFrame !== event.sender.mainFrame || !event.senderFrame.url.startsWith('batty://app/')) throw new Error('IPC_SENDER_REJECTED');
}
function handler(channel: string, role: 'ui' | 'settings' | 'capture', action: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    authorize(event, role);
    try { return await action(event, ...args); }
    catch (error) { const message = error instanceof Error && /^[A-Z][A-Z_0-9]{1,100}$/.test(error.message) ? error.message : 'OPERATION_FAILED'; throw new Error(message); }
  });
}
function registerShortcuts(): void {
  globalShortcut.unregisterAll(); const failures: string[] = [];
  for (const [key, mode] of [[settings.shortcut, 'dictation'],[settings.commandShortcut, 'command'],[settings.editShortcut, 'edit']] as const) {
    try { if (!globalShortcut.register(key, () => { void toggle(mode).catch(() => fail('SHORTCUT_ACTION_FAILED')); })) failures.push(key); } catch { failures.push(key); }
  }
  if (failures.length) notice = `Shortcut registration failed: ${failures.join(', ')}. Rebind in settings; tray and app controls remain available.`;
}
function installIPC(): void {
  handler('ui:snapshot', 'ui', () => view());
  handler('ui:toggle', 'ui', (_e, mode: Mode | undefined) => toggle(mode));
  handler('ui:cancel', 'ui', () => cancel());
  handler('ui:hide-overlay', 'ui', () => { if (opening || processing || s?.alive()) throw new Error('CANCEL_SESSION_BEFORE_DISMISSING'); overlay.hide(); });
  handler('ui:settings', 'ui', () => { ui.show(); });
  handler('ui:copy', 'ui', (_e, id: unknown) => {
    if (typeof id !== 'string' || id !== s?.id || s.controller.signal.aborted || !['ready','idle'].includes(s.state) || !s.text) throw new Error('RESULT_UNAVAILABLE');
    // Explicit persistent copy is user delivery, not a temporary clipboard-assisted paste.
    clipboard.writeText(s.text); s.notice = 'Copied. Choose the intended field and paste manually. No keys were sent.'; emit();
  });
  handler('ui:insert-test', 'settings', (_e, id: unknown) => {
    if (typeof id !== 'string' || id !== s?.id || !s.text) throw new Error('RESULT_UNAVAILABLE');
    s.claimInsertion(); const text = s.text; s.move('idle'); s.notice = 'Delivered to the in-app test field.'; emit(); return text;
  });
  handler('ui:save', 'settings', async (_e, input: unknown) => {
    if (opening || (s?.alive() && s.state !== 'ready')) throw new Error('SESSION_ACTIVE');
    if (JSON.stringify(input).length > 20000) throw new Error('SETTINGS_TOO_LARGE');
    const next = validateSettings(input);
    // Renderer cannot set an executable path; asset updates only happen through native import dialogs.
    for (const key of ['whisper','asrModel','llama','llmModel'] as const) { delete next[key]; if (settings[key]) next[key] = settings[key]; }
    await atomicJson(join(app.getPath('userData'), 'settings.json'), next); settings = next; registerShortcuts(); emit();
  });
  handler('ui:import-asset', 'settings', async (_e, kind: unknown) => {
    if (!['whisper','asrModel','llama','llmModel'].includes(kind as string)) throw new Error('INVALID_ASSET_KIND');
    if (opening || s?.alive()) throw new Error('CANCEL_SESSION_BEFORE_IMPORT');
    const selected = await dialog.showOpenDialog(ui, { title: 'Import local asset manifest (JSON)', filters: [{ name: 'Asset manifest', extensions: ['json'] }], properties: ['openFile'] });
    if (selected.canceled || !selected.filePaths[0]) return;
    const asset = await importManifest(selected.filePaths[0]);
    if (kind === 'asrModel') await verifyAsset(asset, 'ggml');
    if (kind === 'llmModel') await verifyAsset(asset, 'GGUF');
    if (kind === 'whisper' && asset.version !== '1.8.3') throw new Error('WHISPER_VERSION_REQUIRES_1_8_3');
    if (kind === 'llama' && asset.version !== 'b6532') throw new Error('LLAMA_VERSION_REQUIRES_B6532');
    if ((kind === 'asrModel' || kind === 'llmModel') && !asset.languages.length) throw new Error('MODEL_LANGUAGES_REQUIRED');
    settings = { ...settings, [kind as string]: asset }; await atomicJson(join(app.getPath('userData'), 'settings.json'), settings);
    notice = settings.whisper && settings.asrModel ? 'Ready to record locally. Press Start recording or your dictation shortcut.' : 'Asset verified. Add the remaining speech runtime or model to start recording.';
    if (s && !s.alive()) s.notice = notice;
    emit();
  });
  handler('ui:dictionary', 'settings', () => dictionary);
  handler('ui:save-dictionary', 'settings', async (_e, input: unknown) => {
    if (JSON.stringify(input).length > 1024 * 1024) throw new Error('DICTIONARY_TOO_LARGE');
    const next = validateDictionary(input); await atomicJson(join(app.getPath('userData'), 'dictionary.json'), next); dictionary = structuredClone(next);
  });
  handler('ui:import-dictionary', 'settings', async () => {
    const selected = await dialog.showOpenDialog(ui, { filters: [{ name: 'Dictionary JSON', extensions: ['json'] }], properties: ['openFile'] });
    const path = selected.filePaths[0]; if (!path) return null;
    if ((await stat(path)).size > 1024 * 1024) throw new Error('DICTIONARY_TOO_LARGE');
    return validateDictionary(JSON.parse(await readFile(path, 'utf8')));
  });
  handler('ui:export-dictionary', 'settings', async () => { const selected = await dialog.showSaveDialog(ui, { defaultPath: 'battyflow-dictionary.json' }); if (selected.filePath) await atomicJson(selected.filePath, dictionary); });
  handler('ui:devices', 'settings', async () => {
    if (devicePending) throw new Error('DEVICE_REQUEST_PENDING');
    return new Promise(resolve => { const timer = setTimeout(() => { devicePending = null; resolve([]); }, 3000); devicePending = items => { clearTimeout(timer); devicePending = null; resolve(items); }; capture.webContents.send('devices-request'); });
  });
  ipcMain.on('devices-response', (event, input: unknown) => {
    if (event.sender !== capture.webContents || event.senderFrame !== capture.webContents.mainFrame || !Array.isArray(input) || input.length > 100) return;
    const items = input.filter((d: unknown): d is {deviceId: string;label: string} => !!d && typeof d === 'object' && typeof (d as any).deviceId === 'string' && typeof (d as any).label === 'string' && (d as any).deviceId.length < 200 && (d as any).label.length < 300); devicePending?.(items);
  });
  handler('capture:started', 'capture', (_e, id: unknown, rate: unknown) => {
    if (!s || id !== s.id || !s.alive() || s.state !== 'arming') { if (typeof id === 'string') capture.webContents.send('capture-command', { action: 'cancel', id }); return; }
    if (typeof rate !== 'number' || rate < 8000 || rate > 192000) { fail('UNSUPPORTED_SAMPLE_RATE'); return; }
    s.timings['captureRate'] = rate; s.timings['recordingFeedbackMs'] = Date.now() - startedAt; s.move('recording'); s.notice = 'Recording locally. Stop to transcribe, or Cancel to discard.'; startedAt = Date.now(); lastFrame = Date.now(); emit();
  });
  handler('capture:frame', 'capture', (_e, id: unknown, index: unknown, frame: unknown) => {
    if (!s || id !== s.id || !s.alive() || !['arming','recording'].includes(s.state)) return false;
    if (!Number.isInteger(index) || index !== sequence || !(frame instanceof Float32Array) || frame.length < 1 || frame.length > FRAME || frame.some(x => !Number.isFinite(x) || Math.abs(x) > 1.001)) { fail('INVALID_AUDIO_FRAME'); return false; }
    sequence++; lastFrame = Date.now();
    if (used + frame.length > pcm.length) { stopRecording(); return true; }
    pcm.set(frame, used); used += frame.length; level = rms(frame); vad.accept(frame);
    if (settings.silenceStop && vad.hasSpeech && vad.silenceFrames > 75) stopRecording();
    if (Date.now() - lastPaint > 80) { lastPaint = Date.now(); emit(); }
    if (settings.preview && s.state === 'recording' && !stopped && used - lastPreview >= RATE * 4 && vad.hasSpeech && whisper) {
      const active = s; const engine = whisper; const audio = pcm.slice(Math.max(0, used - RATE * 12), used); lastPreview = used;
      preview.offer(signal => engine.transcribe(audio, settings.language, signal), text => { if (s === active && active.alive() && active.state === 'recording' && !stopped) { active.partial = text; active.timings['firstPreviewMs'] ??= Date.now() - startedAt; emit(); } });
    }
    return true;
  });
  handler('capture:stopped', 'capture', (_e, id: unknown) => {
    if (!s || id !== s.id || !s.alive() || s.state !== 'recording' || processing) return;
    const active = s; active.move('transcribing'); const stop = performance.now(); active.partial = ''; active.notice = 'Transcribing locally…'; level = 0; emit();
    const audio = pcm.slice(0, used); pcm = new Float32Array(0);
    processing = (async () => {
      await preview.stop(); if (!active.alive() || !whisper) return;
      const llm = settings.llama && settings.llmModel ? new Llama(settings.llama, settings.llmModel, tempRoot, settings.threads) : null;
      await finalPipeline(active, audio, whisper, llm, structuredClone(dictionary), structuredClone(settings), emit);
      if (active.mode === 'edit' && active.alive() && !await platform.validate(active.target)) active.notice = 'The original selection is stale or cannot be verified. Review and copy the proposed edit manually; no replacement was attempted.';
      if (active.alive()) { active.timings['stopToReadyMs'] = performance.now() - stop; emit(); }
    })().catch(error => { if (s === active && active.alive()) fail(error instanceof Error && /^[A-Z_0-9]+$/.test(error.message) ? error.message : 'TRANSCRIPTION_FAILED'); }).finally(() => { audio.fill(0); processing = null; });
  });
  handler('capture:failed', 'capture', (_e, id: unknown, code: unknown) => { if (s && id === s.id && s.alive()) fail(typeof code === 'string' && /^[A-Z_]{1,80}$/.test(code) ? code : 'CAPTURE_FAILED'); });
}
function makeWindow(kind: 'ui' | 'overlay' | 'capture'): BrowserWindow {
  const isOverlay = kind === 'overlay';
  const window = new BrowserWindow({ width: isOverlay ? 520 : 1060, height: isOverlay ? 300 : 810, minWidth: isOverlay ? 400 : 800, minHeight: isOverlay ? 250 : 600, show: false, title: 'BattyFlow', backgroundColor: '#101719', ...(isOverlay ? { frame: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false } : {}), webPreferences: { preload: join(__dirname, '../preload', `${kind === 'capture' ? 'capture' : 'ui'}.cjs`), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, spellcheck: false, devTools: !app.isPackaged } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', e => e.preventDefault());
  window.webContents.on('will-attach-webview', e => e.preventDefault());
  window.webContents.on('render-process-gone', () => { fail('RENDERER_EXITED_RESTART_APP'); if (kind === 'capture') cancel(); });
  window.setMenuBarVisibility(false);
  if (kind === 'ui') window.on('close', event => { if (!quitting && tray) { event.preventDefault(); window.hide(); } else app.quit(); });
  return window;
}
async function main(): Promise<void> {
  const dataRoot = app.getPath('userData'); await mkdir(dataRoot, { recursive: true }); tempRoot = join(dataRoot, 'sessions');
  await privateTempRoot(tempRoot);
  for (const item of ['settings','dictionary'] as const) {
    try {
      const path = join(dataRoot, `${item}.json`); if ((await stat(path)).size > 1024*1024) throw new Error('SETTINGS_SIZE');
      const data: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (item === 'settings') settings = validateSettings(data); else dictionary = validateDictionary(data);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') notice = 'A settings or dictionary file could not be loaded. Defaults are active; original file preserved.'; }
  }
  if (settings.whisper && settings.asrModel && notice.startsWith('Add a local')) notice = 'Ready to record locally. Press Start recording or your dictation shortcut.';
  const files = new Set(['index.html','capture.html','ui.js','capture.js','worklet.js','style.css']);
  protocol.handle('batty', request => {
    const url = new URL(request.url); const name = url.pathname.slice(1);
    if (url.host !== 'app' || !files.has(name) || basename(name) !== name) return new Response('', { status: 403 });
    return electronNet.fetch(pathToFileURL(join(__dirname, '../renderer', name)).toString());
  });
  electronSession.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('batty://app/') && !details.url.startsWith(pathToFileURL(join(__dirname, '../renderer')).toString() + '/') }));
  electronSession.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(contents === capture?.webContents && permission === 'media' && 'mediaTypes' in details && details.mediaTypes?.every((type: string) => type === 'audio') === true && contents.getURL() === 'batty://app/capture.html'));
  electronSession.defaultSession.setPermissionCheckHandler((contents, permission) => contents === capture?.webContents && permission === 'media' && contents.getURL() === 'batty://app/capture.html');
  ui = makeWindow('ui'); overlay = makeWindow('overlay'); capture = makeWindow('capture'); installIPC();
  await Promise.all([ui.loadURL('batty://app/index.html'), overlay.loadURL('batty://app/index.html?overlay=1'), capture.loadURL('batty://app/capture.html')]);
  try {
    const icon = nativeImage.createFromPath(join(__dirname, '../icon.png')).resize({ width: 24, height: 24 });
    if (icon.isEmpty()) throw new Error('TRAY_ICON_MISSING');
    tray = new Tray(icon); tray.setToolTip('BattyFlow');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Start / stop dictation', click: () => { void toggle('dictation'); } }, { label: 'Cancel session', click: cancel }, { type: 'separator' }, { label: 'Settings & model status', click: () => ui.show() }, { label: 'Quit', click: () => app.quit() }])); tray.on('click', () => ui.show());
  } catch { notice = 'Tray unavailable. Keep the app open to use recording and cancellation controls.'; }
  registerShortcuts(); ui.show(); emit(); denyNodeNetwork();
  powerMonitor.on('suspend', cancel); powerMonitor.on('lock-screen', cancel); powerMonitor.on('resume', () => { registerShortcuts(); emit(); });
  setInterval(() => {
    if (s?.state === 'arming' && Date.now()-startedAt > 30000) fail('MICROPHONE_PERMISSION_TIMEOUT');
    if (s?.state === 'recording') {
      if (Date.now()-lastFrame > 4000) fail('MICROPHONE_NO_FRAMES');
      else if (Date.now()-startedAt >= settings.maxSeconds*1000) stopRecording();
    }
  }, 500).unref();
}
app.on('second-instance', () => ui?.show());
app.on('before-quit', event => {
  if (!quitting) {
    event.preventDefault(); quitting = true; cancel(); globalShortcut.unregisterAll();
    void Promise.allSettled([processing, preview.stop()]).then(() => { tray?.destroy(); app.quit(); });
  }
});
app.on('window-all-closed', () => app.quit());
if (single) void app.whenReady().then(main).catch(() => { dialog.showErrorBox('BattyFlow startup failed', 'Private storage or desktop initialization failed. Check local folder permissions and restart.'); quitting = true; app.quit(); });
