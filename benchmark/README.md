# Benchmark

Measures transcription accuracy and latency on a fixed set of clips, using the same engine settings and text pipeline as the app. Results for one machine are in [docs/benchmarks.md](../docs/benchmarks.md).

## The clips

[`manifest.json`](manifest.json) lists 28 clips. Each has the sentence that was spoken, a verbatim reference (what a perfect transcript of the words would be), a cleaned reference (what BattyFlow should type, with exact spellings such as `useEffect`), the technical terms it contains, an optional writing profile, and tags.

The audio is generated locally with Windows' built-in speech voices and is not committed:

```powershell
npm run fixtures   # writes benchmark/fixtures/generated/*.wav and updates hashes and durations
```

Different Windows builds can produce slightly different audio, so compare runs made with the same generated files. The sentences are MIT licensed; the generated voice audio is for local evaluation only.

To add your own recordings (16 kHz mono 16-bit PCM WAV):

```powershell
npx tsx benchmark/import.ts --audio clip.wav --metadata clip.json
```

The metadata needs `id`, `language`, `provenance`, `license`, `verbatim`, `cleaned`, `identifiers` (an array of `{ "text": "...", "count": 1 }`) and `kind` (`human` or `synthetic`). Human recordings also need `"consented": true`, your statement that the speaker agreed to the recording being used.

## Running

```powershell
npm run benchmark -- --runtime engine.json --model model.json
```

`engine.json` and `model.json` are asset manifests; make them with `scripts/make-manifest.mjs` (see [docs/models.md](../docs/models.md)).

| Flag                            | Effect                                                                    |
| ------------------------------- | ------------------------------------------------------------------------- |
| `--gpu`                         | Use a CUDA build of whisper.cpp                                           |
| `--no-prompt`                   | Don't pass the vocabulary to Whisper                                      |
| `--full-window`                 | Always use Whisper's full 30-second encoder window                        |
| `--threads N`                   | CPU threads (default 8)                                                   |
| `--passes N`                    | Run the whole set N times                                                 |
| `--output DIR`                  | Where to write results (default `benchmark/results/latest`)               |
| `--llama F --llm-model F`       | Also score the optional language-model polish                             |
| `--max-wer X`, `--max-p95-ms N` | Exit with an error if raw WER or p95 latency is above a threshold         |
| `--baseline report.json`        | Compare against an earlier run (`--max-latency-ratio`, `--max-wer-delta`) |

## Metrics

- **Raw WER** compares Whisper's output with the verbatim reference. Words are lowercased and punctuation is ignored; digits and spelled-out numbers count as different words.
- **Final WER** compares what BattyFlow would type, after filler removal, vocabulary and writing profile, with the cleaned reference.
- **Technical terms exact** counts occurrences spelled exactly, case included, before and after vocabulary.
- **Latency** runs from handing the audio to whisper.cpp until the transcript comes back, including process start and model load. File hashing and GPU warm-up happen once before timing, as in the app.
- Silent and noise-only clips have no reference words; any words transcribed on them are counted as hallucinations, and the app's silence gate is scored separately.

Each run writes `report.json` (every transcript and measurement) and `summary.md`.
