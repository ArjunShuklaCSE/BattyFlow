import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { once } from 'node:events';
import { basename, dirname, join } from 'node:path';
import type { Session } from 'electron';
import type { Asset, DownloadState } from '../shared/types';
import { catalog, catalogItem, type CatalogItem } from '../shared/catalog';
import { runProcess } from './privacy/process';
import { sha256 } from './settings/store';

// Only these hosts, only HTTPS. Release assets and model files redirect to the publishers' CDNs.
const hosts = [
  /^github\.com$/,
  /^(objects|release-assets)\.githubusercontent\.com$/,
  /(^|\.)huggingface\.co$/,
  /(^|\.)hf\.co$/,
];
export const allowedUrl = (url: string): boolean => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && hosts.some(host => host.test(u.hostname));
  } catch {
    return false;
  }
};

/** Where an installed catalog item's main file lives. */
export function installPath(root: string, item: CatalogItem): string {
  return item.entry
    ? join(root, 'runtimes', item.id, ...item.entry.split('/'))
    : join(root, 'models', basename(new URL(item.url).pathname));
}

export async function installedIds(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const item of catalog) {
    const info = await stat(installPath(root, item)).catch(() => null);
    if (info?.isFile() && (item.entry || info.size === item.size)) found.push(item.id);
  }
  return found;
}

/** Builds the asset record for an installed item. Runtime DLLs are hashed so later tampering is detected. */
export async function assetFor(root: string, item: CatalogItem): Promise<Asset> {
  const path = installPath(root, item);
  const base = {
    path,
    name: item.name,
    version: item.version,
    license: item.license,
    provenance: item.provenance,
    languages: [...item.languages],
    catalogId: item.id,
  };
  if (!item.entry) return { ...base, sha256: item.sha256, size: item.size };
  const dependencies = [];
  for (const file of (await readdir(dirname(path))).filter(name => name.toLowerCase().endsWith('.dll')).sort()) {
    const dll = join(dirname(path), file);
    dependencies.push({ file, size: (await stat(dll)).size, sha256: await sha256(dll) });
  }
  return { ...base, sha256: await sha256(path), size: (await stat(path)).size, gpu: !!item.gpu, dependencies };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(new Error('CANCELLED'))), { once: true });
  });

