export type State =
  'idle' | 'arming' | 'recording' | 'transcribing' | 'transforming' | 'ready' | 'inserting' | 'cancelled' | 'error';
export type Mode = 'dictation' | 'edit' | 'command' | 'translation';
export type Profile = 'neutral' | 'chat' | 'email' | 'code' | 'terminal';
export type PushToTalk = 'ctrl-win' | 'right-ctrl' | 'right-alt' | 'caps-lock' | 'off';
export type Delivery = 'paste' | 'copy' | 'none';
export type AssetKind = 'whisper' | 'asrModel' | 'llama' | 'llmModel';
export type Trigger = 'ptt' | 'shortcut' | 'ui' | 'tray';
export type Theme = 'dark' | 'light' | 'system';
/** How a finished transcript reached the user. */
export type Delivered = 'pasted' | 'copied' | 'kept';
export type PasteResult =
  | 'pasted'
  | 'focus-changed'
  | 'selection-changed'
  | 'elevated'
  | 'secure'
  | 'keys-held'
  | 'clipboard-busy'
  | 'unavailable';

export interface Target {
  platform: string;
  identity: string | null;
  field: string | null;
  secure: boolean | null;
  terminal: boolean;
  elevated?: boolean;
  /** Lowercase process name of the foreground app, used to pick a writing profile. Never stored. */
  app?: string | null;
  pid?: number;
  selection?: string;
}
export interface AsrEngine {
  transcribe(pcm: Float32Array, language: string, signal: AbortSignal, prompt?: string): Promise<string>;
}
export interface TextTransformer {
  transform(data: TransformData, signal: AbortSignal): Promise<string>;
}
export interface TransformData {
  mode: Mode;
  transcript: string;
  profile: Profile;
  protectedSpans: string[];
  selectedText?: string;
  editingInstruction?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
}
export interface Entry {
  canonical: string;
  spokenAliases: string[];
  scope?: { profile?: Profile | 'any'; app?: string; project?: string };
}
export interface Dictionary {
  schemaVersion: 1;
  entries: Entry[];
}
export interface Asset {
  path: string;
  sha256: string;
  size: number;
  name: string;
  provenance: string;
  license: string;
  languages: string[];
  version: string;
  /** Catalog entry this asset was installed from, if any. */
  catalogId?: string;
  /** whisper.cpp runtime built with CUDA. */
  gpu?: boolean;
  dependencies?: { file: string; sha256: string; size: number }[];
}
export interface Settings {
  schemaVersion: 2;
  microphone: string;
  /** ISO 639-1 code, or "auto" for multilingual models. */
  language: string;
  profile: Profile;
  /** Pick the code/terminal/chat/email profile from the app you are dictating into. */
  autoProfile: boolean;
  mode: Mode;
  pushToTalk: PushToTalk;
  shortcut: string;
  commandShortcut: string;
  editShortcut: string;
  maxSeconds: number;
  silenceStop: boolean;
  preview: boolean;
  delivery: Delivery;
  restoreClipboard: boolean;
  trailingSpace: boolean;
  removeFillers: boolean;
  /** Bias Whisper toward the canonical spellings in the vocabulary. */
  vocabularyPrompt: boolean;
  /** Run dictation through the local LLM for cleanup when one is installed. */
  polish: boolean;
  history: boolean;
  sounds: boolean;
  launchAtLogin: boolean;
  theme: Theme;
  threads: number;
  gpu: boolean;
  targetLanguage: string;
  translationPairs: string[];
  whisper?: Asset;
  asrModel?: Asset;
  llama?: Asset;
  llmModel?: Asset;
}
export interface HistoryEntry {
  id: string;
  at: number;
  text: string;
  mode: Mode;
  seconds: number;
  words: number;
  delivered: Delivered;
}
export interface Stats {
  sessions: number;
  words: number;
  wordsToday: number;
  /** Speaking speed over all history, in words per minute of audio. */
  wpm: number | null;
}
export interface DownloadState {
  state: 'queued' | 'downloading' | 'verifying' | 'extracting' | 'error';
  received: number;
  total: number;
  error?: string;
}
export interface View {
  id: string | null;
  state: State;
  mode: Mode;
  trigger: Trigger | null;
  level: number;
  elapsed: number;
  text: string;
  partial: string;
  notice: string;
  delivered: Delivered | null;
  settings: Settings;
  capabilities: Record<string, string>;
  timings: Record<string, number>;
  installed: string[];
  downloads: Record<string, DownloadState>;
  stats: Stats;
  gpu: string | null;
  version: string;
  platform: string;
  engineReady: boolean;
}
export type CaptureCommand =
  | { action: 'start'; id: string; device: string; maxSeconds: number }
  | { action: 'stop'; id: string }
  | { action: 'cancel'; id: string };
export interface UIAPI {
  snapshot(): Promise<View>;
  toggle(mode?: Mode): Promise<void>;
  cancel(): Promise<void>;
  copy(id: string): Promise<void>;
  copyText(text: string): Promise<void>;
  insertTest(id: string): Promise<string>;
  save(settings: Settings): Promise<void>;
  importAsset(kind: AssetKind): Promise<void>;
  download(id: string): Promise<void>;
  cancelDownload(id: string): Promise<void>;
  useAsset(id: string): Promise<void>;
  removeAsset(id: string): Promise<void>;
  dictionary(): Promise<Dictionary>;
  saveDictionary(value: Dictionary): Promise<void>;
  importDictionary(): Promise<Dictionary | null>;
  exportDictionary(): Promise<void>;
  history(): Promise<HistoryEntry[]>;
  deleteHistory(id: string): Promise<void>;
  clearHistory(): Promise<void>;
  showSettings(): Promise<void>;
  hideOverlay(): Promise<void>;
  overlayHover(inside: boolean): Promise<void>;
  suspendShortcuts(suspended: boolean): Promise<void>;
  openLink(name: 'repo' | 'issues' | 'models' | 'privacy'): Promise<void>;
  devices(): Promise<{ deviceId: string; label: string }[]>;
  onView(callback: (view: View) => void): void;
}
export interface CaptureAPI {
  onCommand(callback: (command: CaptureCommand) => void): void;
  frame(id: string, sequence: number, samples: Float32Array): Promise<boolean>;
  started(id: string, rate: number): Promise<void>;
  stopped(id: string): Promise<void>;
  failed(id: string, code: string): Promise<void>;
  onDevices(callback: () => Promise<{ deviceId: string; label: string }[]>): void;
}
declare global {
  interface Window {
    batty: UIAPI;
    capture: CaptureAPI;
  }
}
