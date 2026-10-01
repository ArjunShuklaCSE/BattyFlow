import {
  app,
  BrowserWindow,
  session as electronSession,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  dialog,
  clipboard,
  globalShortcut,
  powerMonitor,
  protocol,
  net as electronNet,
  screen,
  shell,
  nativeTheme,
} from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AssetKind, Dictionary, Mode, Settings, View } from '../shared/types';
import { catalogItem } from '../shared/catalog';
import { defaults, atomicJson, validateSettings, importManifest, verifyAsset, privateTempRoot } from './settings/store';
import { starter, validateDictionary } from './vocabulary/resolver';
import { denyNodeNetwork } from './privacy/network';
import { Controller } from './controller';
import { History } from './history';
import { Downloader, assetFor, installedIds } from './downloads';
import { ManualPlatform, platformName, type Platform } from './platform';
import { WindowsPlatform } from './platform/windows';

app.setName('BattyFlow');
if (process.env['BATTYFLOW_DATA_DIR']) app.setPath('userData', process.env['BATTYFLOW_DATA_DIR']);
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
protocol.registerSchemesAsPrivileged([
  { scheme: 'batty', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const single = app.requestSingleInstanceLock();
if (!single) app.quit();

const links = {
  repo: 'https://github.com/ArjunShuklaCSE/BattyFlow',
  issues: 'https://github.com/ArjunShuklaCSE/BattyFlow/issues',
  models: 'https://github.com/ArjunShuklaCSE/BattyFlow/blob/main/docs/models.md',
  privacy: 'https://github.com/ArjunShuklaCSE/BattyFlow/blob/main/docs/privacy.md',
} as const;
const renderer = new Set([
  'index.html',
  'overlay.html',
  'capture.html',
  'ui.js',
  'overlay.js',
  'capture.js',
  'worklet.js',
  'style.css',
  'overlay.css',
  'logo.svg',
  'Geist.woff2',
  'GeistMono.woff2',
]);

let settings: Settings = structuredClone(defaults);
let dictionary: Dictionary = structuredClone(starter);
let ui: BrowserWindow;
let overlay: BrowserWindow;
let capture: BrowserWindow;
let tray: Tray | null = null;
let quitting = false;
let shortcutsSuspended = false;
let installed: string[] = [];
let gpu: string | null = null;
let hideTimer: NodeJS.Timeout | null = null;
let devicePending: ((items: { deviceId: string; label: string }[]) => void) | null = null;
let dataRoot: string;
let history: History;
let downloader: Downloader;
let controller: Controller;
let trayState = '';

const nativeHelper = app.isPackaged
  ? join(process.resourcesPath, 'app.asar.unpacked/dist/native/BattyHelper.exe')
  : join(__dirname, '../native/BattyHelper.exe');
const platform: Platform =
  process.platform === 'win32' ? new WindowsPlatform(nativeHelper) : new ManualPlatform(platformName());
const settingsPath = () => join(dataRoot, 'settings.json');
const assetsRoot = () =>
  process.env['BATTYFLOW_DATA_DIR']
    ? join(process.env['BATTYFLOW_DATA_DIR'], 'assets')
    : join(process.env['LOCALAPPDATA'] ?? app.getPath('userData'), 'BattyFlow');

function view(): View {
  return {
    ...controller.view(),
    settings,
    capabilities: platform.capabilities(),
    installed,
    downloads: downloader?.state ?? {},
    stats: history.stats(),
    gpu,
    version: app.getVersion(),
    platform: process.platform,
    engineReady: controller.engineReady,
  };
}

function emit(): void {
  const data = view();
  for (const window of [ui, overlay]) if (window && !window.isDestroyed()) window.webContents.send('view', data);
  const recording = data.state === 'recording' || data.state === 'arming';
  if (tray && trayState !== `${recording}`) {
    trayState = `${recording}`;
    tray.setImage(trayIcon(recording));
    tray.setToolTip(recording ? 'BattyFlow · recording' : 'BattyFlow');
  }
}

// The window draws its own title bar; Windows keeps the caption buttons (and snap layouts), tinted to match.
const chrome = () =>
  nativeTheme.shouldUseDarkColors
    ? { color: '#0c0c10', symbolColor: '#a7a7b3', height: 44 }
    : { color: '#f4f4f7', symbolColor: '#55556a', height: 44 };

function trayIcon(recording: boolean): Electron.NativeImage {
  return nativeImage.createFromPath(join(__dirname, `../${recording ? 'tray-recording' : 'tray'}.png`));
}

// ------------------------------------------------------------------ overlay

function showOverlay(): void {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  // Bottom centre of the screen the pointer is on; it never takes focus from the app you're dictating into.
  const work = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const { width, height } = overlay.getBounds();
  overlay.setPosition(
    Math.round(work.x + Math.max(0, (work.width - width) / 2)),
    Math.round(work.y + Math.max(0, work.height - height - 16)),
  );
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.showInactive();
}

function hideOverlay(ms: number): void {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (controller.idle && !overlay.isDestroyed()) overlay.hide();
  }, ms);
}

// ------------------------------------------------------------------ settings and shortcuts

async function saveSettings(next: Settings): Promise<void> {
  await atomicJson(settingsPath(), next);
  const engineChanged =
    next.threads !== settings.threads ||
    next.gpu !== settings.gpu ||
    next.whisper?.sha256 !== settings.whisper?.sha256 ||
    next.asrModel?.sha256 !== settings.asrModel?.sha256;
  const keysChanged = ['shortcut', 'commandShortcut', 'editShortcut', 'pushToTalk'].some(
    key => next[key as keyof Settings] !== settings[key as keyof Settings],
  );
  const loginChanged = next.launchAtLogin !== settings.launchAtLogin;
  if (next.theme !== settings.theme) nativeTheme.themeSource = next.theme;
  settings = next;
  if (keysChanged) await registerShortcuts();
  if (loginChanged) applyLoginItem();
  if (engineChanged) controller.warm();
  emit();
}

async function registerShortcuts(): Promise<void> {
  globalShortcut.unregisterAll();
  if (shortcutsSuspended) {
    await platform.setPushToTalk('off');
    return;
  }
  const failures: string[] = [];
  for (const [key, mode] of [
    [settings.shortcut, 'dictation'],
    [settings.commandShortcut, 'command'],
    [settings.editShortcut, 'edit'],
  ] as const) {
    try {
      const ok = globalShortcut.register(key, () => {
        void controller.toggle(mode, 'shortcut').catch(() => controller.fail('SHORTCUT_ACTION_FAILED'));
      });
      if (!ok) failures.push(key);
    } catch {
      failures.push(key);
    }
  }
  const ptt = await platform.setPushToTalk(settings.pushToTalk);
  if (failures.length)
    controller.notice = `Another app already uses ${failures.join(', ')}. Pick a different shortcut in Settings.`;
  else if (settings.pushToTalk !== 'off' && !ptt && process.platform === 'win32')
    controller.notice = 'Push-to-talk couldn’t start. The toggle shortcut still works.';
}

function applyLoginItem(): void {
  if (!app.isPackaged || process.platform !== 'win32') return;
  // The portable build runs from a temporary folder; register the .exe the user actually launched.
  const path = process.env['PORTABLE_EXECUTABLE_FILE'] ?? process.execPath;
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, path, args: ['--hidden'] });
}

