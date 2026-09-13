# Verification and remaining gates

Windows 11 build 26200, x64; Intel i7-12700H, 20 logical CPUs, 16,849,293,312 bytes physical RAM. Node 24.18.0, npm 11.16.0, Electron 44.3.0. All dates in JSON evidence are UTC; the host timezone is Asia/Calcutta. Source was bootstrapped in an empty directory. The initial source/lockfile commit is `ff38be81d4163acba9bc26687a855c2ed0c1ba99`; benchmark reports identify that exact measured source state. Later changes include integrity/language guards, additional test entrypoints and documentation.

## Executed checks

| Command/check | Result / evidence |
|---|---|
| `npm run check` | TypeScript/build pass; 25 focused Node tests pass |
| `npm run test:desktop` | Launch/quit, missing-model message, sandbox isolation, renderer fetch denial, device enumeration and dictionary UI pass; [bootstrap evidence](evidence/desktop-bootstrap.json) |
| `node scripts/capture-smoke.mjs` | Real Whisper from synthetic Chromium microphone → AudioWorklet → 16 kHz PCM; in-app insertion preserves prefix; cancel/recovery pass; [capture evidence](evidence/capture.json) |
| `node scripts/capture-smoke.mjs --physical` | Physical mic opens at 48 kHz; frames arrive; cancel and quit release it. No physical microphone transcript or recording retained; [evidence](evidence/physical-microphone.json) |
| `node scripts/capture-smoke.mjs --preview` | Real provisional preview and final ASR; no concatenated duplicate final text; [evidence](evidence/preview.json) |
| `node scripts/failure-smoke.mjs` | Controlled permission denial, missing device, role-forged IPC, Node fetch denial, recovery pass; [evidence](evidence/controlled-failures.json) |
| `node scripts/target-smoke.mjs` | Read-only Windows native helper retrieves only selected range in a controlled Chromium textarea, reports no empty selection, blocks password content; [evidence](evidence/windows-target.json) |
| `npm run benchmark -- --passes 2 --output benchmark/results/baseline-final` | 36 real native ASR calls, exit 0 for executed raw gates; [JSON](evidence/baseline.json), [table](evidence/baseline.md) |
| `npm run benchmark -- --llama .local/manifests/llama.json --llm-model .local/manifests/llmModel.json --output benchmark/results/cleanup-final` | Actual three-configuration comparison; exit **1** for two adversarial cleanup validation failures; [JSON](evidence/cleanup-comparison.json), [table](evidence/cleanup-comparison.md) |
| Native process tests | Timeout, crash, output overflow, pre-cancel, split UTF-8 decoding, stale result and preview cancellation pass |
| Clipboard transaction tests | Focus switch, rich-format fallback, newer-copy race, cancel during revalidation, at-most-once insertion pass; abstraction is not connected to external apps |
| Temp cleanup / ACL | Protected session directories empty after success, failed transformation and cancellation checks; sandbox token cannot enumerate them, current user can; no secure-erasure claim |
| Hash provenance | Both model SHA-256 values match official LFS manifests. Whisper archive matches official release digest `d824b1e37599f882b396e73f1ee0bfd5d0529f700314c48311dcbd00b803321d` |
| Sampled network observation | 26 snapshots over ~15 seconds; Electron/Whisper seen, 0 established external TCP samples, 0 UDP endpoint samples, 18 loopback samples from test debugging. This is not packet-level proof; [evidence](evidence/network-observation.json) |
| OS outbound blocking | **Not executed.** Token is not Administrator; firewall service running. Follow [privacy procedure](privacy.md) |
| `npm run package` / `node scripts/portable-smoke.mjs` | Final self-extracting Windows launcher passes extraction, real ASR, in-app insertion, cancellation, visible tray asset, native helper presence and clean quit; [portable evidence](evidence/portable.json). Unsigned artifact hash/size: [artifact manifest](evidence/artifact.json) |
| Invalid regression threshold | `npm run benchmark -- --max-wer invalid` exits 1 immediately with `INVALID_THRESHOLD`; it cannot silently disable the gate |
| Benchmark importer | Imported the existing synthetic plain-speech clip into an isolated empty manifest, deriving its hash/duration without changing the baseline corpus; typecheck passes |

