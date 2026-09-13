# synthetic-smoke-v1

2026-09-13T21:16:54.695Z · 12th Gen Intel(R) Core(TM) i7-12700H · win32 10.0.26200

Runtime 1.8.3; model Whisper tiny.en F16. Commit: ff38be81d4163acba9bc26687a855c2ed0c1ba99.

36 samples, raw corpus WER 0.197, ASR p50 873 ms / p95 974 ms.

| Clip | Pass | Raw WER | Cleanup WER | Vocabulary + cleanup WER | ASR ms | Exact identifiers after vocabulary only |
|---|---:|---:|---:|---:|---:|---:|
| plain | 1 | 0.000 | unavailable | unavailable | 876 | 0/0 |
| fillers | 1 | 0.000 | unavailable | unavailable | 902 | 0/0 |
| correction | 1 | 0.200 | unavailable | unavailable | 889 | 0/0 |
| alias | 1 | 0.333 | unavailable | unavailable | 873 | 1/1 |
| oauth | 1 | 0.400 | unavailable | unavailable | 839 | 1/1 |
| graphql | 1 | 0.500 | unavailable | unavailable | 846 | 1/1 |
| effect | 1 | 0.000 | unavailable | unavailable | 850 | 1/1 |
| kubernetes | 1 | 0.500 | unavailable | unavailable | 873 | 0/1 |
| spaces | 1 | 0.286 | unavailable | unavailable | 862 | 0/1 |
| numbers | 1 | 0.571 | unavailable | unavailable | 855 | 0/0 |
| negation | 1 | 0.000 | unavailable | unavailable | 870 | 0/0 |
| meaningful-like | 1 | 0.182 | unavailable | unavailable | 974 | 0/0 |
| unknown-alias | 1 | 0.000 | unavailable | unavailable | 891 | 0/0 |
| repeated | 1 | 0.667 | unavailable | unavailable | 895 | 0/2 |
| adversarial | 1 | 0.000 | unavailable | unavailable | 906 | 0/0 |
| uncertainty | 1 | 0.000 | unavailable | unavailable | 918 | 0/0 |
| silence | 1 | undefined | unavailable | unavailable | 823 | 0/0 |
| quiet-noise | 1 | undefined | unavailable | unavailable | 846 | 0/0 |
| plain | 2 | 0.000 | unavailable | unavailable | 867 | 0/0 |
| fillers | 2 | 0.000 | unavailable | unavailable | 1015 | 0/0 |
| correction | 2 | 0.200 | unavailable | unavailable | 907 | 0/0 |
| alias | 2 | 0.333 | unavailable | unavailable | 887 | 1/1 |
| oauth | 2 | 0.400 | unavailable | unavailable | 865 | 1/1 |
| graphql | 2 | 0.500 | unavailable | unavailable | 863 | 1/1 |
| effect | 2 | 0.000 | unavailable | unavailable | 951 | 1/1 |
| kubernetes | 2 | 0.500 | unavailable | unavailable | 873 | 0/1 |
| spaces | 2 | 0.286 | unavailable | unavailable | 870 | 0/1 |
| numbers | 2 | 0.571 | unavailable | unavailable | 863 | 0/0 |
| negation | 2 | 0.000 | unavailable | unavailable | 875 | 0/0 |
| meaningful-like | 2 | 0.182 | unavailable | unavailable | 926 | 0/0 |
| unknown-alias | 2 | 0.000 | unavailable | unavailable | 896 | 0/0 |
| repeated | 2 | 0.667 | unavailable | unavailable | 873 | 0/2 |
| adversarial | 2 | 0.000 | unavailable | unavailable | 927 | 0/0 |
| uncertainty | 2 | 0.000 | unavailable | unavailable | 921 | 0/0 |
| silence | 2 | undefined | unavailable | unavailable | 829 | 0/0 |
| quiet-noise | 2 | undefined | unavailable | unavailable | 952 | 0/0 |

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

None in executed ASR gates. This does not complete product acceptance.
