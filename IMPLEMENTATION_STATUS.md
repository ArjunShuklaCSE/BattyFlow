# Implementation status

**Working Windows preview; NOT acceptance-complete.** Source and pinned lockfile committed. No remote inference, accounts, telemetry or runtime downloads. Model/runtime acquisition was a separate development action.

| Milestone | Implemented and exercised | Gate status |
|---|---|---|
| 0 — bootstrap | Electron 44.3.0, strict TS, sandboxed renderers, role-checked IPC, tray/settings/overlay; launch/quit/build | Passed on Windows x64 |
| 1 — recording/ASR | Physical microphone capture/cancel; 48→16 kHz PCM worklet; bounded buffers; VAD; real whisper.cpp 1.8.3; timeout/cancel | Synthetic audio passes; human dictation/accuracy not verified |
| 2 — delivery/privacy | Preview, explicit copy, single in-app insertion; target capture; tested clipboard transaction abstraction | External automatic insertion disabled; full OS-blocked-egress test NOT passed |
| 3 — vocabulary/context | Versioned dictionary, scope/longest-match/ambiguity resolution, protected spans; Windows selected-range/password probe | Deterministic tests pass; real identifier accuracy limited; app/project scope activation not implemented |
| 4 — preview | Bounded recent-window ASR preview; provisional-only overlay; device errors and sleep cancellation | Real preview smoke exercised; no committed rolling transcript or key-up push-to-talk; 150 ms feedback target missed |
| 5 — transformations | Pinned llama.cpp + Qwen tested; cleanup fallback; command draft; Windows selection edit preview; language-pair gates | Adversarial cleanup cases fail; command quality not accepted; real edit/translation quality unverified |
| 6 — packaging | Unsigned Windows portable/unpacked artifact; actual self-extracting launcher, native helper, visible tray asset, capture/ASR/in-app insertion/cancel/quit tested | Host package passes executed checks; signing and other OS builds unavailable; overall product gates still incomplete |

Evidence: [verification](docs/verification.md), `docs/evidence`, [platform support](docs/platform-support.md), [privacy boundary](docs/privacy.md).

Measured baseline: 18 synthetic clips × 2 passes, i7-12700H/16 GB-class host, CPU/4 threads/tiny.en. Speech-only raw WER **19.66%**; ASR p50 **873 ms**, p95 **974 ms** (36 measurements, every call reloads the model). Exact identifiers after vocabulary: **8/16 occurrences**. Six raw words/tokens on silence/noise were suppressed by VAD. No human-speech or population accuracy claim.

Current checks: typecheck/build pass; **25 focused tests pass**. Real capture pipeline, physical microphone cancellation, controlled permission/device failures, IPC role rejection, Node/renderer network denial, native selected-range and password tests pass. Sampled network observation saw no established external TCP connections, but is not proof of zero egress. The token is not Administrator, so the firewall-blocked gate remains unexecuted.

Next executable steps: validate a narrowly scoped native external insertion adapter before enabling automatic delivery; evaluate a more suitable cleanup model against held-out/adversarial fixtures; import consented human clips with `benchmark/import.ts`; run the administrator firewall workflow. Do not mark the overall project complete while those core gates remain unresolved.
