import { randomUUID } from 'node:crypto';
import type { CaptureCommand, Delivered, Dictionary, Mode, Settings, Trigger, View } from '../shared/types';
import { EnergyVad, FRAME, RATE, rms } from '../shared/audio';
import { describe } from '../shared/messages';
import { Session } from './session';
import { Whisper } from './asr/whisper';
import { Llama } from './llm/llama';
import { PreviewScheduler } from './asr/preview';
import { finalPipeline } from './pipeline';
import { vocabularyPrompt } from './vocabulary/resolver';
import { countWords, forTarget, profileFor } from './text';
import type { Platform } from './platform';
import type { History } from './history';

export interface ControllerDeps {
  platform: Platform;
  history: History;
  tempRoot: string;
  settings(): Settings;
  dictionary(): Dictionary;
  sendCapture(command: CaptureCommand): void;
  copy(text: string): void;
  showOverlay(): void;
  /** Hide the overlay after `ms`; a later showOverlay() cancels it. */
  hideOverlay(ms: number): void;
  /** The main window has focus, so the in-app UI already shows progress. */
  appFocused(): boolean;
  emit(): void;
}

const modes: readonly Mode[] = ['dictation', 'edit', 'command', 'translation'];
const busy = ['arming', 'recording', 'transcribing', 'transforming', 'inserting'];
const codeOf = (error: unknown, fallback: string) =>
  error instanceof Error && /^[A-Z][A-Z_0-9]+$/.test(error.message) ? error.message : fallback;

/** Owns one recording at a time: microphone frames in, transcript out, delivered to the right place. */
export class Controller {
  s: Session | null = null;
  trigger: Trigger | null = null;
  notice = '';
  delivered: Delivered | null = null;
  quitting = false;
  engineReady = false;
  private pcm = new Float32Array(0);
  private used = 0;
  private sequence = 0;
  private level = 0;
  private startedAt = 0;
  private lastFrame = 0;
  private lastPaint = 0;
  private lastToggle = 0;
  private lastPreview = 0;
  private pttAt = 0;
  private opening = false;
  private stopped = false;
  private processing: Promise<void> | null = null;
  private generation = 0;
  private whisper: { key: string; engine: Whisper } | null = null;
  private llama: { key: string; engine: Llama } | null = null;
  private readonly vad = new EnergyVad();
  readonly preview = new PreviewScheduler();

  constructor(private readonly deps: ControllerDeps) {}

  view(): Pick<
    View,
    'id' | 'state' | 'mode' | 'trigger' | 'level' | 'elapsed' | 'text' | 'partial' | 'notice' | 'delivered' | 'timings'
  > {
    const s = this.s;
    return {
      id: s?.id ?? null,
      state: s?.state ?? 'idle',
      mode: s?.mode ?? this.deps.settings().mode,
      trigger: this.trigger,
      level: this.level,
      elapsed: this.used / RATE,
      text: s?.text ?? '',
      partial: s?.partial ?? '',
      notice: s?.notice || this.notice,
      delivered: this.delivered,
      timings: s?.timings ?? {},
    };
  }

  get idle(): boolean {
    return !this.opening && !this.processing && !(this.s && busy.includes(this.s.state));
  }

  // ------------------------------------------------------------------ engines

  private engine(settings: Settings): Whisper {
    const gpu = settings.gpu && !!settings.whisper!.gpu;
    const key = [
      settings.whisper!.path,
      settings.whisper!.sha256,
      settings.asrModel!.sha256,
      settings.threads,
      gpu,
    ].join('|');
    if (this.whisper?.key !== key)
      this.whisper = {
        key,
        engine: new Whisper(settings.whisper!, settings.asrModel!, this.deps.tempRoot, settings.threads, gpu),
      };
    return this.whisper.engine;
  }

  private model(settings: Settings): Llama | null {
    if (!settings.llama || !settings.llmModel) return null;
    const key = [settings.llama.sha256, settings.llmModel.sha256, settings.threads].join('|');
    if (this.llama?.key !== key)
      this.llama = { key, engine: new Llama(settings.llama, settings.llmModel, this.deps.tempRoot, settings.threads) };
    return this.llama.engine;
  }

