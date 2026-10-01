import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/main/session';
import {
  starter,
  resolve,
  protect,
  restore,
  validateDictionary,
  vocabularyPrompt,
} from '../src/main/vocabulary/resolver';
import { EnergyVad, Resampler, readWav, wav, rms } from '../src/shared/audio';
import { wer, identifiers } from '../benchmark/metrics';
import { finalPipeline } from '../src/main/pipeline';
import { PreviewScheduler } from '../src/main/asr/preview';
import { audioContext, cleanTranscript } from '../src/main/asr/whisper';
import { defaults, validateSettings } from '../src/main/settings/store';
import { runProcess } from '../src/main/privacy/process';
import { removeFillers, formatForProfile, forTarget, profileFor, countWords } from '../src/main/text';
import { History } from '../src/main/history';
import type { Target, Dictionary, Settings } from '../src/shared/types';

const target: Target = { platform: 'test', identity: 'window-1', field: 'field-1', secure: false, terminal: false };
const speech = () => new Float32Array(3200).fill(0.1);
function transcribing(mode: Session['mode'] = 'dictation'): Session {
  const s = new Session(mode, target);
  s.move('recording');
  s.move('transcribing');
  return s;
}

test('valid transitions and exactly one insertion claim', () => {
  const s = transcribing();
  s.move('ready');
  assert.throws(() => s.move('recording'));
  s.claimInsertion();
  assert.throws(() => s.claimInsertion());
});

test('cancellation is idempotent and prevents delivery', () => {
  const s = transcribing();
  s.move('ready');
  s.cancel();
  s.cancel();
  assert.equal(s.state, 'cancelled');
  assert.equal(s.alive(), false);
  assert.throws(() => s.claimInsertion());
});

test('scope, exact canonical spelling, word boundaries and meaningful like', () => {
  assert.equal(resolve('call get user by id', starter, 'code').text, 'call getUserById');
  assert.equal(resolve('get user by id', starter, 'neutral').text, 'get user by id');
  assert.equal(resolve('I like this API and useEffect', starter, 'code').text, 'I like this API and useEffect');
  assert.equal(resolve('reuse effects', starter, 'code').text, 'reuse effects');
  assert.equal(resolve('open local host in the browser', starter, 'neutral').text, 'open localhost in the browser');
});

test('longest explicit alias wins; equal alternatives remain ambiguous', () => {
  const dictionary: Dictionary = {
    schemaVersion: 1,
    entries: [
      { canonical: 'short', spokenAliases: ['get user'] },
      { canonical: 'long', spokenAliases: ['get user id'] },
    ],
  };
  assert.equal(resolve('get user id', dictionary, 'code').text, 'long');
  dictionary.entries = [
    { canonical: 'userId', spokenAliases: ['user id'] },
    { canonical: 'userID', spokenAliases: ['user id'] },
  ];
  assert.deepEqual(resolve('user id', dictionary, 'code').ambiguities, ['user id']);
  assert.equal(resolve('user id', dictionary, 'code').text, 'user id');
});

test('dictionary rejects invalid and duplicate entries', () => {
  assert.throws(() => validateDictionary({ schemaVersion: 2, entries: [] }));
  assert.throws(() =>
    validateDictionary({ schemaVersion: 1, entries: [{ canonical: 'A', spokenAliases: ['a', 'a'] }] }),
  );
  assert.doesNotThrow(() => validateDictionary(starter));
});

test('vocabulary prompt is a sentence of the terms that apply to the profile', () => {
  const neutral = vocabularyPrompt(starter, 'neutral');
  assert.match(neutral, /^In this conversation we talk about OAuth, GraphQL, .*, and localhost\.$/);
  assert.doesNotMatch(neutral, /useEffect|getUserById/);
  assert.match(vocabularyPrompt(starter, 'code'), /useEffect, Kubernetes, git checkout, getUserById/);
  assert.equal(vocabularyPrompt({ schemaVersion: 1, entries: [] }, 'code'), '');
  const many: Dictionary = {
    schemaVersion: 1,
    entries: Array.from({ length: 200 }, (_, i) => ({ canonical: `identifier${i}`, spokenAliases: [`id ${i}`] })),
  };
  assert.ok(vocabularyPrompt(many, 'neutral').length < 560, 'prompt stays inside Whisper’s prompt budget');
});

