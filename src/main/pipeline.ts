import type { AsrEngine, Dictionary, Profile, Settings, TextTransformer } from '../shared/types';
import { EnergyVad, FRAME } from '../shared/audio';
import { Session } from './session';
import { protect, resolve, restore, literalIdentifiers, vocabularyPrompt } from './vocabulary/resolver';
import { validateCleanup, validateDraft } from './llm/validation';
import { formatForProfile, removeFillers } from './text';

export async function finalPipeline(
  s: Session,
  pcm: Float32Array,
  asr: AsrEngine,
  transformer: TextTransformer | null,
  dictionary: Dictionary,
  settings: Settings,
  profile: Profile,
  changed: () => void,
): Promise<void> {
  const signal = s.controller.signal;
  const check = () => {
    signal.throwIfAborted();
    if (!s.alive()) throw new Error('STALE_SESSION');
  };
  const vad = new EnergyVad();
  for (let i = 0; i < pcm.length; i += FRAME) vad.accept(pcm.subarray(i, i + FRAME));
  if (!vad.hasSpeech) {
    s.notice = 'No speech detected.';
    s.move('ready');
    changed();
    return;
  }
  const start = performance.now();
  const prompt = settings.vocabularyPrompt ? vocabularyPrompt(dictionary, profile) : '';
  const raw = await asr.transcribe(pcm, settings.language, signal, prompt || undefined);
  check();
  s.timings['asrMs'] = performance.now() - start;
  if (!raw.trim()) {
    s.notice = 'No words recognised.';
    s.move('ready');
    changed();
    return;
  }
  const resolved = resolve(settings.removeFillers ? removeFillers(raw) : raw, dictionary, profile);
  s.text = resolved.text;
  s.notice = resolved.ambiguities.length
    ? `“${resolved.ambiguities.join('”, “')}” matches more than one vocabulary entry, so it was left as spoken.`
    : '';
  // Dictation only goes through the local model when you turn on polishing; other modes need it.
  const useModel = transformer && (s.mode !== 'dictation' || settings.polish);
  if (!useModel) {
    if (s.mode !== 'dictation') throw new Error('LOCAL_TRANSFORMER_REQUIRED');
    s.text = formatForProfile(s.text, profile);
    s.move('ready');
    changed();
    return;
  }
  const source = s.mode === 'edit' ? (s.target.selection ?? '') : resolved.text;
  const protectedText = protect(source, [
    ...resolved.spans.map(x => x.canonical),
    ...dictionary.entries.map(x => x.canonical),
    ...literalIdentifiers(source),
  ]);
  s.move('transforming');
  changed();
  const transformStart = performance.now();
  try {
    const result = await transformer.transform(
      {
        mode: s.mode,
        transcript: s.mode === 'edit' ? resolved.text : protectedText.text,
        profile,
        sourceLanguage: settings.language === 'auto' ? 'en' : settings.language,
        protectedSpans: [...protectedText.tokens.keys()],
        ...(s.mode === 'edit' ? { selectedText: protectedText.text, editingInstruction: resolved.text } : {}),
        ...(s.mode === 'translation' ? { targetLanguage: settings.targetLanguage } : {}),
      },
      signal,
    );
    check();
    if (s.mode === 'dictation') validateCleanup(protectedText.text, result);
    if (s.mode === 'command') validateDraft(protectedText.text, result);
    s.text = restore(result, protectedText.tokens, s.mode === 'edit');
  } catch (error) {
    check();
    if (s.mode !== 'dictation') throw error;
    // The model changed meaning, numbers or identifiers: keep the plain transcript instead.
    s.notice = 'Polishing was skipped because it would have changed your meaning.';
  }
  if (s.mode === 'dictation') s.text = formatForProfile(s.text, profile);
  s.timings['cleanupMs'] = performance.now() - transformStart;
  s.move('ready');
  changed();
}
