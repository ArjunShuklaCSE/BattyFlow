import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
export interface ProcessOptions { signal: AbortSignal; timeoutMs?: number; maxBytes?: number; cwd?: string }
export function localPath(path: string): boolean {
  return isAbsolute(path) && !path.startsWith('\\\\') && !path.startsWith('//') && !path.includes('\0');
}
export function runProcess(executable: string, args: string[], options: ProcessOptions): Promise<{ stdout: string; stderr: string }> {
  if (!localPath(executable)) return Promise.reject(new Error('LOCAL_EXECUTABLE_REQUIRED'));
  if (options.signal.aborted) return Promise.reject(new Error('CANCELLED'));
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LOCALAPPDATA']) if (process.env[key]) env[key] = process.env[key];
    env['OMP_NUM_THREADS'] = '4'; env['HF_HUB_OFFLINE'] = '1'; env['HF_HUB_DISABLE_TELEMETRY'] = '1'; env['NO_PROXY'] = '*'; env['OLLAMA_NO_CLOUD'] = '1';
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env, ...(options.cwd ? { cwd: options.cwd } : {}) });
    let stdout = ''; let stderr = ''; let bytes = 0; let failure = ''; let settled = false;
    const kill = (code: string) => { failure ||= code; child.kill(); };
    const abort = () => kill('CANCELLED'); options.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => kill('INFERENCE_TIMEOUT'), options.timeoutMs ?? 90000);
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer); options.signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve({ stdout, stderr });
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => { bytes += Buffer.byteLength(data); if (bytes > (options.maxBytes ?? 1024 * 1024)) kill('PROCESS_OUTPUT_LIMIT'); else stdout += data; });
    child.stderr.on('data', (data: string) => { bytes += Buffer.byteLength(data); if (bytes > (options.maxBytes ?? 1024 * 1024)) kill('PROCESS_OUTPUT_LIMIT'); else stderr += data; });
    child.on('error', () => finish(new Error('PROCESS_START_FAILED')));
    child.on('close', code => finish(failure ? new Error(failure) : code !== 0 ? new Error('PROCESS_FAILED') : undefined));
    if (options.signal.aborted) abort();
  });
}
