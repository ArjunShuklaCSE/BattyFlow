# Decisions

- 2026-09-14: Empty repository; Electron + strict TypeScript, vanilla renderer and esbuild. Node built-in test runner through tsx. No runtime npm dependencies.
- Windows x64 is the first validation target. A packaged read-only UI Automation helper captures original foreground/field identity and explicit selected ranges. macOS/X11/Wayland have explicit unavailable fallbacks. Unvalidated external insertion fails closed to manual copy. No arbitrary clipboard content is treated as a selection.
- Toggle controls only. Electron globalShortcut has no release callback. Push-to-talk stays unavailable until a native key-up adapter passes platform checks.
- Whisper.cpp v1.8.3 CPU CLI is the baseline contract. Runtime/model acquisition is a developer action outside the app. The packaged app imports local files and never fetches them.
- Optional transformation uses pinned llama.cpp b6532 in single-turn conversation mode, with separate system/data files and the model's chat template. Actual CLI framing was verified: b6532 emits a terminal `[end of text]` marker; missing terminal markers or generation-cap evidence cause rejection. No Ollama adapter is shipped; its cloud-disable prerequisite is not silently assumed.
- CLI inference uses restrictive temporary WAV/prompt files, deleted in finally and on startup. No secure-erasure claim. Default retention and content diagnostics disabled; neither is implemented as implicit history.
- Initial safe delivery is a recoverable preview and explicit copy. In-app test-field insertion is separately validated. This does not satisfy external automatic insertion acceptance gates.
- Preview is a replaceable latest-12-second provisional window, at most one job every four seconds. It has no committed segment concatenation; final ASR uses the entire utterance. This is incremental preview, not native token streaming or a complete rolling-transcript implementation.
- All captured audio is retained until finalization, so the energy detector never clips onset/trailing phonemes. Auto-stop is opt-in and keeps 1.5 seconds of trailing silence. Its energy threshold is not a robust general-purpose speech classifier.
- Window titles and project context stay disabled. Target identity is collected for safety independently of optional semantic context. External edits remain preview/manual even when a selection can be revalidated; string equality is not cursor proof.
- Native probe time is included in activation-to-microphone-ready measurements. Earlier bootstrap measurements without that probe are labeled historical; do not compare them as current latency.
- Windows firewall service is running but the available user token is not Administrator. Full OS-blocked-egress acceptance remains unexecuted; JavaScript guards cannot substitute for it.
- Synthetic smoke audio will be explicitly labeled with synthesis engine and voice. It is not evidence for human accents or population accuracy.
