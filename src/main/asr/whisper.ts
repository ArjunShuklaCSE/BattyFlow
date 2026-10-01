import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AsrEngine, Asset } from '../../shared/types';
import { RATE, wav } from '../../shared/audio';
import { verifyAsset } from '../settings/store';
import { runProcess } from '../privacy/process';

const required = ['--no-prints', '--no-timestamps', '--model', '--file', '--language', '--no-gpu', '--threads'];

/** Encoder window for a clip: Whisper pads everything to 30 s (1500 frames), which wastes most of the time on
 * short dictation. Keep a generous margin; a window cut too close makes the decoder repeat itself. */
export function audioContext(samples: number): number {
  const frames = Math.ceil((samples / RATE) * 50) + 300;
  return Math.min(1500, Math.ceil(frames / 64) * 64);
}

/** whisper-cli prints one line per segment, plus bracketed tags for non-speech such as [BLANK_AUDIO]. */
export function cleanTranscript(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*[[(][^\])]{0,40}[\])]\s*$/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export class Whisper implements AsrEngine {
  private ready: Promise<Set<string>> | null = null;
  private busy = false;
  constructor(
    readonly runtime: Asset,
    readonly model: Asset,
    readonly tempRoot: string,
    readonly threads = 4,
    readonly gpu = false,
    readonly shortWindow = true,
  ) {}

  /** Verifies files and CLI flags once. With a GPU it also runs one tiny transcription: the NVIDIA driver
   * compiles its kernels on first use (about 20 s), and that should happen now rather than mid-dictation. */
  prepare(): Promise<Set<string>> {
    this.ready ??= (async () => {
      await Promise.all([verifyAsset(this.runtime), verifyAsset(this.model, 'ggml')]);
      const help = await runProcess(this.runtime.path, ['--help'], {
        signal: new AbortController().signal,
        timeoutMs: 10000,
        cwd: dirname(this.runtime.path),
      });
      const flags = new Set((help.stdout + help.stderr).match(/--[a-z][a-z-]+/g) ?? []);
      if (required.some(flag => !flags.has(flag))) throw new Error('WHISPER_CLI_INCOMPATIBLE');
      if (this.gpu)
        await this.run(
          new Float32Array(RATE / 2),
          this.model.languages[0] ?? 'en',
          flags,
          new AbortController().signal,
        );
      return flags;
    })();
    this.ready.catch(() => (this.ready = null));
    return this.ready;
  }

  async transcribe(pcm: Float32Array, language: string, signal: AbortSignal, prompt?: string): Promise<string> {
    if (this.busy) throw new Error('ASR_BUSY');
    if (language === 'auto' ? this.model.languages.length < 2 : !this.model.languages.includes(language))
      throw new Error('ASR_LANGUAGE_UNSUPPORTED');
    if (!pcm.length || pcm.length > RATE * 300) throw new Error('AUDIO_SIZE_LIMIT');
    this.busy = true;
    try {
      const flags = await this.prepare();
      signal.throwIfAborted();
      const text = cleanTranscript(await this.run(pcm, language, flags, signal, prompt));
      if (text.length > 32000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error('ASR_OUTPUT_INVALID');
      return text;
    } finally {
      this.busy = false;
    }
  }

  private async run(
    pcm: Float32Array,
    language: string,
    flags: Set<string>,
    signal: AbortSignal,
    prompt?: string,
  ): Promise<string> {
    const folder = join(this.tempRoot, `session-${randomUUID()}`);
    try {
      await mkdir(folder, { mode: 0o700 });
      const path = join(folder, 'audio.wav');
      await writeFile(path, wav(pcm), { mode: 0o600, flag: 'wx' });
      const args = ['-m', this.model.path, '-f', path, '-l', language, '-t', String(this.threads), '-nt', '-np'];
      if (!this.gpu) args.push('-ng');
      // Greedy decoding: as accurate as beam search on dictation in our tests, and ~15% faster.
      if (flags.has('--beam-size') && flags.has('--best-of')) args.push('-bs', '1', '-bo', '1');
      if (flags.has('--suppress-nst')) args.push('-sns');
      if (this.shortWindow && flags.has('--audio-ctx') && pcm.length < RATE * 25)
        args.push('-ac', String(audioContext(pcm.length)));
      if (prompt && flags.has('--prompt')) args.push('--prompt', prompt);
      const output = await runProcess(this.runtime.path, args, {
        signal,
        timeoutMs: 120000,
        cwd: dirname(this.runtime.path),
      });
      signal.throwIfAborted();
      return output.stdout;
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }
}
