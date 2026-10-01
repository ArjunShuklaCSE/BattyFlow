# Models

BattyFlow needs two things to transcribe: a **speech engine** (a whisper.cpp build) and a **speech model**. Polishing and the Command, Edit and Translate modes also need an optional **language model** and its engine (llama.cpp).

The easiest way to get them is the Models page: click Download, and BattyFlow fetches the file, checks it against the SHA-256 pinned in [`src/shared/catalog.ts`](../src/shared/catalog.ts), and switches to it.

## What to pick

| You have                           | Engine                      | Model              | Download |
| ---------------------------------- | --------------------------- | ------------------ | -------: |
| Any recent laptop, English         | whisper.cpp for CPU         | **Base (English)** |    90 MB |
| An NVIDIA GPU, or another language | whisper.cpp for NVIDIA GPUs | **Large v3 Turbo** |  1.25 GB |
| An older or busy machine           | whisper.cpp for CPU         | Tiny (English)     |    52 MB |

See [benchmarks](benchmarks.md) for measured accuracy and speed.

## The catalog

### Speech engines

| Engine                            | File                                |   Size | Notes                                                                                                                                                                                                |
| --------------------------------- | ----------------------------------- | -----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| whisper.cpp 1.9.4 for CPU         | `whisper-bin-x64.zip`               | 8.6 MB | Picks the fastest code path for your CPU automatically.                                                                                                                                              |
| whisper.cpp 1.9.4 for NVIDIA GPUs | `whisper-cublas-12.4.0-bin-x64.zip` | 675 MB | CUDA 12.4 with cuBLAS included. Needs an NVIDIA driver 525 or newer. The first transcription after installing compiles GPU kernels (about 20 seconds); BattyFlow does that right after the download. |

Both come from the official [whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases/tag/b5130).

### Speech models

From [ggerganov/whisper.cpp on Hugging Face](https://huggingface.co/ggerganov/whisper.cpp). All MIT licensed, converted from OpenAI's Whisper.

| Model               | File                           |   Size | Languages     |
| ------------------- | ------------------------------ | -----: | ------------- |
| Tiny (English)      | `ggml-tiny.en-q8_0.bin`        |  44 MB | English       |
| Base (English)      | `ggml-base.en-q8_0.bin`        |  82 MB | English       |
| Small (English)     | `ggml-small.en-q8_0.bin`       | 264 MB | English       |
| Large v3 Turbo      | `ggml-large-v3-turbo-q5_0.bin` | 574 MB | 100 languages |
| Base (multilingual) | `ggml-base-q8_0.bin`           |  82 MB | 99 languages  |

English-only models are faster and more accurate for English. With a multilingual model, set Language to _Detect automatically_ or pick yours in Settings.

### Polish (optional)

| Item                    | File                                |   Size | License    |
| ----------------------- | ----------------------------------- | -----: | ---------- |
| llama.cpp b6532 for CPU | `llama-b6532-bin-win-cpu-x64.zip`   |  14 MB | MIT        |
| Qwen2.5 1.5B Instruct   | `qwen2.5-1.5b-instruct-q4_k_m.gguf` | 1.1 GB | Apache-2.0 |
| Qwen2.5 0.5B Instruct   | `qwen2.5-0.5b-instruct-q4_k_m.gguf` | 491 MB | Apache-2.0 |

Polishing runs every dictation through the language model to fix grammar and resolve self-corrections ("meet at five, actually six"). Its output is checked before use: if it drops a negation, changes a number, loses a protected identifier or changes the length too much, BattyFlow keeps the plain transcript instead. Expect a second or two extra per dictation on the CPU.

## Offline machines and your own models

You can use any whisper.cpp-compatible model (and any whisper.cpp build that has the usual `whisper-cli` options) without downloading through the app.

1. Copy the files to the machine. Keep an engine's DLLs next to its `.exe`.
2. Write a manifest for each file:

   ```powershell
   node scripts/make-manifest.mjs D:\models\ggml-medium.en.bin --name "Medium (English)" `
     --version medium.en --license MIT --languages en `
     --provenance https://huggingface.co/ggerganov/whisper.cpp --out medium.json
   ```

   For an engine, point it at `whisper-cli.exe`; the DLLs beside it are hashed too.

3. In BattyFlow, open **Models → Import your own files** and pick the manifest.

A manifest looks like this (paths can be relative to the manifest):

```json
{
  "path": "ggml-medium.en.bin",
  "name": "Medium (English)",
  "version": "medium.en",
  "license": "MIT",
  "provenance": "https://huggingface.co/ggerganov/whisper.cpp",
  "languages": ["en"],
  "size": 1533774781,
  "sha256": "cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356"
}
```

BattyFlow checks the size, SHA-256, file format (ggml or GGUF) and, for engines, the command-line options before using anything. A hash proves the file hasn't changed since you made the manifest; it doesn't prove who made the file, so compare it with the publisher's hash and only import engines you trust: they run with your user's permissions.

If a file is named like a catalog model (for example `ggml-base.en-q8_0.bin`) but its hash differs, the import is refused.