  /** Verify engine files and warm the disk cache in the background, so the first dictation is quick. */
  warm(): void {
    const settings = this.deps.settings();
    this.engineReady = false;
    if (!settings.whisper || !settings.asrModel) return this.deps.emit();
    const engine = this.engine(settings);
    engine.prepare().then(
      () => {
        if (this.whisper?.engine !== engine) return;
        this.engineReady = true;
        if (!this.s) this.notice = '';
        this.deps.emit();
      },
      (error: unknown) => {
        if (this.whisper?.engine !== engine) return;
        this.notice = describe(codeOf(error, 'PROCESS_START_FAILED'));
        this.deps.emit();
      },
    );
    if (settings.polish || settings.mode !== 'dictation')
      void this.model(settings)
        ?.prepare()
        .catch(() => {});
  }

  // ------------------------------------------------------------------ controls

  /** Tap-to-start, tap-to-stop (shortcuts, tray, buttons). */
  async toggle(mode: Mode = this.deps.settings().mode, trigger: Trigger = 'shortcut'): Promise<void> {
    if (Date.now() - this.lastToggle < 300) return;
    this.lastToggle = Date.now();
    if (this.s?.state === 'recording') return this.stop();
    if (this.s?.state === 'arming') return this.cancel();
    return this.start(mode, trigger);
  }

  /** Hold-to-talk from the native keyboard hook. */
  pushToTalk(state: 'down' | 'up' | 'abort'): void {
    if (state === 'down') {
      if (!this.idle) return;
      this.pttAt = Date.now();
      void this.start('dictation', 'ptt').catch(() => this.fail('SHORTCUT_ACTION_FAILED'));
      return;
    }
    if (this.trigger !== 'ptt' || !this.s || !['arming', 'recording'].includes(this.s.state)) return;
    // A quick tap, or Ctrl+Win+<key> used as a Windows shortcut, is not a dictation.
    if (state === 'abort' || Date.now() - this.pttAt < 300) return this.cancel(true);
    if (this.s.state === 'arming') return this.fail('RELEASED_TOO_EARLY');
    this.stop();
  }

  async start(mode: Mode, trigger: Trigger): Promise<void> {
    if (!this.idle) return;
    if (!modes.includes(mode)) throw new Error('INVALID_MODE');
    this.opening = true;
    const generation = ++this.generation;
    const activationAt = Date.now();
    try {
      if (this.s?.alive()) this.s.cancel();
      const target = await this.deps.platform.capture(mode === 'edit');
      if (generation !== this.generation || this.quitting) return;
      const s = new Session(mode, target);
      this.s = s;
      this.trigger = trigger;
      this.delivered = null;
      this.notice = '';
      this.stopped = false;
      this.sequence = 0;
      this.used = 0;
      this.level = 0;
      this.lastPreview = 0;
      this.vad.reset();
      this.startedAt = activationAt;
      s.timings['targetCaptureMs'] = Date.now() - activationAt;
      s.notice = 'Starting the microphone…';
      if (trigger !== 'ui' || !this.deps.appFocused()) this.deps.showOverlay();
      s.timings['overlayShownMs'] = Date.now() - activationAt;
      this.deps.emit();
      const settings = this.deps.settings();
      if (!settings.whisper || !settings.asrModel) return this.fail('SETUP_INCOMPLETE');
      if (mode !== 'dictation' && (!settings.llama || !settings.llmModel)) return this.fail('MODE_NEEDS_LOCAL_MODEL');
      if (
        mode === 'translation' &&
        !settings.translationPairs.includes(`${settings.language}:${settings.targetLanguage}`)
      )
        return this.fail('TRANSLATION_PAIR_NOT_CONFIGURED');
      if (mode === 'edit' && !target.selection) return this.fail('NO_SELECTION');
      this.engine(settings);
      this.pcm = new Float32Array(settings.maxSeconds * RATE);
      this.lastFrame = Date.now();
      this.deps.sendCapture({
        action: 'start',
        id: s.id,
        device: settings.microphone,
        maxSeconds: settings.maxSeconds,
      });
    } finally {
      this.opening = false;
    }
  }

  stop(): void {
    if (!this.s || this.s.state !== 'recording' || this.stopped) return;
    this.stopped = true;
    this.deps.sendCapture({ action: 'stop', id: this.s.id });
  }

  cancel(quietly = false): void {
    this.generation++;
    if (this.s) {
      this.s.cancel();
      this.deps.sendCapture({ action: 'cancel', id: this.s.id });
      this.s.notice = quietly ? '' : 'Recording discarded.';
    }
    this.reset();
    this.deps.emit();
    this.deps.hideOverlay(quietly ? 0 : 900);
  }