// ------------------------------------------------------------------ assets

/** Makes an installed catalog item the active runtime or model. */
async function activate(id: string): Promise<void> {
  const item = catalogItem(id);
  if (!item || !installed.includes(id)) throw new Error('ASSET_NOT_INSTALLED');
  if (!controller.idle) throw new Error('CANCEL_SESSION_BEFORE_IMPORT');
  const asset = await assetFor(assetsRoot(), item);
  await verifyAsset(asset, item.kind === 'asrModel' ? 'ggml' : item.kind === 'llmModel' ? 'GGUF' : undefined);
  const next: Settings = { ...settings, [item.kind]: asset };
  if (item.kind === 'whisper') next.gpu = !!item.gpu;
  // An English-only model can't transcribe "auto" or another language.
  if (
    item.kind === 'asrModel' &&
    !(next.language === 'auto' ? asset.languages.length > 1 : asset.languages.includes(next.language))
  )
    next.language = asset.languages.length > 1 ? 'auto' : (asset.languages[0] ?? 'en');
  await saveSettings(validateSettings(next));
}

async function refreshInstalled(): Promise<void> {
  installed = await installedIds(assetsRoot());
  emit();
}

// ------------------------------------------------------------------ IPC

function authorize(event: IpcMainInvokeEvent, role: 'ui' | 'settings' | 'capture'): void {
  const allowed = role === 'capture' ? [capture] : role === 'settings' ? [ui] : [ui, overlay];
  if (
    !allowed.some(w => w && event.sender === w.webContents) ||
    event.senderFrame !== event.sender.mainFrame ||
    !event.senderFrame?.url.startsWith('batty://app/')
  )
    throw new Error('IPC_SENDER_REJECTED');
}

