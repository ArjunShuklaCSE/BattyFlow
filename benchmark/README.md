# Reproducible smoke evaluation

`manifest.json` contains 18 cases with original test text, independent verbatim and intended-clean references, identifiers/occurrence counts, profiles, tags, language, audio hash, duration, and provenance. Generated audio is synthetic Windows System.Speech (Hazel, Zira, David when installed), plus deterministic silence/noise. It is not consented human audio or accent validation. The test text is MIT; generated proprietary-voice output is for local evaluation only because redistribution terms were not independently established. Generated WAVs are not included in the distributable package or git history.

Generate with `npm run fixtures:synthetic`, then `node scripts/finalize-fixtures.mjs`. Regeneration updates hashes because voices/OS synthesis may differ. Keep hashes fixed when comparing runs. To import consented audio, copy PCM16 **16 kHz mono** WAVs under `benchmark/fixtures`, then add manifest entries with their actual SHA-256, duration, language, provenance/consent, license, references, expected identifiers, context, and tags. `readWav` rejects incompatible containers; do not rename compressed audio to WAV. Use a local audio editor to convert before import. Record the conversion tool/version. Do not claim consent or licenses without evidence.

Alternatively use `npx --no-install tsx benchmark/import.ts --audio local.wav --metadata annotation.json`. The importer validates PCM format, derives duration/hash, preserves existing files, and atomically updates the manifest. Metadata requires `id`, `language`, `provenance`, `license`, `verbatim`, `cleaned`, `identifiers` (array of `{text,count}`), and `kind` (`human` or `synthetic`). Human recordings additionally require your explicit `consented: true` attestation. Optional `profile`, `tags`, and `critical` annotations follow the existing manifest. This action deliberately retains the audio for evaluation; consent and redistribution rights remain supplied attestations, not independently verified facts.

`tuning` cases are separate from `held-out` tags. These are still a tiny synthetic smoke suite, not a held-out population study. No dictionary was tuned on reported held-out errors. Known failures such as “Kubernetes” becoming “Cuba Arnett” remain visible rather than being added as fabricated vocabulary aliases.

## Metrics

- Raw WER uses Levenshtein substitutions/deletions/insertions over NFKC, lowercase, punctuation-separated whitespace words. Digits and spelled-out numbers are **not** made equivalent; e.g. `42` vs `forty two` increases lexical WER. Identifiers are scored separately with exact case, punctuation and boundary-aware repeated occurrences.
- Cleaned WER compares to the separate intended-clean reference. Raw, local-cleanup, and vocabulary-plus-cleanup columns use the same raw ASR output. An extra vocabulary-only column isolates deterministic resolution. Unavailable/failed cleanup is reported explicitly, never substituted into the cleanup score.
- Zero-word references have undefined WER; raw hallucinated words are counted. The separately reported VAD-gated output suppresses silence/noise. This distinction matters: the raw tiny model hallucinated on silence in the measured suite.
- Critical-content checks are lexical review candidates, not automated semantic verdicts. Numbers written as digits can be semantically correct despite a flagged spelling difference. Inspect per-case output and `docs/verification.md` for human review notes.
- ASR elapsed time includes checksum validation, process startup, WAV I/O, model load, inference and temp cleanup. Real-time factor divides that wall time by source audio duration. Every CLI invocation reloads the model. Later passes have potentially warmer OS cache, not a persistent warm engine.
- App capture tests separately record native-target capture, visible overlay, microphone-ready, stop-to-ready and first-preview timings where executed. External insertion latency is not measured because delivery is manual. Native peak memory and isolated model-load time are presently unavailable; runner peak RSS is labeled as runner-only.

Reports go to `benchmark/results/<name>/report.json` and `summary.md`. Evidence snapshots are copied into `docs/evidence` for handoff. Reported p50/p95 always include sample counts; 18 or 36 samples do not establish reliable tail latency. Translation and editing do not use dictation WER and are not represented as passed benchmarks.

## Commands and gates

```powershell
npm run benchmark -- --passes 2 --output benchmark/results/baseline
npm run benchmark -- --llama .local/manifests/llama.json --llm-model .local/manifests/llmModel.json --output benchmark/results/cleanup
npm run benchmark -- --baseline benchmark/results/baseline/report.json --max-latency-ratio 1.25 --max-wer-delta 0.02 --output benchmark/results/comparison
npm run benchmark -- --max-wer 0.25 --max-p95-ms 3000
```

Missing files, hash/duration mismatch, inference failures, required transformation validation failures, or specified regression thresholds produce a nonzero exit. Smoke quality failures are retained. A successful raw-ASR run does not satisfy external-insertion, human accuracy, privacy/firewall, or model-semantic gates.