  fail(code: string): void {
    const message = describe(code);
    const s = this.s;
    if (s && !['idle', 'cancelled', 'error'].includes(s.state)) {
      s.controller.abort();
      s.text = '';
      s.partial = '';
      s.state = 'error';
      s.notice = message;
      this.deps.sendCapture({ action: 'cancel', id: s.id });
    } else {
      this.notice = message;
      if (s) s.notice = message;
    }
    this.reset();
    this.deps.emit();
    this.deps.hideOverlay(6000);
  }

  private reset(): void {
    this.pcm = new Float32Array(0);
    this.used = 0;
    this.level = 0;
    void this.preview.stop();
  }

  /** Called twice a second: microphone that never starts, silent device, safety limit. */
  tick(): void {
    const s = this.s;
    if (s?.state === 'arming' && Date.now() - this.startedAt > 30000) this.fail('MICROPHONE_PERMISSION_TIMEOUT');
    if (s?.state === 'recording') {
      if (Date.now() - this.lastFrame > 4000) this.fail('MICROPHONE_NO_FRAMES');
      else if (Date.now() - this.startedAt >= this.deps.settings().maxSeconds * 1000) this.stop();
    }
  }

  // ------------------------------------------------------------------ capture renderer

  started(id: unknown, rate: unknown): void {
    const s = this.s;
    if (!s || id !== s.id || !s.alive() || s.state !== 'arming') {
      if (typeof id === 'string') this.deps.sendCapture({ action: 'cancel', id });
      return;
    }
    if (typeof rate !== 'number' || rate < 8000 || rate > 192000) return this.fail('UNSUPPORTED_SAMPLE_RATE');
    s.timings['captureRate'] = rate;
    s.timings['recordingFeedbackMs'] = Date.now() - this.startedAt;
    s.move('recording');
    s.notice = '';
    this.startedAt = Date.now();
    this.lastFrame = Date.now();
    this.deps.emit();
  }

  frame(id: unknown, index: unknown, frame: unknown): boolean {
    const s = this.s;
    if (!s || id !== s.id || !s.alive() || !['arming', 'recording'].includes(s.state)) return false;
    if (
      !Number.isInteger(index) ||
      index !== this.sequence ||
      !(frame instanceof Float32Array) ||
      frame.length < 1 ||
      frame.length > FRAME ||
      frame.some(x => !Number.isFinite(x) || Math.abs(x) > 1.001)
    ) {
      this.fail('INVALID_AUDIO_FRAME');
      return false;
    }
    this.sequence++;
    this.lastFrame = Date.now();
    if (this.used + frame.length > this.pcm.length) {
      this.stop();
      return true;
    }
    this.pcm.set(frame, this.used);
    this.used += frame.length;
    this.level = rms(frame);
    this.vad.accept(frame);
    const settings = this.deps.settings();
    if (settings.silenceStop && this.vad.hasSpeech && this.vad.silenceFrames > 75) this.stop();
    if (Date.now() - this.lastPaint > 60) {
      this.lastPaint = Date.now();
      this.deps.emit();
    }
    const engine = this.whisper?.engine;
    if (
      settings.preview &&
      s.state === 'recording' &&
      !this.stopped &&
      engine &&
      this.vad.hasSpeech &&
      this.used - this.lastPreview >= RATE * 4
    ) {
      const audio = this.pcm.slice(Math.max(0, this.used - RATE * 12), this.used);
      const prompt = settings.vocabularyPrompt
        ? vocabularyPrompt(this.deps.dictionary(), profileFor(s.target, settings))
        : '';
      this.lastPreview = this.used;
      this.preview.offer(
        signal => engine.transcribe(audio, settings.language, signal, prompt || undefined),
        text => {
          if (this.s !== s || !s.alive() || s.state !== 'recording' || this.stopped) return;
          s.partial = text;
          s.timings['firstPreviewMs'] ??= Date.now() - this.startedAt;
          this.deps.emit();
        },
      );
    }
    return true;
  }