test('protected repeats, removal, fabricated and duplicate tokens', () => {
  const p = protect('OAuth OAuth getUserById', ['OAuth', 'getUserById']);
  assert.equal(restore(p.text, p.tokens), 'OAuth OAuth getUserById');
  assert.throws(() => restore('', p.tokens));
  assert.equal(restore('', p.tokens, true), '');
  assert.throws(() => restore(p.text + p.text, p.tokens));
  assert.throws(() => restore(p.text + ' BF_012345678901234567890123_4_END', p.tokens));
});

test('filler sounds are removed, meaningful words kept', () => {
  assert.equal(removeFillers('Um, I think, uh, we should review the design.'), 'I think, we should review the design.');
  assert.equal(removeFillers('Um, we should ship it.'), 'We should ship it.');
  assert.equal(removeFillers('I like this, hmm, a lot.'), 'I like this, a lot.');
  assert.equal(removeFillers('The umbrella and the hum stay.'), 'The umbrella and the hum stay.');
  assert.equal(removeFillers('Uh-huh, that works.'), 'Uh-huh, that works.');
  assert.equal(removeFillers('um'), '');
});

test('profiles follow the app and shape the text', () => {
  const settings = { profile: 'neutral' as const, autoProfile: true };
  assert.equal(profileFor({ ...target, app: 'code' }, settings), 'code');
  assert.equal(profileFor({ ...target, app: 'slack' }, settings), 'chat');
  assert.equal(profileFor({ ...target, terminal: true, app: 'windowsterminal' }, settings), 'terminal');
  assert.equal(profileFor({ ...target, app: 'notepad' }, settings), 'neutral');
  assert.equal(profileFor({ ...target, app: 'code' }, { ...settings, autoProfile: false }), 'neutral');
  assert.equal(formatForProfile('Git status.', 'terminal'), 'git status');
  assert.equal(formatForProfile('Docker compose up\nminus d.', 'terminal'), 'docker compose up minus d');
  assert.equal(formatForProfile('Sounds good.', 'chat'), 'Sounds good');
  assert.equal(formatForProfile('Done. Shipping now.', 'chat'), 'Done. Shipping now.');
  assert.equal(formatForProfile('Wait...', 'chat'), 'Wait...');
  assert.equal(formatForProfile('Hello there.', 'email'), 'Hello there.');
});

test('pasted text gets a trailing space, never a newline in terminals', () => {
  assert.equal(forTarget('Hello world.', target, { trailingSpace: true }), 'Hello world. ');
  assert.equal(forTarget('Hello world.', target, { trailingSpace: false }), 'Hello world.');
  assert.equal(
    forTarget('rm -rf build\nls', { ...target, terminal: true }, { trailingSpace: true }),
    'rm -rf build ls',
  );
  assert.equal(countWords('Set the timeout to 42 seconds, getUserById’s value.'), 8);
});

test('whisper output cleanup and encoder window', () => {
  assert.equal(cleanTranscript(' Hello there.\n And more.\n'), 'Hello there. And more.');
  assert.equal(cleanTranscript(' [BLANK_AUDIO]\n'), '');
  assert.equal(cleanTranscript(' (upbeat music)\n Real words.\n'), 'Real words.');
  assert.equal(cleanTranscript(' Use [brackets] inside text.\n'), 'Use [brackets] inside text.');
  assert.equal(audioContext(16000 * 3), 512);
  assert.equal(audioContext(16000 * 30), 1500);
  assert.ok(audioContext(16000) >= 50 + 300);
});

test('WER substitutions, insertion, deletion and silence', () => {
  assert.equal(wer('a b c', 'a d c').wer, 1 / 3);
  assert.equal(wer('a b', 'a').deletions, 1);
  assert.equal(wer('a', 'a b').insertions, 1);
  assert.equal(wer('', 'hello').wer, null);
  assert.equal(wer('', 'hello').hallucinatedWords, 1);
  assert.equal(wer('Hello, API!', 'hello api').wer, 0);
});

