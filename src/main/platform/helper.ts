import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { localPath } from '../privacy/process';

type Pending = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/** Client for BattyHelper.exe: one long-lived process, JSON lines both ways, restarted if it dies or hangs. */
export class Helper {
  private child: ChildProcess | null = null;
  private pending = new Map<number, Pending>();
  private next = 1;
  private restarts = 0;
  private disposed = false;
  private ptt: { groups: number[][]; swallow: boolean } = { groups: [], swallow: false };
  onEvent: (event: string, state: string) => void = () => {};

  constructor(readonly path: string) {
    if (!localPath(path)) throw new Error('LOCAL_EXECUTABLE_REQUIRED');
  }

  start(): void {
    if (this.disposed || this.child) return;
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA'])
      if (process.env[key]) env[key] = process.env[key];
    const child = spawn(this.path, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, shell: false, env });
    this.child = child;
    child.stdout!.setEncoding('utf8');
    createInterface({ input: child.stdout! }).on('line', line => this.receive(line));
    child.on('error', () => this.exited(child));
    child.on('exit', () => this.exited(child));
    child.stdin!.on('error', () => {});
  }

  private receive(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message['event'] === 'ready') {
      this.restarts = 0;
      if (this.ptt.groups.length) void this.request('ptt', this.ptt).catch(() => {});
    } else if (typeof message['event'] === 'string') {
      this.onEvent(message['event'], String(message['state']));
    }
    const waiter = typeof message['id'] === 'number' ? this.pending.get(message['id']) : undefined;
    if (!waiter) return;
    this.pending.delete(message['id'] as number);
    clearTimeout(waiter.timer);
    if (message['ok'] === true) waiter.resolve(message);
    else waiter.reject(new Error('HELPER_REQUEST_FAILED'));
  }

  private exited(child: ChildProcess): void {
    if (this.child !== child) return;
    this.child = null;
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('HELPER_EXITED'));
    }
    this.pending.clear();
    if (this.disposed) return;
    // A held push-to-talk key must not leave a recording running if the helper dies mid-press.
    this.onEvent('ptt', 'abort');
    const delay = Math.min(30000, 500 * 2 ** this.restarts++);
    setTimeout(() => this.start(), delay).unref();
  }

  request(op: string, payload: object = {}, timeoutMs = 2000): Promise<Record<string, unknown>> {
    this.start();
    const child = this.child;
    if (!child?.stdin?.writable) return Promise.reject(new Error('HELPER_UNAVAILABLE'));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('HELPER_TIMEOUT'));
        // A hung helper (usually UI Automation stuck on a frozen app) is replaced rather than waited on.
        child.kill();
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin!.write(`${JSON.stringify({ ...payload, id, op })}\n`);
    });
  }

  configurePushToTalk(groups: number[][], swallow: boolean): Promise<unknown> {
    this.ptt = { groups, swallow };
    return this.request('ptt', this.ptt);
  }

  dispose(): void {
    this.disposed = true;
    this.child?.kill();
    this.child = null;
  }
}
