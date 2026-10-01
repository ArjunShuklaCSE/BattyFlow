# Changelog

## 0.2.0

BattyFlow now types for you. 0.1 transcribed into its own window and left you to copy and paste; 0.2 pastes into whatever app you were using.

### New

- Push-to-talk: hold Ctrl+Win (or Right Ctrl, Right Alt, Caps Lock) anywhere, release to transcribe. The start/stop shortcut still works for long dictation.
- Pastes into the window you started in, after checking it's still in front. Skips password fields and apps running as administrator, and copies instead when it can't paste.
- Restores your clipboard after pasting, and keeps dictated text out of Windows clipboard history and cloud sync.
- One-click setup and a Models page: pinned whisper.cpp 1.9.4 builds for CPU and NVIDIA GPUs, five Whisper models and two optional Qwen2.5 models, downloaded on request with resume and SHA-256 verification.
- Your vocabulary now steers Whisper itself. Exact technical terms went from 8 to 14 out of 18 on the benchmark with the same model.
- Writing style follows the app: terminals get one-line commands, editors get code spelling, chat apps get relaxed punctuation.
- Removes "um" and "uh"; drops a sentence Whisper repeats back to back.
- History with search, and stats on the home screen.
- New interface: custom title bar, dark theme by default (light and system themes too), an overlay pill with a live waveform, a vocabulary table editor, a hotkey recorder and settings that save as you change them.
- New logo and icons. Installer and portable builds.

### Faster

- The default model is now Base (English), which is more accurate than 0.1's Tiny, and still twice as fast: 423 ms median from release to text, against 873 ms.
- A persistent native helper finds the target window in about 10 ms instead of starting a process per recording (about 200 ms).
- Files are hashed once per run instead of before every dictation; greedy decoding; a shorter encoder window for small models on the CPU.

### Changed

- Settings migrate from 0.1 automatically.
- Error messages say what to do instead of showing internal codes.
- The verification logs and evidence dumps under `docs/` were replaced by [benchmarks](https://github.com/ArjunShuklaCSE/BattyFlow/blob/main/docs/benchmarks.md), [privacy](https://github.com/ArjunShuklaCSE/BattyFlow/blob/main/docs/privacy.md), [models](https://github.com/ArjunShuklaCSE/BattyFlow/blob/main/docs/models.md) and [architecture](https://github.com/ArjunShuklaCSE/BattyFlow/blob/main/docs/architecture.md) guides.

## 0.1.0-preview

First public preview: local Whisper transcription into the app's own window, explicit copy, developer vocabulary, an optional llama.cpp cleanup pass with output validation, and a recording overlay.
