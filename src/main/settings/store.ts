import { mkdir, readFile, writeFile, rename, rm, readdir, stat, realpath, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, dirname, resolve, basename } from 'node:path';
import type { Asset, Settings } from '../../shared/types';
import { localPath, runProcess } from '../privacy/process';
import { trustedModels } from '../../shared/trusted-models';
export const defaults: Settings = { schemaVersion: 1, microphone: '', language: 'en', profile: 'neutral', mode: 'dictation', shortcut: 'CommandOrControl+Alt+D', commandShortcut: 'CommandOrControl+Alt+J', editShortcut: 'CommandOrControl+Alt+E', maxSeconds: 120, silenceStop: false, rawFallback: false, preview: false, context: false, threads: 4, targetLanguage: 'es', translationPairs: [] };
export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}
export function validateSettings(input: unknown): Settings {
  if (!input || typeof input !== 'object') throw new Error('INVALID_SETTINGS');
  const s = input as Settings;
  if (s.schemaVersion !== 1 || !['neutral','chat','email','code','terminal'].includes(s.profile) || !['dictation','edit','command','translation'].includes(s.mode) || !Number.isInteger(s.maxSeconds) || s.maxSeconds < 10 || s.maxSeconds > 180 || !Number.isInteger(s.threads) || s.threads < 1 || s.threads > 16) throw new Error('INVALID_SETTINGS');
  for (const k of ['microphone','language','targetLanguage','shortcut','commandShortcut','editShortcut'] as const) if (typeof s[k] !== 'string' || s[k].length > 200) throw new Error('INVALID_SETTINGS');
  for (const k of ['silenceStop','rawFallback','preview','context'] as const) if (typeof s[k] !== 'boolean') throw new Error('INVALID_SETTINGS');
  if (!/^[a-z]{2,3}$/.test(s.language) || !/^[a-z]{2,3}$/.test(s.targetLanguage)) throw new Error('INVALID_LANGUAGE');
  const shortcuts = [s.shortcut, s.commandShortcut, s.editShortcut];
  if (new Set(shortcuts.map(x => x.toLowerCase())).size !== 3 || shortcuts.some(x => !/^(?:(?:CommandOrControl|Command|Control|Alt|Shift|Super)\+){2,}[A-Za-z0-9]$/.test(x))) throw new Error('SHORTCUT_REQUIRES_TWO_MODIFIERS_AND_UNIQUE_KEY');
  if (!Array.isArray(s.translationPairs) || s.translationPairs.length > 50 || s.translationPairs.some(x => typeof x !== 'string' || !/^[a-z]{2,3}:[a-z]{2,3}$/.test(x))) throw new Error('INVALID_LANGUAGE_PAIRS');
  for (const k of ['whisper','asrModel','llama','llmModel'] as const) if (s[k]) validateAsset(s[k]);
  return structuredClone(s);
}
export function validateAsset(value: unknown): Asset {
  const a = value as Asset;
  if (!a || typeof a.path !== 'string' || !localPath(a.path) || typeof a.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(a.sha256) || !Number.isSafeInteger(a.size) || a.size < 4 || a.size > 20 * 1024 ** 3) throw new Error('INVALID_ASSET');
  for (const key of ['name','provenance','license','version'] as const) if (typeof a[key] !== 'string' || !a[key].trim() || a[key].length > 1000) throw new Error('ASSET_METADATA_REQUIRED');
  if (!Array.isArray(a.languages) || a.languages.length > 100 || a.languages.some(x => typeof x !== 'string' || !/^[a-z]{2,3}$/.test(x))) throw new Error('ASSET_LANGUAGES_REQUIRED');
  if (a.dependencies !== undefined && (!Array.isArray(a.dependencies) || a.dependencies.length > 100 || a.dependencies.some(d => !d || typeof d.file !== 'string' || basename(d.file) !== d.file || /[\\/:]/.test(d.file) || typeof d.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(d.sha256) || !Number.isSafeInteger(d.size) || d.size < 1))) throw new Error('INVALID_RUNTIME_DEPENDENCIES');
  return a;
}
export async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer); return hash.digest('hex');
}
export async function verifyAsset(asset: Asset, magic?: 'ggml' | 'GGUF'): Promise<void> {
  validateAsset(asset); const resolved = await realpath(asset.path);
  const trusted = trustedModels[basename(resolved)];
  if (trusted && (asset.sha256 !== trusted.sha256 || asset.size !== trusted.size || asset.languages.some(language => !trusted.languages.includes(language)))) throw new Error('TRUSTED_MODEL_MANIFEST_MISMATCH');
  if (!localPath(resolved) || !((await stat(resolved)).isFile()) || (await stat(resolved)).size !== asset.size || await sha256(resolved) !== asset.sha256) throw new Error('ASSET_CHECKSUM_MISMATCH');
  for (const dependency of asset.dependencies ?? []) {
    const path = join(dirname(resolved), dependency.file);
    if ((await stat(path)).size !== dependency.size || await sha256(path) !== dependency.sha256) throw new Error('RUNTIME_DEPENDENCY_CHECKSUM_MISMATCH');
  }
  if (magic) {
    const file = await open(resolved, 'r'); const head = Buffer.alloc(4);
    try { await file.read(head, 0, 4, 0); } finally { await file.close(); }
    if (magic === 'ggml' ? head.readUInt32LE(0) !== 0x67676d6c : head.toString('ascii') !== 'GGUF') throw new Error('INCOMPATIBLE_MODEL_FORMAT');
  }
}
export async function importManifest(path: string): Promise<Asset> {
  if ((await stat(path)).size > 16384) throw new Error('MANIFEST_TOO_LARGE');
  const asset = JSON.parse(await readFile(path, 'utf8')) as Asset;
  if (typeof asset.path !== 'string') throw new Error('INVALID_ASSET');
  asset.path = resolve(dirname(path), asset.path); validateAsset(asset); await verifyAsset(asset); return asset;
}
export async function privateTempRoot(root: string): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    // Account SID is read from whoami; no names or content are logged.
    const system = process.env['SystemRoot'] ?? 'C:\\Windows';
    const who = await runProcess(join(system, 'System32', 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { signal: new AbortController().signal, timeoutMs: 5000 });
    const sid = who.stdout.match(/S-1-5-[\d-]+/)?.[0]; if (!sid) throw new Error('PRIVATE_STORAGE_ACL_FAILED');
    await runProcess(join(system, 'System32', 'icacls.exe'), [root, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { signal: new AbortController().signal, timeoutMs: 5000 });
  }
  for (const name of await readdir(root)) {
    if (!/^session-[a-f0-9-]{36}$/.test(name)) continue;
    const target = join(root, name); if (dirname(target) !== root) throw new Error('TEMP_PATH');
    await rm(target, { recursive: true, force: true });
  }
}
