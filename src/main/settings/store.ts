import { mkdir, readFile, writeFile, rename, rm, readdir, stat, realpath, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import type { Asset, Settings } from '../../shared/types';
import { catalog } from '../../shared/catalog';
import { localPath, runProcess } from '../privacy/process';

export const defaults: Settings = {
  schemaVersion: 2,
  microphone: '',
  language: 'en',
  profile: 'neutral',
  autoProfile: true,
  mode: 'dictation',
  pushToTalk: 'ctrl-win',
  shortcut: 'CommandOrControl+Alt+D',
  commandShortcut: 'CommandOrControl+Alt+J',
  editShortcut: 'CommandOrControl+Alt+E',
  maxSeconds: 120,
  silenceStop: false,
  preview: false,
  delivery: 'paste',
  restoreClipboard: true,
  trailingSpace: true,
  removeFillers: true,
  vocabularyPrompt: true,
  polish: false,
  history: true,
  sounds: true,
  launchAtLogin: false,
  theme: 'dark',
  // whisper.cpp stops scaling well past 8 threads; leave the rest of the machine responsive.
  threads: Math.min(8, Math.max(2, Math.floor(availableParallelism() / 2))),
  gpu: true,
  targetLanguage: 'es',
  translationPairs: [],
};

const profiles = ['neutral', 'chat', 'email', 'code', 'terminal'];
const modes = ['dictation', 'edit', 'command', 'translation'];
const pushToTalk = ['ctrl-win', 'right-ctrl', 'right-alt', 'caps-lock', 'off'];
const deliveries = ['paste', 'copy', 'none'];
const themes = ['dark', 'light', 'system'];
const flags = [
  'autoProfile',
  'silenceStop',
  'preview',
  'restoreClipboard',
  'trailingSpace',
  'removeFillers',
  'vocabularyPrompt',
  'polish',
  'history',
  'sounds',
  'launchAtLogin',
  'gpu',
] as const;
// Two modifiers keep global shortcuts from stealing everyday app shortcuts such as Ctrl+D.
const accelerator =
  /^(?:(?:CommandOrControl|Command|Control|Ctrl|Alt|Shift|Super)\+){2,}(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Space)$/i;

export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

/** Settings written by 0.1 used schema 1; carry the user's choices forward. Options added later get their
 * defaults, so an older settings file never resets everything. */
function migrate(input: object): object {
  const old = input as Record<string, unknown>;
  if (old['schemaVersion'] === 1) {
    const { rawFallback: _raw, context: _context, ...kept } = old;
    return { ...defaults, ...kept, schemaVersion: 2 };
  }
  return old['schemaVersion'] === 2 ? { ...defaults, ...old } : input;
}

export function validateSettings(input: unknown): Settings {
  if (!input || typeof input !== 'object') throw new Error('INVALID_SETTINGS');
  const s = migrate(input) as Settings;
  if (
    s.schemaVersion !== 2 ||
    !profiles.includes(s.profile) ||
    !modes.includes(s.mode) ||
    !pushToTalk.includes(s.pushToTalk) ||
    !deliveries.includes(s.delivery) ||
    !themes.includes(s.theme) ||
    !Number.isInteger(s.maxSeconds) ||
    s.maxSeconds < 10 ||
    s.maxSeconds > 300 ||
    !Number.isInteger(s.threads) ||
    s.threads < 1 ||
    s.threads > 32
  )
    throw new Error('INVALID_SETTINGS');
  for (const k of ['microphone', 'language', 'targetLanguage', 'shortcut', 'commandShortcut', 'editShortcut'] as const)
    if (typeof s[k] !== 'string' || s[k].length > 200) throw new Error('INVALID_SETTINGS');
  for (const k of flags) if (typeof s[k] !== 'boolean') throw new Error('INVALID_SETTINGS');
  if (!/^(?:auto|[a-z]{2,3})$/.test(s.language) || !/^[a-z]{2,3}$/.test(s.targetLanguage))
    throw new Error('INVALID_LANGUAGE');
  const shortcuts = [s.shortcut, s.commandShortcut, s.editShortcut];
  if (new Set(shortcuts.map(x => x.toLowerCase())).size !== 3 || shortcuts.some(x => !accelerator.test(x)))
    throw new Error('SHORTCUT_REQUIRES_TWO_MODIFIERS_AND_UNIQUE_KEY');
  if (
    !Array.isArray(s.translationPairs) ||
    s.translationPairs.length > 50 ||
    s.translationPairs.some(x => typeof x !== 'string' || !/^[a-z]{2,3}:[a-z]{2,3}$/.test(x))
  )
    throw new Error('INVALID_LANGUAGE_PAIRS');
  for (const k of ['whisper', 'asrModel', 'llama', 'llmModel'] as const) if (s[k]) validateAsset(s[k]);
  const known = new Set<string>([...Object.keys(defaults), 'whisper', 'asrModel', 'llama', 'llmModel']);
  return Object.fromEntries(Object.entries(structuredClone(s)).filter(([key]) => known.has(key))) as Settings;
}

export function validateAsset(value: unknown): Asset {
  const a = value as Asset;
  if (
    !a ||
    typeof a.path !== 'string' ||
    !localPath(a.path) ||
    typeof a.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(a.sha256) ||
    !Number.isSafeInteger(a.size) ||
    a.size < 4 ||
    a.size > 20 * 1024 ** 3
  )
    throw new Error('INVALID_ASSET');
  for (const key of ['name', 'provenance', 'license', 'version'] as const)
    if (typeof a[key] !== 'string' || !a[key].trim() || a[key].length > 1000)
      throw new Error('ASSET_METADATA_REQUIRED');
  if (
    !Array.isArray(a.languages) ||
    a.languages.length > 128 ||
    a.languages.some(x => typeof x !== 'string' || !/^[a-z]{2,3}$/.test(x))
  )
    throw new Error('ASSET_LANGUAGES_REQUIRED');
  if (
    (a.catalogId !== undefined && typeof a.catalogId !== 'string') ||
    (a.gpu !== undefined && typeof a.gpu !== 'boolean')
  )
    throw new Error('INVALID_ASSET');
  if (
    a.dependencies !== undefined &&
    (!Array.isArray(a.dependencies) ||
      a.dependencies.length > 100 ||
      a.dependencies.some(
        d =>
          !d ||
          typeof d.file !== 'string' ||
          basename(d.file) !== d.file ||
          /[\\/:]/.test(d.file) ||
          typeof d.sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(d.sha256) ||
          !Number.isSafeInteger(d.size) ||
          d.size < 1,
      ))
  )
    throw new Error('INVALID_RUNTIME_DEPENDENCIES');
  return a;
}

export async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

// Hashing a 500 MB model takes about a second. Hash each file once per app run, then trust it while its
// size and modification time stay the same.
const verified = new Map<string, string>();
const hashing = new Map<string, Promise<void>>();
async function verifyFile(path: string, size: number, expected: string, error: string): Promise<void> {
  const info = await stat(path);
  if (!info.isFile() || info.size !== size) throw new Error(error);
  const key = `${path}|${info.size}|${info.mtimeMs}`;
  if (verified.get(key) === expected) return;
  let pending = hashing.get(key);
  if (!pending) {
    pending = sha256(path).then(actual => {
      if (actual === expected) verified.set(key, expected);
    });
    hashing.set(key, pending);
    void pending.finally(() => hashing.delete(key)).catch(() => {});
  }
  await pending;
  if (verified.get(key) !== expected) throw new Error(error);
}

export async function verifyAsset(asset: Asset, magic?: 'ggml' | 'GGUF'): Promise<void> {
  validateAsset(asset);
  const resolved = await realpath(asset.path);
  if (!localPath(resolved)) throw new Error('ASSET_CHECKSUM_MISMATCH');
  // A file named like a catalog download must be that exact download.
  const known = catalog.find(item => !item.entry && basename(new URL(item.url).pathname) === basename(resolved));
  if (known && (asset.sha256 !== known.sha256 || asset.size !== known.size))
    throw new Error('TRUSTED_MODEL_MANIFEST_MISMATCH');
  await verifyFile(resolved, asset.size, asset.sha256, 'ASSET_CHECKSUM_MISMATCH');
  for (const dependency of asset.dependencies ?? [])
    await verifyFile(
      join(dirname(resolved), dependency.file),
      dependency.size,
      dependency.sha256,
      'RUNTIME_DEPENDENCY_CHECKSUM_MISMATCH',
    );
  if (magic) {
    const file = await open(resolved, 'r');
    const head = Buffer.alloc(4);
    try {
      await file.read(head, 0, 4, 0);
    } finally {
      await file.close();
    }
    if (magic === 'ggml' ? head.readUInt32LE(0) !== 0x67676d6c : head.toString('ascii') !== 'GGUF')
      throw new Error('INCOMPATIBLE_MODEL_FORMAT');
  }
}

export async function importManifest(path: string): Promise<Asset> {
  if ((await stat(path)).size > 16384) throw new Error('MANIFEST_TOO_LARGE');
  const asset = JSON.parse(await readFile(path, 'utf8')) as Asset;
  if (typeof asset.path !== 'string') throw new Error('INVALID_ASSET');
  asset.path = resolve(dirname(path), asset.path);
  validateAsset(asset);
  await verifyAsset(asset);
  return asset;
}

export async function privateTempRoot(root: string): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    // Only the current user and SYSTEM may read temporary audio. The SID comes from whoami.
    const system = process.env['SystemRoot'] ?? 'C:\\Windows';
    const who = await runProcess(join(system, 'System32', 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], {
      signal: new AbortController().signal,
      timeoutMs: 5000,
    });
    const sid = who.stdout.match(/S-1-5-[\d-]+/)?.[0];
    if (!sid) throw new Error('PRIVATE_STORAGE_ACL_FAILED');
    await runProcess(
      join(system, 'System32', 'icacls.exe'),
      [root, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'],
      { signal: new AbortController().signal, timeoutMs: 5000 },
    );
  }
  for (const name of await readdir(root)) {
    if (!/^session-[a-f0-9-]{36}$/.test(name)) continue;
    const target = join(root, name);
    if (dirname(target) !== root) throw new Error('TEMP_PATH');
    await rm(target, { recursive: true, force: true });
  }
}
