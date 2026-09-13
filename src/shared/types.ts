export type State = 'idle' | 'arming' | 'recording' | 'transcribing' | 'transforming' | 'ready' | 'inserting' | 'cancelled' | 'error';
export type Mode = 'dictation' | 'edit' | 'command' | 'translation';
export type Profile = 'neutral' | 'chat' | 'email' | 'code' | 'terminal';
export interface Target { platform: string; identity: string | null; field: string | null; secure: boolean | null; terminal: boolean; selection?: string }
export interface ContextProvider { capture(): Promise<Target> }
export interface SelectionProvider { read(target: Target): Promise<string | null>; validate(target: Target): Promise<boolean> }
export interface TextInserter { insert(text: string, target: Target, signal: AbortSignal): Promise<'attempted' | 'confirmed' | 'manual'> }
export interface AudioSource { start(id: string, device: string): Promise<void>; stop(id: string): Promise<void> }
export interface VadEngine { accept(frame: Float32Array): boolean; reset(): void }
export interface AsrEngine { transcribe(pcm: Float32Array, language: string, signal: AbortSignal): Promise<string> }
export interface TextTransformer { transform(data: TransformData, signal: AbortSignal): Promise<string> }
export interface TransformData { mode: Mode; transcript: string; profile: Profile; protectedSpans: string[]; selectedText?: string; editingInstruction?: string; targetLanguage?: string }
export interface Entry { canonical: string; spokenAliases: string[]; scope?: { profile?: Profile | 'any'; app?: string; project?: string } }
export interface Dictionary { schemaVersion: 1; entries: Entry[] }
export interface Asset { path: string; sha256: string; size: number; name: string; provenance: string; license: string; languages: string[]; version: string; dependencies?: { file: string; sha256: string; size: number }[] }
export interface Settings {
  schemaVersion: 1; microphone: string; language: string; profile: Profile; mode: Mode;
  shortcut: string; commandShortcut: string; editShortcut: string; maxSeconds: number;
  silenceStop: boolean; rawFallback: boolean; preview: boolean; context: boolean;
  threads: number; targetLanguage: string; translationPairs: string[];
  whisper?: Asset; asrModel?: Asset; llama?: Asset; llmModel?: Asset;
}
export interface View {
  id: string | null; state: State; mode: Mode; level: number; elapsed: number;
  text: string; partial: string; notice: string; settings: Settings;
  capabilities: Record<string, string>; timings: Record<string, number>;
}
export type CaptureCommand = { action: 'start'; id: string; device: string; maxSeconds: number } | { action: 'stop'; id: string } | { action: 'cancel'; id: string };
export interface UIAPI {
  snapshot(): Promise<View>; toggle(mode?: Mode): Promise<void>; cancel(): Promise<void>;
  copy(id: string): Promise<void>; insertTest(id: string): Promise<string>;
  save(settings: Settings): Promise<void>; importAsset(kind: 'whisper' | 'asrModel' | 'llama' | 'llmModel'): Promise<void>;
  dictionary(): Promise<Dictionary>; saveDictionary(value: Dictionary): Promise<void>;
  importDictionary(): Promise<Dictionary | null>; exportDictionary(): Promise<void>;
  showSettings(): Promise<void>; devices(): Promise<{ deviceId: string; label: string }[]>;
  onView(callback: (view: View) => void): void;
}
export interface CaptureAPI {
  onCommand(callback: (command: CaptureCommand) => void): void;
  frame(id: string, sequence: number, samples: Float32Array): Promise<boolean>;
  started(id: string, rate: number): Promise<void>; stopped(id: string): Promise<void>;
  failed(id: string, code: string): Promise<void>;
  onDevices(callback: () => Promise<{ deviceId: string; label: string }[]>): void;
}
declare global { interface Window { batty: UIAPI; capture: CaptureAPI } }