  stoppedCapture(id: unknown): void {
    const s = this.s;
    if (!s || id !== s.id || !s.alive() || s.state !== 'recording' || this.processing) return;
    s.move('transcribing');
    const stop = performance.now();
    s.partial = '';
    s.notice = '';
    this.level = 0;
    this.deps.emit();
    const audio = this.pcm.slice(0, this.used);
    const seconds = this.used / RATE;
    this.pcm = new Float32Array(0);
    const settings = structuredClone(this.deps.settings());
    const dictionary = structuredClone(this.deps.dictionary());
    this.processing = (async () => {
      await this.preview.stop();
      if (!s.alive() || !this.whisper) return;
      const llm = s.mode !== 'dictation' || settings.polish ? this.model(settings) : null;
      await finalPipeline(
        s,
        audio,
        this.whisper.engine,
        llm,
        dictionary,
        settings,
        profileFor(s.target, settings),
        () => this.deps.emit(),
      );
      s.timings['stopToReadyMs'] = performance.now() - stop;
      if (s.alive()) await this.deliver(s, settings, seconds);
    })()
      .catch(error => {
        if (this.s === s && s.alive()) this.fail(codeOf(error, 'TRANSCRIPTION_FAILED'));
      })
      .finally(() => {
        audio.fill(0);
        this.processing = null;
        this.deps.emit();
      });
  }

  failedCapture(id: unknown, code: unknown): void {
    if (this.s && id === this.s.id && this.s.alive())
      this.fail(typeof code === 'string' && /^[A-Z_]{1,80}$/.test(code) ? code : 'CAPTURE_FAILED');
  }

  // ------------------------------------------------------------------ delivery

  /** Paste into the app you were in, or copy, or keep the result in BattyFlow. */
  private async deliver(s: Session, settings: Settings, seconds: number): Promise<void> {
    const text = s.text;
    if (!text) {
      this.deps.hideOverlay(1500);
      return;
    }
    let delivered: Delivered = 'kept';
    const own = s.target.pid === process.pid;
    if (settings.delivery === 'copy' || (settings.delivery === 'paste' && !own && !s.target.identity)) {
      this.deps.copy(text);
      delivered = 'copied';
      s.notice ||= 'Copied. Press Ctrl+V to paste.';
    } else if (settings.delivery === 'paste' && !own) {
      const unchanged = s.mode !== 'edit' || (await this.selectionUnchanged(s));
      if (!s.alive()) return;
      s.claimInsertion();
      this.deps.emit();
      const result = unchanged
        ? await this.deps.platform.paste(forTarget(text, s.target, settings), s.target, {
            restore: settings.restoreClipboard,
          })
        : 'selection-changed';
      if (result === 'pasted') {
        delivered = 'pasted';
      } else {
        this.deps.copy(text);
        delivered = 'copied';
        s.notice = describe(`PASTE_${result}`);
      }
      if (s.state === 'inserting') s.move('idle');
    }
    this.delivered = delivered;
    if (settings.history)
      await this.deps.history.add({
        id: randomUUID(),
        at: Date.now(),
        text,
        mode: s.mode,
        seconds,
        words: countWords(text),
        delivered,
      });
    this.deps.emit();
    this.deps.hideOverlay(delivered === 'pasted' ? 1200 : delivered === 'copied' && s.notice.length > 40 ? 5000 : 2500);
  }

  private async selectionUnchanged(s: Session): Promise<boolean> {
    const now = await this.deps.platform.capture(true);
    return (
      !!s.target.identity &&
      !!s.target.selection &&
      now.identity === s.target.identity &&
      now.field === s.target.field &&
      now.selection === s.target.selection
    );
  }

  // ------------------------------------------------------------------ results in the app

  copyResult(id: unknown): void {
    const s = this.s;
    if (
      typeof id !== 'string' ||
      id !== s?.id ||
      s.controller.signal.aborted ||
      !['ready', 'idle'].includes(s.state) ||
      !s.text
    )
      throw new Error('RESULT_UNAVAILABLE');
    this.deps.copy(s.text);
    s.notice = 'Copied.';
    this.deps.emit();
  }

  insertTest(id: unknown): string {
    const s = this.s;
    if (typeof id !== 'string' || id !== s?.id || !s.text) throw new Error('RESULT_UNAVAILABLE');
    s.claimInsertion();
    const text = s.text;
    s.move('idle');
    s.notice = '';
    this.deps.emit();
    return text;
  }

  async shutdown(): Promise<void> {
    this.quitting = true;
    this.cancel(true);
    await Promise.allSettled([this.processing, this.preview.stop()]);
  }
}