## Measured results and review

18 synthetic clips × 2 passes, Whisper tiny.en F16, CPU `-ng`, 4 threads. Raw speech-only corpus WER **0.19658**. ASR p50 **873.31 ms**, p95 **973.57 ms**, n=36. Every call reloads the model; these are not persistent warm-engine measurements. Vocabulary-only exact identifiers: **8/16** expected occurrences. Raw silence/noise generated six words/tokens across two passes; VAD-gated delivery was empty. No native peak-memory measurement is available.

An earlier bootstrap aggregate of 22.2% included silence insertions in its WER numerator. The final calculation separates zero-reference hallucinations and reports speech-only WER, consistent with the declared policy. Per-case raw outputs did not change. No benchmark number is hard-coded into app behavior.

With the native target probe, one developer capture measured **201 ms** target capture, **203 ms** overlay shown, **298 ms** recording-ready feedback, and **941 ms** stop-to-ready. A preview case measured first preview at **5,073 ms** after recording start and final stop-to-ready **896 ms**. These are single-case measurements, not p95 claims. The **150 ms recording feedback target is not met**. Bootstrap 91 ms and physical 250 ms measurements predate the native probe and are retained only as historical evidence.

The local Qwen 0.5B model removed fillers in the `fillers` case, and preserved negation and meaningful “like” in tested cases. It left “5, actually 6” unresolved; correction-cleanup acceptance is therefore not passed. It failed the adversarial transcript in both cleanup configurations with `CLEANUP_LENGTH_DIVERGENCE`; the app rejects that transformation and exposes the pre-cleanup transcript. It drafted an unrequested fenced code block in the command smoke; the final guard rejects that case. Model output cannot access shell/IPC/tool actions.

Review of synthetic outputs, not an independent human study: `42` versus “forty two,” and `6` versus “six,” are numeric representation differences, not evidence that those numbers changed meaning. The reported lexical critical-content candidates need this distinction. “Kubernetes” → “Cuba Arnett” and repeated “oh auth” → “a loss” are genuine technical recognition failures in this synthetic suite; the resolver does not invent repairs for them. Translation, free-form edit quality, human accents, stronger background noise and population accuracy remain unevaluated.

## Manual and environmental work still required

1. Collect 15–20 consented, legally redistributable human clips with clear reference annotations and more realistic noise/accent variation; preserve held-out separation. The synthetic suite is only a smoke test.
2. Build and validate native insertion for a narrow set of named targets. Cover exact field/selection identity, focus changes, clipboard generation/formats if used, secure/elevated apps, terminal/newline behavior and uncertain delivery. Automatic external insertion remains disabled until that work passes.
3. Exercise actual global-key presses, key repeat, rapid toggle sequences, sleep/wake and unplugging hardware manually. Registration and controlled failure simulations supplement these checks.
4. Run application, helper and inference processes under the administrator firewall rules and packet/WFP observation. Test the extracted portable process path too. Sampled TCP checks do not establish zero egress.
5. Select and evaluate a stronger local transformation configuration; pass meaning/correction, adversarial, edit and translation fixtures before claiming those modes reliable. Validated placeholders are not proof of semantic fidelity.
6. Obtain Windows signing credentials, and macOS signing/notarization/accessibility/microphone testing on macOS hardware. Test X11/Wayland separately, including portal identity and permission behavior. No cross-platform support claim is made from this Windows run.

The project must remain marked incomplete while these core acceptance gates fail or remain unverified.

Final portable run: target capture **189 ms**, overlay shown **190 ms**, microphone-ready **262 ms**, stop-to-ready **904 ms** for the synthetic plain-speech case. The tray image is nonempty with visible pixels. The initial transparent/invalid tray asset was found during artifact testing and replaced before this run. Playwright's usual Electron launcher handshake does not work through the self-extracting wrapper; the successful test used explicitly enabled loopback debugging ports and detached the test debugger before waiting for app shutdown. These debugging flags are absent in normal application operation.
