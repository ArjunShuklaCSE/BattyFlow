import type { AsrEngine, Dictionary, Settings, TextTransformer } from '../shared/types';
import { EnergyVad } from '../shared/audio';
import { Session } from './session';
import { protect, resolve, restore, literalIdentifiers } from './vocabulary/resolver';
import { validateCleanup, validateDraft } from './llm/validation';
export async function finalPipeline(s: Session, pcm: Float32Array, asr: AsrEngine, transformer: TextTransformer | null, dictionary: Dictionary, settings: Settings, changed: () => void): Promise<void> {
  const signal = s.controller.signal;
  const check = () => { signal.throwIfAborted(); if (!s.alive()) throw new Error('STALE_SESSION'); };
  const vad = new EnergyVad();
  for (let i = 0; i < pcm.length; i += 320) vad.accept(pcm.subarray(i, i + 320));
  if (!vad.hasSpeech) { s.notice = 'No speech detected. Nothing to insert.'; s.move('ready'); changed(); return; }
  const start = performance.now(); const raw = await asr.transcribe(pcm, settings.language, signal); check();
  s.timings['asrMs'] = performance.now() - start;
  if (!raw.trim()) { s.notice = 'No transcript returned. Nothing to insert.'; s.move('ready'); changed(); return; }
  const resolved = resolve(raw, dictionary, settings.profile);
  const source = s.mode === 'edit' ? s.target.selection ?? '' : resolved.text;
  const protectedText = protect(source, [...resolved.spans.map(x => x.canonical), ...dictionary.entries.map(x => x.canonical), ...literalIdentifiers(source)]);
  s.text = resolved.text;
  if (resolved.ambiguities.length) s.notice = `Ambiguous vocabulary: ${resolved.ambiguities.join(', ')}. Spoken words preserved.`;
  if (!transformer) {
    if (s.mode !== 'dictation') throw new Error('LOCAL_TRANSFORMER_REQUIRED');
    s.notice += `${s.notice ? ' ' : ''}Cleanup unavailable. Review alias-resolved raw text before copying.`;
    s.move('ready'); changed(); return;
  }
  s.move('transforming'); changed(); const transformStart = performance.now();
  try {
    const result = await transformer.transform({ mode: s.mode, transcript: s.mode === 'edit' ? resolved.text : protectedText.text, profile: settings.profile, sourceLanguage: settings.language, protectedSpans: [...protectedText.tokens.keys()], ...(s.mode === 'edit' ? { selectedText: protectedText.text, editingInstruction: resolved.text } : {}), ...(s.mode === 'translation' ? { targetLanguage: settings.targetLanguage } : {}) }, signal);
    check();
    if (s.mode === 'dictation') validateCleanup(protectedText.text, result);
    if (s.mode === 'command') validateDraft(protectedText.text, result);
    s.text = restore(result, protectedText.tokens, s.mode === 'edit');
  } catch (error) {
    check(); if (s.mode !== 'dictation') throw error;
    s.text = resolved.text; s.notice = 'Cleanup failed validation or was unavailable. Review the preserved pre-cleanup text.';
  }
  s.timings['cleanupMs'] = performance.now() - transformStart; s.move('ready'); changed();
}