test('identifier scoring preserves case and repeated occurrence counts', () => {
  assert.deepEqual(identifiers('userId userID userId OAuth', [{ text: 'userId', count: 3 }], ['userId', 'OAuth']), {
    correct: 2,
    total: 3,
    preservation: 2 / 3,
    spurious: 1,
  });
});

test('PCM WAV round-trip and invalid container rejection', () => {
  const pcm = Float32Array.from([0, 0.5, -0.5, 1, -1]);
  const decoded = readWav(wav(pcm));
  decoded.forEach((x, i) => assert.ok(Math.abs(x - pcm[i]!) < 0.0001));
  assert.throws(() => readWav(Buffer.from('not a wav')));
});

test('streaming resampler preserves 1kHz, rejects aliasing and has correct duration', () => {
  function tone(hz: number): Float32Array {
    const r = new Resampler(48000);
    const results: number[] = [];
    for (let start = 0; start < 48000; start += 128) {
      results.push(
        ...r.push(
          Float32Array.from({ length: Math.min(128, 48000 - start) }, (_, i) =>
            Math.sin((2 * Math.PI * hz * (start + i)) / 48000),
          ),
        ),
      );
    }
    results.push(...r.push(new Float32Array(), true));
    return Float32Array.from(results);
  }
  const low = tone(1000);
  const high = tone(12000);
  assert.ok(Math.abs(low.length - 16000) <= 1);
  assert.ok(rms(low) > 0.65);
  assert.ok(rms(high) < 0.025);
});

test('VAD silence and short click do not count as speech', () => {
  const v = new EnergyVad();
  for (let i = 0; i < 100; i++) v.accept(new Float32Array(320));
  assert.equal(v.hasSpeech, false);
  v.accept(new Float32Array(320).fill(0.1));
  assert.equal(v.hasSpeech, false);
});

test('pipeline ignores late ASR after cancel', async () => {
  const s = transcribing();
  let finish!: (text: string) => void;
  const delayed = new Promise<string>(r => (finish = r));
  const work = finalPipeline(
    s,
    speech(),
    { transcribe: async () => delayed },
    null,
    starter,
    defaults,
    'neutral',
    () => {},
  );
  s.cancel();
  finish('must not insert');
  await assert.rejects(work);
  assert.equal(s.text, '');
  assert.equal(s.state, 'cancelled');
});

test('silence pipeline never invokes ASR', async () => {
  const s = transcribing();
  const asr = {
    transcribe: async (): Promise<string> => {
      throw Error('must not run');
    },
  };
  await finalPipeline(s, new Float32Array(16000), asr, null, starter, defaults, 'neutral', () => {});
  assert.equal(s.text, '');
  assert.equal(s.state, 'ready');
});

test('pipeline passes the vocabulary prompt, removes fillers and formats for the profile', async () => {
  let prompt: string | undefined;
  const s = transcribing();
  const asr = {
    transcribe: async (_pcm: Float32Array, _language: string, _signal: AbortSignal, p?: string) => {
      prompt = p;
      return 'Um, git check out main.';
    },
  };
  await finalPipeline(s, speech(), asr, null, starter, defaults, 'terminal', () => {});
  assert.match(prompt ?? '', /git checkout/i);
  assert.equal(s.text, 'git checkout main');
  const plain = transcribing();
  await finalPipeline(
    plain,
    speech(),
    asr,
    null,
    starter,
    { ...defaults, vocabularyPrompt: false, removeFillers: false },
    'code',
    () => {},
  );
  assert.equal(prompt, undefined);
  assert.equal(plain.text, 'Um, git checkout main.');
});

test('polish failure keeps the plain transcript; polish is opt-in for dictation', async () => {
  const model = { transform: async () => 'change everything' };
  const s = transcribing();
  await finalPipeline(
    s,
    speech(),
    { transcribe: async () => 'do not change OAuth 42' },
    model,
    starter,
    { ...defaults, polish: true },
    'neutral',
    () => {},
  );
  assert.equal(s.text, 'do not change OAuth 42');
  assert.match(s.notice, /skipped/);
  let called = false;
  const off = transcribing();
  await finalPipeline(
    off,
    speech(),
    { transcribe: async () => 'hello' },
    { transform: async () => ((called = true), 'x') },
    starter,
    defaults,
    'neutral',
    () => {},
  );
  assert.equal(called, false);
  await assert.rejects(
    finalPipeline(
      transcribing('command'),
      speech(),
      { transcribe: async () => 'hi' },
      null,
      starter,
      defaults,
      'neutral',
      () => {},
    ),
    /LOCAL_TRANSFORMER_REQUIRED/,
  );
});