function handler(
  channel: string,
  role: 'ui' | 'settings' | 'capture',
  action: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    authorize(event, role);
    try {
      return await action(event, ...args);
    } catch (error) {
      const message =
        error instanceof Error && /^[A-Z][A-Z_0-9]{1,100}$/.test(error.message) ? error.message : 'OPERATION_FAILED';
      throw new Error(message);
    }
  });
}

function installIPC(): void {
  handler('ui:snapshot', 'ui', () => view());
  handler('ui:toggle', 'ui', (event, mode: Mode | undefined) =>
    controller.toggle(mode ?? settings.mode, event.sender === overlay.webContents ? 'shortcut' : 'ui'),
  );
  handler('ui:cancel', 'ui', () => controller.cancel());
  handler('ui:hide-overlay', 'ui', () => {
    if (!controller.idle) throw new Error('CANCEL_SESSION_BEFORE_DISMISSING');
    overlay.hide();
  });
  handler('ui:overlay-hover', 'ui', (_e, inside: unknown) =>
    overlay.setIgnoreMouseEvents(inside !== true, { forward: true }),
  );
  handler('ui:settings', 'ui', () => {
    ui.show();
    ui.focus();
  });
  handler('ui:copy', 'ui', (_e, id: unknown) => controller.copyResult(id));
  handler('ui:copy-text', 'settings', (_e, text: unknown) => {
    if (typeof text !== 'string' || !text || text.length > 100000) throw new Error('RESULT_UNAVAILABLE');
    clipboard.writeText(text);
  });
  handler('ui:insert-test', 'settings', (_e, id: unknown) => controller.insertTest(id));
  handler('ui:save', 'settings', async (_e, input: unknown) => {
    if (!controller.idle) throw new Error('SESSION_ACTIVE');
    if (JSON.stringify(input).length > 20000) throw new Error('INVALID_SETTINGS');
    const next = validateSettings(input);
    // The renderer never chooses executable paths: assets only change through downloads or the import dialog.
    for (const key of ['whisper', 'asrModel', 'llama', 'llmModel'] as const) {
      delete next[key];
      if (settings[key]) next[key] = settings[key];
    }
    await saveSettings(next);
  });
  handler('ui:import-asset', 'settings', async (_e, kind: unknown) => {
    if (!['whisper', 'asrModel', 'llama', 'llmModel'].includes(kind as string)) throw new Error('INVALID_ASSET');
    if (!controller.idle) throw new Error('CANCEL_SESSION_BEFORE_IMPORT');
    const selected = await dialog.showOpenDialog(ui, {
      title: 'Import an asset manifest',
      filters: [{ name: 'Asset manifest', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (selected.canceled || !selected.filePaths[0]) return;
    const asset = await importManifest(selected.filePaths[0]);
    if (kind === 'asrModel') await verifyAsset(asset, 'ggml');
    if (kind === 'llmModel') await verifyAsset(asset, 'GGUF');
    if ((kind === 'asrModel' || kind === 'llmModel') && !asset.languages.length)
      throw new Error('MODEL_LANGUAGES_REQUIRED');
    await saveSettings(validateSettings({ ...settings, [kind as AssetKind]: asset }));
  });
  handler('ui:download', 'settings', async (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('UNKNOWN_DOWNLOAD');
    await downloader.download(id);
    await refreshInstalled();
    await activate(id);
  });
  handler('ui:cancel-download', 'settings', (_e, id: unknown) => downloader.cancel(String(id)));
  handler('ui:use-asset', 'settings', (_e, id: unknown) => activate(String(id)));
  handler('ui:remove-asset', 'settings', async (_e, id: unknown) => {
    const item = catalogItem(String(id));
    if (!item) throw new Error('ASSET_NOT_INSTALLED');
    if (!controller.idle) throw new Error('CANCEL_SESSION_BEFORE_IMPORT');
    if (settings[item.kind]?.catalogId === item.id) {
      const next = { ...settings };
      delete next[item.kind];
      await saveSettings(next);
    }
    await downloader.remove(item.id);
    await refreshInstalled();
  });
  handler('ui:dictionary', 'settings', () => dictionary);
  handler('ui:save-dictionary', 'settings', async (_e, input: unknown) => {
    if (JSON.stringify(input).length > 1024 * 1024) throw new Error('DICTIONARY_TOO_LARGE');
    const next = validateDictionary(input);
    await atomicJson(join(dataRoot, 'dictionary.json'), next);
    dictionary = structuredClone(next);
  });
  handler('ui:import-dictionary', 'settings', async () => {
    const selected = await dialog.showOpenDialog(ui, {
      filters: [{ name: 'Vocabulary JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    const path = selected.filePaths[0];
    if (!path) return null;
    if ((await stat(path)).size > 1024 * 1024) throw new Error('DICTIONARY_TOO_LARGE');
    return validateDictionary(JSON.parse(await readFile(path, 'utf8')));
  });
  handler('ui:export-dictionary', 'settings', async () => {
    const selected = await dialog.showSaveDialog(ui, { defaultPath: 'battyflow-vocabulary.json' });
    if (selected.filePath) await atomicJson(selected.filePath, dictionary);
  });
  handler('ui:history', 'settings', () => history.list());
  handler('ui:delete-history', 'settings', async (_e, id: unknown) => {
    await history.remove(String(id));
    emit();
  });
  handler('ui:clear-history', 'settings', async () => {
    await history.clear();
    emit();
  });
  handler('ui:suspend-shortcuts', 'settings', async (_e, suspended: unknown) => {
    shortcutsSuspended = suspended === true;
    await registerShortcuts();
  });
  handler('ui:open-link', 'settings', (_e, name: unknown) => {
    const url = links[name as keyof typeof links];
    if (!url) throw new Error('OPERATION_FAILED');
    return shell.openExternal(url);
  });
  handler('ui:devices', 'settings', async () => {
    if (devicePending) throw new Error('DEVICE_REQUEST_PENDING');
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        devicePending = null;
        resolve([]);
      }, 3000);
      devicePending = items => {
        clearTimeout(timer);
        devicePending = null;
        resolve(items);
      };
      capture.webContents.send('devices-request');
    });
  });
  ipcMain.on('devices-response', (event, input: unknown) => {
    if (
      event.sender !== capture.webContents ||
      event.senderFrame !== capture.webContents.mainFrame ||
      !Array.isArray(input) ||
      input.length > 100
    )
      return;
    const items = input.filter(
      (d: unknown): d is { deviceId: string; label: string } =>
        !!d &&
        typeof d === 'object' &&
        typeof (d as any).deviceId === 'string' &&
        typeof (d as any).label === 'string' &&
        (d as any).deviceId.length < 200 &&
        (d as any).label.length < 300,
    );
    devicePending?.(items);
  });
  handler('capture:started', 'capture', (_e, id: unknown, rate: unknown) => controller.started(id, rate));
  handler('capture:frame', 'capture', (_e, id: unknown, index: unknown, frame: unknown) =>
    controller.frame(id, index, frame),
  );
  handler('capture:stopped', 'capture', (_e, id: unknown) => controller.stoppedCapture(id));
  handler('capture:failed', 'capture', (_e, id: unknown, code: unknown) => controller.failedCapture(id, code));
}

// ------------------------------------------------------------------ windows

function makeWindow(kind: 'ui' | 'overlay' | 'capture'): BrowserWindow {
  const isOverlay = kind === 'overlay';
  const window = new BrowserWindow({
    width: isOverlay ? 420 : 1080,
    height: isOverlay ? 96 : 760,
    minWidth: isOverlay ? 420 : 860,
    minHeight: isOverlay ? 96 : 600,
    show: false,
    title: 'BattyFlow',
    icon: join(__dirname, '../icon.png'),
    backgroundColor: isOverlay ? '#00000000' : chrome().color,
    ...(kind === 'ui' ? { titleBarStyle: 'hidden' as const, titleBarOverlay: chrome() } : {}),
    ...(isOverlay
      ? {
          frame: false,
          transparent: true,
          alwaysOnTop: true,
          skipTaskbar: true,
          focusable: false,
          resizable: false,
          hasShadow: false,
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload', `${kind === 'capture' ? 'capture' : 'ui'}.cjs`),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
      spellcheck: false,
      devTools: !app.isPackaged,
      ...(isOverlay ? { autoplayPolicy: 'no-user-gesture-required' as const } : {}),
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', e => e.preventDefault());
  window.webContents.on('will-attach-webview', e => e.preventDefault());
  window.webContents.on('render-process-gone', () => {
    controller.fail('RENDERER_EXITED_RESTART_APP');
    if (kind === 'capture') controller.cancel();
  });
  window.setMenuBarVisibility(false);
  if (isOverlay) window.setIgnoreMouseEvents(true, { forward: true });
  if (kind === 'ui')
    window.on('close', event => {
      if (!quitting && tray) {
        event.preventDefault();
        window.hide();
      } else app.quit();
    });
  return window;
}

async function main(): Promise<void> {
  dataRoot = app.getPath('userData');
  await mkdir(dataRoot, { recursive: true });
  const tempRoot = join(dataRoot, 'sessions');
  await privateTempRoot(tempRoot);
  history = new History(join(dataRoot, 'history.json'));
  controller = new Controller({
    platform,
    history,
    tempRoot,
    settings: () => settings,
    dictionary: () => dictionary,
    sendCapture: command => capture.webContents.send('capture-command', command),
    copy: text => clipboard.writeText(text),
    showOverlay,
    hideOverlay,
    appFocused: () => ui.isVisible() && ui.isFocused(),
    emit,
  });
  for (const item of ['settings', 'dictionary'] as const) {
    try {
      const path = join(dataRoot, `${item}.json`);
      if ((await stat(path)).size > 1024 * 1024) throw new Error('SETTINGS_SIZE');
      const data: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (item === 'settings') settings = validateSettings(data);
      else dictionary = validateDictionary(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        controller.notice = `Your ${item} file couldn’t be read, so defaults are in use. The original file was left untouched.`;
    }
  }
  await history.load();
  nativeTheme.themeSource = settings.theme;
  nativeTheme.on('updated', () => {
    if (ui && !ui.isDestroyed()) ui.setTitleBarOverlay(chrome());
  });

  protocol.handle('batty', request => {
    const url = new URL(request.url);
    const name = url.pathname.slice(1);
    if (url.host !== 'app' || !renderer.has(name) || basename(name) !== name) return new Response('', { status: 403 });
    return electronNet.fetch(pathToFileURL(join(__dirname, '../renderer', name)).toString());
  });
  // The app's own windows can only load the app's own files. Model downloads use a separate session.
  const local = pathToFileURL(join(__dirname, '../renderer')).toString() + '/';
  electronSession.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !details.url.startsWith('batty://app/') && !details.url.startsWith(local) }),
  );
  electronSession.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(
      contents === capture?.webContents &&
        permission === 'media' &&
        'mediaTypes' in details &&
        details.mediaTypes?.every((type: string) => type === 'audio') === true &&
        contents.getURL() === 'batty://app/capture.html',
    ),
  );
  electronSession.defaultSession.setPermissionCheckHandler(
    (contents, permission) =>
      contents === capture?.webContents && permission === 'media' && contents.getURL() === 'batty://app/capture.html',
  );
  downloader = new Downloader(
    assetsRoot(),
    electronSession.fromPartition('battyflow-downloads', { cache: false }),
    emit,
  );

  ui = makeWindow('ui');
  overlay = makeWindow('overlay');
  capture = makeWindow('capture');
  installIPC();
  await Promise.all([
    ui.loadURL('batty://app/index.html'),
    overlay.loadURL('batty://app/overlay.html'),
    capture.loadURL('batty://app/capture.html'),
  ]);
  try {
    const icon = trayIcon(false);
    if (icon.isEmpty()) throw new Error('TRAY_ICON_MISSING');
    tray = new Tray(icon);
    tray.setToolTip('BattyFlow');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Start or stop dictation', click: () => void controller.toggle('dictation', 'tray') },
        { label: 'Cancel recording', click: () => controller.cancel() },
        { type: 'separator' },
        { label: 'Open BattyFlow', click: () => (ui.show(), ui.focus()) },
        { type: 'separator' },
        { label: 'Quit BattyFlow', click: () => app.quit() },
      ]),
    );
    tray.on('click', () => (ui.show(), ui.focus()));
  } catch {
    controller.notice = 'The tray icon isn’t available. Keep this window open to control recording.';
  }
  platform.onPushToTalk = state => controller.pushToTalk(state);
  await registerShortcuts();
  applyLoginItem();
  if (!process.argv.includes('--hidden')) ui.show();
  denyNodeNetwork();
  installed = await installedIds(assetsRoot());
  controller.warm();
  void app
    .getGPUInfo('basic')
    .then(info => {
      const devices = (info as { gpuDevice?: { vendorId: number; deviceString?: string }[] }).gpuDevice ?? [];
      const nvidia = devices.find(device => device.vendorId === 0x10de);
      gpu = nvidia ? (nvidia.deviceString ?? 'NVIDIA GPU') : null;
      emit();
    })
    .catch(() => {});
  emit();
  powerMonitor.on('suspend', () => controller.cancel(true));
  powerMonitor.on('lock-screen', () => controller.cancel(true));
  powerMonitor.on('resume', () => void registerShortcuts().then(emit));
  setInterval(() => controller.tick(), 500).unref();
}

app.on('second-instance', () => {
  ui?.show();
  ui?.focus();
});
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  globalShortcut.unregisterAll();
  void (controller?.shutdown() ?? Promise.resolve()).then(() => {
    platform.dispose();
    tray?.destroy();
    app.quit();
  });
});
app.on('window-all-closed', () => app.quit());
if (single)
  void app
    .whenReady()
    .then(main)
    .catch(() => {
      dialog.showErrorBox(
        'BattyFlow couldn’t start',
        'BattyFlow couldn’t set up its private storage folder. Check the permissions on your AppData folder and try again.',
      );
      quitting = true;
      app.quit();
    });
