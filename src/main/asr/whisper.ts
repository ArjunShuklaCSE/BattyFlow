import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AsrEngine, Asset } from '../../shared/types';
import { wav } from '../../shared/audio';
import { verifyAsset } from '../settings/store';
import { runProcess } from '../privacy/process';
export class Whisper implements AsrEngine {
  private checked = false;
  private busy = false;
  constructor(readonly runtime: Asset, readonly model: Asset, readonly tempRoot: string, readonly threads = 4) {}
  async validate(signal: AbortSignal): Promise<void> {
    if (this.runtime.version !== '1.8.3') throw new Error('WHISPER_VERSION_REQUIRES_1_8_3');
    await Promise.all([verifyAsset(this.runtime), verifyAsset(this.model, 'ggml')]);
    if (!this.checked) {
      const help = await runProcess(this.runtime.path, ['--help'], { signal, timeoutMs: 10000 });
      const output = help.stdout + help.stderr;
      for (const flag of ['--no-prints','--no-timestamps','--model','--file','--language','--no-gpu','--threads']) if (!output.includes(flag)) throw new Error('WHISPER_CLI_INCOMPATIBLE');
      this.checked = true;
    }
  }
  async transcribe(pcm: Float32Array, language: string, signal: AbortSignal): Promise<string> {
    if (this.busy) throw new Error('ASR_BUSY');
    if (!this.model.languages.includes(language)) throw new Error('ASR_LANGUAGE_UNSUPPORTED');
    if (!pcm.length || pcm.length > 16000 * 180) throw new Error('AUDIO_SIZE_LIMIT');
    this.busy = true;
    const folder = join(this.tempRoot, `session-${randomUUID()}`);
    try {
      await this.validate(signal); signal.throwIfAborted();
      await mkdir(folder, { mode: 0o700 }); const path = join(folder, 'audio.wav');
      await writeFile(path, wav(pcm), { mode: 0o600, flag: 'wx' });
      const output = await runProcess(this.runtime.path, ['-m', this.model.path, '-f', path, '-l', language, '-t', String(this.threads), '-nt', '-np', '-ng'], { signal, timeoutMs: 90000, cwd: dirname(this.runtime.path) });
      signal.throwIfAborted(); const text = output.stdout.trim();
      if (text.length > 32000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error('ASR_OUTPUT_INVALID');
      return text;
    } finally { await rm(folder, { recursive: true, force: true }); this.busy = false; }
  }
}
