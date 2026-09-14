# synthetic-smoke-v1

2026-09-13T21:19:01.958Z · 12th Gen Intel(R) Core(TM) i7-12700H · win32 10.0.26200

Runtime 1.8.3; model Whisper tiny.en F16. Commit: ecd5d5e2f633254b24c78addff0c15f54a0875ed.

18 samples, raw corpus WER 0.197, ASR p50 871 ms / p95 1067 ms.

| Clip | Pass | Raw WER | Cleanup WER | Vocabulary + cleanup WER | ASR ms | Exact identifiers after vocabulary only |
|---|---:|---:|---:|---:|---:|---:|
| plain | 1 | 0.000 | 0.000 | 0.000 | 857 | 0/0 |
| fillers | 1 | 0.000 | 0.000 | 0.000 | 911 | 0/0 |
| correction | 1 | 0.200 | 0.375 | 0.375 | 895 | 0/0 |
| alias | 1 | 0.333 | 2.000 | 0.000 | 856 | 1/1 |
| oauth | 1 | 0.400 | 0.000 | 0.000 | 841 | 1/1 |
| graphql | 1 | 0.500 | 0.000 | 0.250 | 860 | 1/1 |
| effect | 1 | 0.000 | 0.500 | 0.000 | 836 | 1/1 |
| kubernetes | 1 | 0.500 | 0.500 | 0.500 | 864 | 0/1 |
| spaces | 1 | 0.286 | 0.000 | 0.000 | 871 | 0/1 |
| numbers | 1 | 0.571 | 0.571 | 0.571 | 856 | 0/0 |
| negation | 1 | 0.000 | 0.000 | 0.000 | 970 | 0/0 |
| meaningful-like | 1 | 0.182 | 0.182 | 0.182 | 901 | 0/0 |
| unknown-alias | 1 | 0.000 | 0.000 | 0.000 | 877 | 0/0 |
| repeated | 1 | 0.667 | 1.000 | 1.000 | 871 | 0/2 |
| adversarial | 1 | 0.000 | FAILED | FAILED | 890 | 0/0 |
| uncertainty | 1 | 0.000 | 0.000 | 0.000 | 1067 | 0/0 |
| silence | 1 | undefined | undefined | undefined | 825 | 0/0 |
| quiet-noise | 1 | undefined | undefined | undefined | 950 | 0/0 |

## Limitations

- Synthetic local smoke suite; no human-speech or accent validation
- Every CLI invocation reloads the model; pass 0 is first pass, later passes use warm OS cache; not persistent warm-model latency
- ASR time includes checksum, process startup, model load, WAV I/O, inference and cleanup
- Child peak RSS and separately measured model-load time unavailable
- No external insertion performed; insertion latency not measured
- Cleanup columns unavailable unless explicit local transformer supplied
- Critical-content candidates need human review
- Small sample p95 is descriptive; not a tail-latency claim

## Required failures

adversarial:asrCleanup:CLEANUP_LENGTH_DIVERGENCE
adversarial:asrVocabularyCleanup:CLEANUP_LENGTH_DIVERGENCE