test('preview is bounded and cancellation drops late outputs', async () => {
  const p = new PreviewScheduler();
  let finish!: (x: string) => void;
  let published = 0;
  assert.equal(
    p.offer(
      () => new Promise(r => (finish = r)),
      () => published++,
    ),
    true,
  );
  assert.equal(
    p.offer(
      async () => '',
      () => {},
    ),
    false,
  );
  const stop = p.stop();
  finish('late');
  await stop;
  assert.equal(published, 0);
});

test('settings reject unsafe shortcuts and excessive buffers, and migrate 0.1 files', () => {
  assert.throws(() => validateSettings({ ...defaults, shortcut: 'Escape' }));
  assert.throws(() => validateSettings({ ...defaults, shortcut: 'Control+D' }));
  assert.throws(() => validateSettings({ ...defaults, maxSeconds: 9999 }));
  assert.throws(() => validateSettings({ ...defaults, pushToTalk: 'space' }));
  assert.doesNotThrow(() => validateSettings({ ...defaults, shortcut: 'Control+Shift+Space', language: 'auto' }));
  assert.doesNotThrow(() => validateSettings({ ...defaults, shortcut: 'Control+Alt+F9' }));
  const old = {
    schemaVersion: 1,
    microphone: 'mic-1',
    language: 'en',
    profile: 'code',
    mode: 'dictation',
    shortcut: 'CommandOrControl+Alt+D',
    commandShortcut: 'CommandOrControl+Alt+J',
    editShortcut: 'CommandOrControl+Alt+E',
    maxSeconds: 60,
    silenceStop: true,
    rawFallback: false,
    preview: false,
    context: false,
    threads: 4,
    targetLanguage: 'es',
    translationPairs: [],
  };
  const migrated: Settings = validateSettings(old);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.microphone, 'mic-1');
  assert.equal(migrated.profile, 'code');
  assert.equal(migrated.maxSeconds, 60);
  assert.equal(migrated.delivery, 'paste');
  assert.equal(migrated.pushToTalk, 'ctrl-win');
  assert.equal('rawFallback' in migrated, false);
  assert.equal('unknownKey' in validateSettings({ ...defaults, unknownKey: 1 }), false);
});

test('history keeps newest first, counts words and survives a reload', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'battyflow-history-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const history = new History(join(dir, 'history.json'));
  const now = Date.now();
  await history.add({
    id: 'a',
    at: now - 86400000 * 2,
    text: 'old words here',
    mode: 'dictation',
    seconds: 6,
    words: 3,
    delivered: 'pasted',
  });
  await history.add({ id: 'b', at: now, text: 'new', mode: 'dictation', seconds: 6, words: 9, delivered: 'copied' });
  assert.deepEqual(
    history.list().map(e => e.id),
    ['b', 'a'],
  );
  assert.deepEqual(history.stats(now), { sessions: 2, words: 12, wordsToday: 9, wpm: 60 });
  const reloaded = new History(join(dir, 'history.json'));
  await reloaded.load();
  assert.equal(reloaded.list().length, 2);
  await reloaded.remove('b');
  assert.deepEqual(
    reloaded.list().map(e => e.id),
    ['a'],
  );
  await reloaded.clear();
  assert.equal(reloaded.list().length, 0);
});

test('native process timeout, output limit, crash and pre-cancel are bounded', async () => {
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      signal: new AbortController().signal,
      timeoutMs: 50,
    }),
    /TIMEOUT/,
  );
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(20000))'], {
      signal: new AbortController().signal,
      maxBytes: 100,
    }),
    /OUTPUT_LIMIT/,
  );
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'process.exit(3)'], { signal: new AbortController().signal }),
    /PROCESS_FAILED/,
  );
  const c = new AbortController();
  c.abort();
  await assert.rejects(runProcess(process.execPath, [], { signal: c.signal }), /CANCELLED/);
});
