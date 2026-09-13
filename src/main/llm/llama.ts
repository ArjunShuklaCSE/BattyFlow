import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { Asset, TextTransformer, TransformData } from '../../shared/types';
import { runProcess } from '../privacy/process';
import { verifyAsset } from '../settings/store';
import { instructions } from './prompts';
import { validateCleanup, validateDraft } from './validation';
// Optional completion CLI. Only a validated local model is accepted; no URLs or HF flags.
export class Llama implements TextTransformer {
  constructor(readonly runtime: Asset, readonly model: Asset, readonly tempRoot: string, readonly threads: number) {}
  async transform(data: TransformData, signal: AbortSignal): Promise<string> {
    if (this.runtime.version !== 'b6532') throw new Error('LLAMA_VERSION_REQUIRES_B6532');
    const serialized = JSON.stringify(data);
    // UTF-8 byte bound is conservative for an 8192-token context, reserving output and instructions.
    if (Buffer.byteLength(serialized) > 4500) throw new Error('TRANSFORMATION_INPUT_TOO_LARGE');
    if (data.mode === 'translation' && !this.model.languages.includes(data.targetLanguage ?? '')) throw new Error('TRANSLATION_LANGUAGE_UNSUPPORTED');
    await Promise.all([verifyAsset(this.runtime), verifyAsset(this.model, 'GGUF')]);
    const help = await runProcess(this.runtime.path, ['--help'], { signal, timeoutMs: 10000 });
    for (const flag of ['--no-display-prompt','--file','--predict','--ctx-size','--temp','--conversation','--single-turn','--system-prompt-file','--simple-io']) if (!(help.stdout + help.stderr).includes(flag)) throw new Error('LLAMA_CLI_INCOMPATIBLE');
    const folder = join(this.tempRoot, `session-${randomUUID()}`);
    try {
      await mkdir(folder, { mode: 0o700 }); const path = join(folder, 'prompt.txt');
      const systemPath = join(folder, 'system.txt');
      await writeFile(path, serialized, { mode: 0o600, flag: 'wx' });
      await writeFile(systemPath, instructions[data.mode], { mode: 0o600, flag: 'wx' });
      const result = await runProcess(this.runtime.path, ['--model',this.model.path,'--file',path,'--system-prompt-file',systemPath,'--ctx-size','8192','--predict','1024','--temp','0','--seed','0','--threads',String(this.threads),'--gpu-layers','0','--no-display-prompt','--conversation','--single-turn','--simple-io'], { signal, cwd: dirname(this.runtime.path), timeoutMs: 60000, maxBytes: 256000 });
      // b6532 prints this terminal marker on EOG. Do not strip arbitrary bracketed text.
      const output = result.stdout.trim();
      if (!output.endsWith('[end of text]')) throw new Error('TRANSFORMATION_POSSIBLY_TRUNCATED');
      const text = output.slice(0, -'[end of text]'.length).trim();
      if (!text || text.length > 12000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) || /<\|(?:im_end|eot_id)\|>/.test(text)) throw new Error('TRANSFORMATION_OUTPUT_INVALID');
      const runs = Number(result.stderr.match(/(?<!prompt )eval time\s*=.*?\/\s*(\d+) runs/)?.[1] ?? 1024);
      if (runs >= 1023 || Buffer.byteLength(text) >= 6000) throw new Error('TRANSFORMATION_POSSIBLY_TRUNCATED');
      if (data.mode === 'dictation') validateCleanup(data.transcript, text);
      if (data.mode === 'command') validateDraft(data.transcript, text);
      return text;
    } finally { await rm(folder, { recursive: true, force: true }); }
  }
}
