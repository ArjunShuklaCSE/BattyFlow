# Contributing

Thanks for wanting to help. Bug reports, model results on your hardware, vocabulary lists and pull requests are all welcome.

## Set up

You need Windows 10 or 11 (x64) and Node.js 22 or newer.

```powershell
git clone https://github.com/ArjunShuklaCSE/BattyFlow.git
cd BattyFlow
npm ci
npm start
```

`npm start` builds everything into `dist/` and runs the app. The first run downloads Electron's binary. The native helper (`native/windows/BattyHelper.cs`) is compiled by the C# compiler that ships with Windows, so you don't need Visual Studio or the .NET SDK.

To use a separate profile while developing, so you don't touch your real settings and history:

```powershell
$env:BATTYFLOW_DATA_DIR = "$PWD\.local\dev-profile"; npm start
```

## Checks

| Command                        | What it checks                                                                                         | When                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `npm run check`                | Types, unit tests, build                                                                               | Every change                                       |
| `npm run format:check`         | Prettier formatting (`npm run format` fixes it)                                                        | Every change                                       |
| `npm run smoke`                | The real app: model download, recording with a synthetic voice, transcription, history, IPC boundaries | Changes to the main process, renderer or downloads |
| `node scripts/paste-smoke.mjs` | Pasting into another window, clipboard restore, password fields                                        | Changes to the helper or delivery                  |
| `npm run benchmark`            | Accuracy and latency (see [docs/benchmarks.md](docs/benchmarks.md))                                    | Changes to transcription or text shaping           |

The smoke tests need `npm run fixtures` once, to generate test audio with Windows' built-in voices. `paste-smoke` briefly takes focus, so don't type while it runs.

## Code

- TypeScript is strict. Keep it that way, and avoid `any` outside test probes.
- No runtime npm dependencies. The app ships Electron, its own code, and nothing else.
- The main process trusts nothing from renderers. New IPC channels go through `handler()` in `src/main/app.ts` with the narrowest role that works, and validate every argument.
- Error codes are `UPPER_SNAKE_CASE` strings. Add a sentence for each new one in `src/shared/messages.ts`.
- Anything that could touch the network needs a very good reason and has to keep [docs/privacy.md](docs/privacy.md) true.
- Add a test for logic with branches: text shaping, settings, vocabulary, parsing.

The helper is C# 5 (the language version the in-box compiler supports): no string interpolation, `?.` or expression-bodied members.

## Adding a model to the catalog

Models live in `src/shared/catalog.ts`. Each entry needs the publisher's download URL, the exact byte size and SHA-256 (from the GitHub release asset or the Hugging Face file page), the license and the languages. Run the benchmark with it and include the numbers in your pull request.

## Pull requests

Keep them focused, describe what you changed and how you tested it, and include before/after screenshots for UI changes. For anything large, open an issue first so we can agree on the approach.