export class Downloader {
  readonly state: Record<string, DownloadState> = {};
  private controllers = new Map<string, AbortController>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly root: string,
    readonly session: Session,
    readonly changed: () => void,
  ) {
    // Second line of defence: this session can't reach anything outside the allowlist, even via redirects.
    session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowedUrl(details.url) }));
  }

  /** Queues a download; resolves with the verified, installed asset. */
  download(id: string): Promise<Asset> {
    const item = catalogItem(id);
    if (!item) return Promise.reject(new Error('UNKNOWN_DOWNLOAD'));
    if (this.controllers.has(id)) return Promise.reject(new Error('DOWNLOAD_IN_PROGRESS'));
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.state[id] = { state: 'queued', received: 0, total: item.size };
    this.changed();
    const job = this.queue.then(() => this.run(item, controller.signal));
    this.queue = job.catch(() => {});
    return job.then(
      asset => {
        this.finish(id);
        return asset;
      },
      (error: unknown) => {
        const code = error instanceof Error && /^[A-Z_0-9]+$/.test(error.message) ? error.message : 'DOWNLOAD_FAILED';
        if (code === 'CANCELLED') this.finish(id);
        else {
          this.controllers.delete(id);
          this.state[id] = { state: 'error', received: 0, total: item.size, error: code };
          this.changed();
        }
        throw new Error(code);
      },
    );
  }

  cancel(id: string): void {
    this.controllers.get(id)?.abort();
    if (this.state[id]?.state === 'error') this.finish(id);
  }

  async remove(id: string): Promise<void> {
    const item = catalogItem(id);
    if (!item || this.controllers.has(id)) throw new Error('ASSET_BUSY');
    const target = item.entry ? join(this.root, 'runtimes', item.id) : installPath(this.root, item);
    await rm(target, { recursive: true, force: true });
  }

  private finish(id: string): void {
    this.controllers.delete(id);
    delete this.state[id];
    this.changed();
  }

  private async run(item: CatalogItem, signal: AbortSignal): Promise<Asset> {
    signal.throwIfAborted();
    const target = installPath(this.root, item);
    const folder = item.entry ? join(this.root, 'runtimes', item.id) : dirname(target);
    const file = item.entry ? `${folder}.zip.part` : `${target}.part`;
    await mkdir(dirname(file), { recursive: true });
    const free = await statfs(dirname(file))
      .then(s => s.bavail * s.bsize)
      .catch(() => Infinity);
    if (free < item.size * (item.entry ? 2.8 : 1.05)) throw new Error('NOT_ENOUGH_DISK_SPACE');

    await this.fetch(item, file, signal);
    this.state[item.id] = { state: 'verifying', received: item.size, total: item.size };
    this.changed();
    if ((await sha256(file)) !== item.sha256) {
      await rm(file, { force: true });
      throw new Error('DOWNLOAD_CHECKSUM_MISMATCH');
    }
    signal.throwIfAborted();
    if (!item.entry) {
      await rename(file, target);
    } else {
      this.state[item.id] = { state: 'extracting', received: item.size, total: item.size };
      this.changed();
      const staging = `${folder}.staging`;
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      // bsdtar ships with Windows 10+, reads zip, and refuses absolute or ../ paths by default.
      const tar = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe');
      await runProcess(tar, ['-xf', file, '-C', staging], { signal, timeoutMs: 600000 });
      await rm(folder, { recursive: true, force: true });
      await rename(staging, folder);
      await rm(file, { force: true });
    }
    return assetFor(this.root, item);
  }

  /** Streams to `file`, resuming with HTTP ranges after dropped connections. */
  private async fetch(item: CatalogItem, file: string, signal: AbortSignal): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      let have = (await stat(file).catch(() => null))?.size ?? 0;
      if (have > item.size) {
        await rm(file, { force: true });
        have = 0;
      }
      if (have === item.size) return;
      this.state[item.id] = { state: 'downloading', received: have, total: item.size };
      this.changed();
      try {
        // Redirects to the publishers' CDNs are followed; the session's request filter (see the constructor)
        // cancels any hop outside the allowlist. The SHA-256 check after the download is the final word.
        if (!allowedUrl(item.url)) throw new Error('DOWNLOAD_HOST_NOT_ALLOWED');
        const response = await this.session.fetch(item.url, {
          headers: have ? { Range: `bytes=${have}-` } : {},
          signal,
          cache: 'no-store',
        });
        if (have && response.status === 200) {
          // The server ignored the range; start over.
          await rm(file, { force: true });
          have = 0;
        } else if (response.status !== (have ? 206 : 200)) throw new Error(`DOWNLOAD_HTTP_${response.status}`);
        if (!response.body) throw new Error('DOWNLOAD_EMPTY');
        const out = createWriteStream(file, { flags: have ? 'a' : 'w' });
        try {
          let lastPaint = 0;
          for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            if (!out.write(chunk)) await once(out, 'drain');
            have += chunk.byteLength;
            if (have > item.size) throw new Error('DOWNLOAD_TOO_LARGE');
            if (Date.now() - lastPaint > 250) {
              lastPaint = Date.now();
              this.state[item.id] = { state: 'downloading', received: have, total: item.size };
              this.changed();
            }
          }
        } finally {
          out.end();
          await once(out, 'close');
        }
        if (have === item.size) return;
        throw new Error('DOWNLOAD_INCOMPLETE');
      } catch (error) {
        if (signal.aborted) throw new Error('CANCELLED');
        if (String(error).includes('ERR_BLOCKED_BY_CLIENT')) throw new Error('DOWNLOAD_HOST_NOT_ALLOWED');
        if (error instanceof Error && /^DOWNLOAD_(HOST|HTTP_4|TOO_LARGE)/.test(error.message)) throw error;
        if (attempt >= 8) throw new Error('DOWNLOAD_NETWORK_FAILED');
        await sleep(Math.min(15000, 1000 * 2 ** attempt), signal);
      }
    }
  }
}
