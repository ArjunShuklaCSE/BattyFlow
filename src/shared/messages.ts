// Every error code the app can raise, in words a person can act on.
const messages: Record<string, string> = {
  SETUP_INCOMPLETE: 'Speech recognition isn’t set up yet. Open BattyFlow and download a speech model.',
  MODE_NEEDS_LOCAL_MODEL: 'This mode needs the local language model. Download it under Models, or switch to Dictation.',
  LOCAL_TRANSFORMER_REQUIRED:
    'This mode needs the local language model. Download it under Models, or switch to Dictation.',
  TRANSLATION_PAIR_NOT_CONFIGURED: 'Add this language pair under Settings → Translation first.',
  NO_SELECTION: 'Select some text first, then press the edit shortcut.',
  MICROPHONE_PERMISSION_DENIED:
    'Windows blocked the microphone. Allow it in Settings → Privacy & security → Microphone.',
  MICROPHONE_PERMISSION_TIMEOUT: 'The microphone didn’t start. Another app may be holding it.',
  MICROPHONE_NOT_FOUND: 'No microphone found. Plug one in, or pick another one in Settings.',
  MICROPHONE_DISCONNECTED: 'The microphone was disconnected.',
  MICROPHONE_NO_FRAMES: 'The microphone stopped sending audio.',
  MICROPHONE_START_FAILED: 'The microphone couldn’t start.',
  RELEASED_TOO_EARLY: 'Released before the microphone was ready. Hold the key a moment longer.',
  RENDERER_EXITED_RESTART_APP: 'Part of BattyFlow stopped unexpectedly. Restart the app.',
  INFERENCE_TIMEOUT: 'Transcription took too long and was stopped.',
  PROCESS_START_FAILED: 'The speech engine wouldn’t start. Reinstall it under Models.',
  PROCESS_FAILED: 'The speech engine crashed. If you picked the NVIDIA engine, check your GPU driver or switch to CPU.',
  ASSET_CHECKSUM_MISMATCH: 'A model or engine file changed on disk. Reinstall it under Models.',
  RUNTIME_DEPENDENCY_CHECKSUM_MISMATCH: 'An engine file changed on disk. Reinstall it under Models.',
  TRUSTED_MODEL_MANIFEST_MISMATCH: 'That file has the name of a known model but different contents.',
  WHISPER_CLI_INCOMPATIBLE: 'This whisper.cpp build isn’t compatible. Install the one from the Models page.',
  LLAMA_CLI_INCOMPATIBLE: 'This llama.cpp build isn’t compatible. Install the one from the Models page.',
  ASR_LANGUAGE_UNSUPPORTED:
    'This speech model doesn’t know the selected language. Use a multilingual model or change the language.',
  ASR_BUSY: 'Still working on the previous recording.',
  ASR_OUTPUT_INVALID: 'The speech engine returned something unreadable.',
  TRANSCRIPTION_FAILED: 'Transcription failed.',
  CANCEL_SESSION_BEFORE_IMPORT: 'Finish or cancel the current recording first.',
  CANCEL_SESSION_BEFORE_DISMISSING: 'Finish or cancel the current recording first.',
  SESSION_ACTIVE: 'Finish or cancel the current recording first.',
  RESULT_UNAVAILABLE: 'That result is no longer available.',
  INSERTION_NOT_AUTHORIZED: 'That result was already used.',
  SHORTCUT_ACTION_FAILED: 'The shortcut couldn’t start a recording.',
  SHORTCUT_REQUIRES_TWO_MODIFIERS_AND_UNIQUE_KEY:
    'Shortcuts need two modifier keys (like Ctrl+Alt) and must all be different.',
  INVALID_LANGUAGE: 'Language codes look like “en” or “de”.',
  INVALID_LANGUAGE_PAIRS: 'Write language pairs like “en:es, en:fr”.',
  INVALID_SETTINGS: 'Some settings were out of range.',
  INVALID_DICTIONARY: 'That vocabulary file isn’t valid.',
  INVALID_ENTRY: 'Every vocabulary entry needs a spelling and at least one way of saying it.',
  INVALID_ALIAS: 'A spoken form is empty or too long.',
  DUPLICATE_ALIAS: 'The same spoken form appears twice for one spelling.',
  DICTIONARY_TOO_LARGE: 'That vocabulary file is too large.',
  MANIFEST_TOO_LARGE: 'That manifest is too large to be an asset manifest.',
  INVALID_ASSET: 'That isn’t a valid asset manifest.',
  ASSET_METADATA_REQUIRED: 'The manifest needs a name, version, license and source.',
  INCOMPATIBLE_MODEL_FORMAT: 'That file isn’t a whisper.cpp (ggml) or llama.cpp (GGUF) model.',
  MODEL_LANGUAGES_REQUIRED: 'The manifest must list the languages the model supports.',
  NOT_ENOUGH_DISK_SPACE: 'Not enough free disk space for this download.',
  DOWNLOAD_CHECKSUM_MISMATCH: 'The download didn’t match its published checksum and was deleted. Try again.',
  DOWNLOAD_NETWORK_FAILED:
    'The download kept failing. Check your connection and try again; it resumes where it stopped.',
  DOWNLOAD_HOST_NOT_ALLOWED: 'The download was redirected to an unexpected server, so it was stopped.',
  DOWNLOAD_IN_PROGRESS: 'That download is already running.',
  ASSET_BUSY: 'That file is being downloaded or used right now.',
  ASSET_NOT_INSTALLED: 'Download it first.',
  OPERATION_FAILED: 'Something went wrong.',
  'PASTE_focus-changed': 'You switched windows, so the text was copied instead. Press Ctrl+V to paste it.',
  'PASTE_selection-changed': 'The selected text changed while you were speaking, so the edit was copied instead.',
  PASTE_elevated: 'That app runs as administrator and Windows won’t let other apps type into it. Copied. Press Ctrl+V.',
  PASTE_secure: 'That’s a password field, so nothing was typed. The text is on your clipboard.',
  'PASTE_keys-held': 'A key was still held down, so the text was copied instead. Press Ctrl+V.',
  'PASTE_clipboard-busy': 'Another app was using the clipboard. Try Ctrl+V; if nothing appears, copy it from History.',
  PASTE_unavailable: 'Couldn’t paste here, so the text was copied. Press Ctrl+V.',
};

export function describe(code: string): string {
  if (messages[code]) return messages[code];
  if (code.startsWith('MICROPHONE_') || /AUDIO|CAPTURE|SAMPLE_RATE/.test(code))
    return 'Audio capture failed. Try again.';
  if (code.startsWith('TRANSFORMATION_')) return 'The local language model couldn’t produce a usable result.';
  if (code.startsWith('DOWNLOAD_HTTP_'))
    return `The server refused the download (HTTP ${code.slice(14)}). Try again later.`;
  if (code.startsWith('DOWNLOAD_')) return 'The download failed. Try again; it resumes where it stopped.';
  return /^[A-Z][A-Z0-9_-]+$/.test(code) ? `Something went wrong (${code}).` : code;
}
