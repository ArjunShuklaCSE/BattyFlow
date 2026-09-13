# BattyFlow

A local Electron dictation application for Windows, with explicit fallback adapters for macOS, X11, and Wayland. **This is a working preview, not an acceptance-complete release.** Windows capture, real Whisper transcription, vocabulary resolution, preview, explicit copy, and in-app insertion are implemented. External automatic insertion is deliberately not enabled. See [implementation status](IMPLEMENTATION_STATUS.md) for failed and unverified gates.

## Run the available Windows build

Open `release/BattyFlow 0.1.0.exe` (unsigned portable launcher), or `release/win-unpacked/BattyFlow.exe`. The model and native inference runtimes are separate from the package. The build does not download anything at startup.

1. Open **Local models**. Import `.local/manifests/whisper.json`, then `.local/manifests/asrModel.json`. These manifests reference the runtime/model acquired in this workspace. Keep the runtime's DLLs beside its executable.
2. Grant microphone access in Windows Settings → Privacy & security → Microphone. BattyFlow requests audio only; camera permission is denied.
3. Use **Start recording**, or **Ctrl+Alt+D**, speak, then press the same control to stop. The shortcut is **Cmd+Alt+D** on macOS, where validation is still outstanding.
4. Review the transcript. **Insert result into test field** exercises the app's own editor. **Copy text** replaces clipboard contents on your explicit request; choose the intended external field and paste manually.
5. **Cancel** remains available in the app, overlay, and tray. No permanent Escape binding is installed. Closing the main window hides it when a tray is available; use tray **Quit** to exit.

Optional: import `.local/manifests/llama.json` and `.local/manifests/llmModel.json` for local cleanup/command drafting. The tested small Qwen model has known quality failures; review all results. Dictation falls back to the alias-resolved pre-cleanup transcript on validation failures. Other modes fail visibly. Translation pairs start empty. Windows selection editing uses the dedicated **Ctrl+Alt+E** shortcut and always offers a preview/manual replacement; an empty, secure, or unavailable selection cannot begin an edit.

## Development

Validated host: Windows 11 build 26200, x64, Intel i7-12700H, Node 24.18.0/npm 11.16.0. Windows build also needs the .NET Framework 4.x C# compiler and UI Automation assemblies shipped with this host. Keep the project on a local filesystem. No npm runtime dependencies are used.

```powershell
npm ci
npm run check
npm start
npm run test:desktop
node scripts/capture-smoke.mjs
node scripts/capture-smoke.mjs --physical
node scripts/failure-smoke.mjs
node scripts/target-smoke.mjs
npm run package
node scripts/capture-smoke.mjs --packaged
```

Dependency installation, Electron's development binary acquisition, and electron-builder's packaging-resource acquisition need internet access. Those are developer operations outside the application. A restricted shell may need permission to execute native build tools. The lockfile pins resolved dependencies. The package is unsigned; signing/notarization is not configured. macOS/Linux packaging recipes are provided but not validated.

## Offline model setup

See [model setup](docs/models.md) for pinned versions, checksums, capabilities, licenses, and manual acquisition. Import **JSON asset manifests**, not a model renamed to JSON. Models may remain in an explicitly selected local directory; settings store only their paths and metadata. UNC/network paths are rejected. You must avoid mapped network drives too: drive-type verification is not implemented. A checksum made from an arbitrary file establishes integrity, not publisher authenticity.

No account, API key, hosted inference, updater, telemetry, repository indexing, or command execution is present. Runtime guards are defense in depth; see [privacy](docs/privacy.md) for the native-process boundary and OS firewall procedure. Text copied or inserted into another app follows that app's data handling.

## Evaluation

```powershell
# Local synthesis: 18 original test sentences/noise cases; not human recordings.
npm run fixtures:synthetic
node scripts/finalize-fixtures.mjs

npm run benchmark -- --passes 2
npm run benchmark -- --llama .local/manifests/llama.json --llm-model .local/manifests/llmModel.json --output benchmark/results/with-cleanup
npm run benchmark -- --baseline benchmark/results/latest/report.json --max-latency-ratio 1.25 --max-wer-delta 0.02 --output benchmark/results/comparison
```

The cleanup comparison may exit nonzero because required validation fails. This is an evaluation result, not an installation error. Reports include per-case outputs, separate raw/cleaned references, exact identifier counts, hashes, and measurements. See [benchmark methodology](benchmark/README.md) and [verification evidence](docs/verification.md). No benchmark sends text into arbitrary user applications.

## Layout

- `src/main`: lifecycle, inference, settings, privacy, vocabulary, platform boundaries.
- `src/preload`: separate narrow UI and audio bridges.
- `src/renderer`: settings/studio, non-activating overlay, hidden capture renderer, AudioWorklet.
- `native/windows`: read-only UI Automation probe; never copies, pastes, or sends keystrokes.
- `tests`, `scripts`, `benchmark`: deterministic invariants, desktop checks, and real inference measurements.

Read [decisions](docs/decisions.md), [platform support](docs/platform-support.md), and [remaining gates](IMPLEMENTATION_STATUS.md) before treating this preview as a daily-driver automatic dictation tool.
