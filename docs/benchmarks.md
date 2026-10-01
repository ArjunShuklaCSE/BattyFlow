# Benchmarks

Numbers from `npm run benchmark` on one machine. They show how the models and BattyFlow's settings compare with each other; they are not a claim about human speech in general.

**Machine:** Intel Core i7-12700H laptop, 16 GB RAM, NVIDIA GeForce RTX 3060 Laptop GPU (6 GB), Windows 11. The laptop was in normal use during the runs, so treat latency as typical rather than best case.

**Engine:** whisper.cpp 1.9.4 (b5130), 8 CPU threads, greedy decoding, vocabulary prompt on unless noted. Small models on the CPU use a shortened encoder window (see below); GPU runs and large models use the full window. CUDA rows use the CUDA 12.4 build.

**Test set:** 28 clips, generated with Windows' built-in speech voices (Zira and Hazel) from sentences in [`benchmark/manifest.json`](../benchmark/manifest.json). 10 are developer dictation ("Run cube control get pods in the staging namespace"), the rest cover fillers, numbers, negation, self-corrections, silence and noise. 18 technical terms appear across the set.

## Results

| Engine | Model                                 | Final WER | Technical terms exact | Median latency | 95th percentile |
| ------ | ------------------------------------- | --------: | --------------------: | -------------: | --------------: |
| CPU    | Tiny (English)                        |     10.4% |               15 / 18 |         269 ms |          387 ms |
| CPU    | **Base (English)**                    |  **7.3%** |               14 / 18 |     **423 ms** |          528 ms |
| CPU    | Base (English), vocabulary prompt off |     11.4% |                8 / 18 |         385 ms |          492 ms |
| CPU    | Small (English)                       |      7.8% |               15 / 18 |       1,143 ms |        1,317 ms |
| CUDA   | Base (English)                        |      7.3% |               14 / 18 |         532 ms |          682 ms |
| CUDA   | Small (English)                       |      8.3% |               15 / 18 |         726 ms |          854 ms |
| CUDA   | **Large v3 Turbo**                    |      5.2% |           **17 / 18** |       1,064 ms |        1,205 ms |
| CUDA   | Large v3 Turbo, vocabulary prompt off |  **4.7%** |               16 / 18 |       1,266 ms |        1,518 ms |

- **Final WER** compares what BattyFlow would type (after filler removal, vocabulary and app style) with the intended text, word by word. Lower is better.
- **Technical terms exact** counts terms such as `useEffect`, `kubectl` and `PostgreSQL` spelled exactly right, including case.
- **Latency** is the time from the end of recording to the transcript: writing the audio, starting whisper.cpp, loading the model and decoding. Clips are 2 to 6 seconds long.

## What the numbers say

- **Vocabulary steering matters most.** With the same Base model, passing your vocabulary to Whisper as its initial prompt took exact technical terms from 8 to 14 out of 18 and cut final WER from 11.4% to 7.3%, for about 40 ms.
- **Base (English) on the CPU is the sweet spot**, which is why it's the default. Small is no more accurate on this set and is almost three times slower on the CPU.
- **Large v3 Turbo on a GPU is the most accurate setup**: 5.2% final WER and 17 of 18 technical terms, in about a second. It's also the model to use for languages other than English.
- **A GPU doesn't help small models.** Starting CUDA and uploading the model costs more than the GPU saves on short clips. It is what makes Large v3 Turbo practical: on the CPU it needs about 20 seconds per clip on this laptop (a two-clip spot check, not a full run).
- **The short encoder window halves CPU latency for small models.** Whisper normally encodes a 30-second window for any clip. For small models on the CPU, BattyFlow sizes the window to the clip plus a margin: Base went from 877 ms to 423 ms median, with the same accuracy. Large v3 Turbo started repeating sentences with a shortened window (3 of 28 clips, "Do not delete the backup. Do not delete the backup."), so large models and GPU runs keep the full window, where the GPU costs only about 6% more time. As a second guard, BattyFlow drops a sentence that Whisper repeats back to back.

## Compared with 0.1

0.1 used Tiny (English) at full precision, beam search, a 30-second window, and re-hashed the model before every dictation: 873 ms median on the same laptop, with 8 of 16 technical terms exact on the older 18-clip set. 0.2 runs Base, a bigger and more accurate model, in 423 ms.

## Limits

- Synthetic voices are clearer and more regular than people. Expect more errors with real speech, accents and background noise.
- 28 clips is a small sample; differences of a point or two of WER are within noise.
- Every dictation starts a whisper.cpp process and loads the model; times include that.

## Reproduce

```powershell
npm run fixtures                       # generate the clips with Windows' speech voices
node scripts/make-manifest.mjs <path to whisper-cli.exe> --name "whisper.cpp" --version 1.9.4 --license MIT --provenance <url> --out engine.json
node scripts/make-manifest.mjs <path to ggml-base.en-q8_0.bin> --name "Base (English)" --version base.en --license MIT --languages en --provenance <url> --out model.json
npm run benchmark -- --runtime engine.json --model model.json            # add --gpu for the CUDA build
npm run benchmark -- --runtime engine.json --model model.json --no-prompt  # vocabulary prompt off
```

Reports are written to `benchmark/results/latest/` (`report.json` with every transcript, and `summary.md`). Other flags: `--threads N`, `--full-window`, `--passes N`, `--max-wer`, `--max-p95-ms` and `--baseline report.json` for regression checks. See [benchmark/README.md](../benchmark/README.md).
