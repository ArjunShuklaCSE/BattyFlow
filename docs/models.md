# Local runtime and model setup

## Verified acquisition in this workspace

| Asset | Pinned identity | Local location | Terms/capability |
|---|---|---|---|
| Whisper CPU CLI | whisper.cpp 1.8.3, official Windows x64 release | `.local/runtime/whisper-1.8.3/Release/whisper-cli.exe` | MIT; CPU path tested, `-ng`, 4 threads |
| ASR model | ggml-tiny.en, 77,704,715 bytes | `.local/models/ggml-tiny.en.bin` | MIT model card; English only; F16 baseline |
| Transformation CLI | llama.cpp b6532 (c4510dc9), official Windows CPU build | `.local/runtime/llama-b6532/llama-cli.exe` | MIT; CPU, 4 threads; no RPC endpoint configured |
| Cleanup model | Qwen2.5-0.5B-Instruct Q4_K_M GGUF | `.local/models/qwen2.5-0.5b-instruct-q4_k_m.gguf` | Apache-2.0; English is the only locally declared/tested language; quality is limited |

The ASR model SHA-256 is `921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f`; Whisper executable SHA-256 is `0ff971e410240a0b97117432d771245698f376e06105c011959d2bfc4bb23311`. Exact acquired manifests, including adjacent DLL hashes, are in `.local/manifests`. These are acquisition records, not publisher signatures. The original release/model sources must be trusted separately. Native code has the user's process privileges; only import binaries you trust.

## Manual acquisition on another machine

Acquire on a networked machine, then transfer the complete directories and manifests to the offline machine:

- [Whisper 1.8.3 release](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.8.3): Windows `whisper-bin-x64.zip`.
- [Whisper ggml model card and files](https://huggingface.co/ggerganov/whisper.cpp): choose `ggml-tiny.en.bin` for the measured baseline. The `.en` suffix denotes English-only models.
- [llama.cpp b6532 release](https://github.com/ggml-org/llama.cpp/releases/tag/b6532): `llama-b6532-bin-win-cpu-x64.zip` for optional cleanup.
- [Official Qwen GGUF model](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF): `qwen2.5-0.5b-instruct-q4_k_m.gguf` for reproducing the experimental cleanup evaluation.

For the directory layout above, run `node scripts/local-manifests.mjs` and optionally `node scripts/llama-manifests.mjs`. Inspect the sources, hashes, and model licenses before importing the resulting JSON through the UI. Acquisition scripts do not run at app startup. Keep native libraries from the same release together; a binary alone is not a complete runtime. Do not mix DLLs from different builds.

Example asset manifest:

```json
{
  "path": "../models/ggml-tiny.en.bin",
  "name": "Whisper tiny.en F16",
  "version": "ggml-tiny.en",
  "sha256": "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f",
  "size": 77704715,
  "provenance": "https://huggingface.co/ggerganov/whisper.cpp",
  "license": "MIT",
  "languages": ["en"]
}
```

Paths resolve against the manifest directory. The app checks existence, size, SHA-256, model magic, language declarations and native help flags. Optional `dependencies` entries list adjacent native filenames, sizes and SHA-256 values. Runtime metadata must declare the pinned version; Whisper 1.8.3 has no usable `--version` flag, so release provenance and executable hash are essential. llama.cpp b6532 is pinned and its actual help/single-turn framing was exercised. Default child environment drops proxies and arbitrary engine options; local model paths are passed directly, with no HF/download/RPC arguments.

## Hardware profiles

The measured reference configuration is i7-12700H, CPU, 4 threads, tiny.en. This is a footprint/latency baseline, not a recommended accuracy winner. Larger Whisper models require separate latency, memory and accuracy evaluation on your machine. GPU backends and quantized ASR variants have not been measured. Peak native RSS is not yet recorded by the harness. CLI calls reload their models; repeated runs may benefit from filesystem cache but are not persistent warm inference.

Qwen 0.5B cleanup removes fillers in some fixtures and preserves meaningful “like”/negation in those tested cases. It does not reliably resolve corrections and fails adversarial-data validation. Command drafting can invent code formatting, which the app rejects when unrequested. Do not infer translation support from the model name: configured pairs start empty and need separate review. No model is bundled into the application archive.
