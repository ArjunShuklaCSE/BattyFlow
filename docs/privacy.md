# Privacy boundary

The operating contract is **zero external network egress during application operation**, including native inference children. This build uses no inference HTTP service and no inference loopback API. A local daemon is not required. Development automation uses loopback debugging, which is outside normal application operation and must not be confused with inference traffic.

## Application enforcement

- Only allowlisted `batty://app/` resources are served. CSP, request interception, denied navigation/popups/webviews, context isolation, sandboxing, disabled Node integration, and sender/role checks protect renderer boundaries.
- Main-process Node `fetch`, HTTP(S), TCP/TLS and UDP creation entrypoints are blocked. There are no runtime npm dependencies. Guards do not constitute a process-wide or OS firewall; new network-capable code needs its own review.
- No model downloads, automatic updates, remote assets, crash-report initialization, telemetry, cloud fallback, or shell execution are implemented. No content is rendered as HTML.
- Child programs use absolute executable paths, argument arrays, `shell:false`, bounded pipes, timeout and cancellation. A restricted environment excludes proxy variables and arbitrary model-engine configuration. ASR and cleanup run serially; preview work is canceled and awaited before final inference.
- The Windows UI Automation helper only reads foreground identity, focused-element identity, password status, terminal process classification, and—only for an explicit edit action—the selected text. It does not read window titles, project files, source code, or the clipboard. Other adapters report inspection unavailable.

Native programs can bypass JavaScript request guards. Imported binaries, their native dependencies, Chromium services, and the OS need separate observation/blocking. Adjacent declared DLLs are checksum-checked, but the loader and system libraries remain part of the trust boundary. No runtime cloud-disable assumption is made: an Ollama adapter is not shipped.

## Storage and retention

Default data location: Electron `app.getPath('userData')` (`%APPDATA%/BattyFlow` on the normal Windows build). The test-only `BATTYFLOW_DATA_DIR` environment variable selects an isolated local test directory. Models stay in imported local directories and outside the application archive. The UI does not promise protection for mapped network drives; use a local fixed disk.

Settings and the versioned dictionary use same-directory temporary files plus atomic rename. History and content diagnostics are off and not implemented as hidden retention features. Timings and results remain in memory. Audio is bounded by the visible 10–180-second technical limit, 120 seconds by default. At 180 seconds the retained float PCM buffer is about 11 MiB; final-copy/WAV buffers and one 12-second preview add bounded transient allocations. Models/Chromium consume additional memory.

Whisper needs a real PCM16 WAV; llama.cpp needs text prompt files. They are created in random session directories under a restricted temp root. POSIX modes are 0700/0600. On Windows, inherited access is removed from the temp root and the current user SID and SYSTEM receive access; children inherit that ACL. Startup fails if this prerequisite fails. Temporary files are deleted on success, error and cancellation, and abandoned session directories are removed on the next recoverable startup after obtaining the single-instance lock. A forced crash can leave files until that startup. This is deletion, **not secure erasure**. Native stdout/stderr are bounded in memory and never written as default application logs.

Explicit copy intentionally replaces the current clipboard with the reviewed result and leaves it there. It is not a temporary paste transaction; the user requested a persistent copy. The generic temporary clipboard transaction is tested but not enabled for external delivery because format/generation/field integrity has not been validated on the host. No stale clipboard is treated as a selection, no Enter is synthesized, and no Undo rollback is attempted. Text delivered to another application is then subject to that application's behavior.

## Windows blocking and observation

Run the following in an **Administrator PowerShell**, replacing paths with the exact installed executables. Include the real unpacked portable-process path, not just its self-extracting launcher:

```powershell
$programs = @(
  "$PWD\release\win-unpacked\BattyFlow.exe",
  "$PWD\release\win-unpacked\resources\app.asar.unpacked\dist\native\TargetProbe.exe",
  "$PWD\.local\runtime\whisper-1.8.3\Release\whisper-cli.exe",
  "$PWD\.local\runtime\llama-b6532\llama-cli.exe"
)
.\scripts\privacy-block.ps1 -Programs $programs
# Run packaged capture, real ASR, cleanup, cancellation and restart checks.
.\scripts\privacy-block.ps1 -Programs $programs -Remove
```

The script creates only program-scoped outbound block rules in its own named group. It does not disable the firewall, alter other programs, or turn on globally disabled profiles. Use Windows Firewall/WFP event logs or an administrator packet trace to observe blocked attempts while the workflow runs. Inventory the process tree and include any new inference child executable in the rule list. Repeat after changing runtimes or packaging.

`scripts/observe-network.ps1` offers a read-only sampled TCP/UDP check for this workspace. It records counts, not packet contents or remote addresses. It can miss short-lived traffic and is **not proof of zero egress**. Full blocked-egress verification was not performed here: the available user token is not Administrator. The firewall service was present and running. Renderer/Node denial checks passed independently.

For macOS, apply a per-process outbound firewall or an isolated offline test host and inspect all descendants; for Linux use an isolated network namespace/firewall covering the entire process tree. Neither platform procedure was executed here. Do not infer their privacy gate from Windows renderer tests.

References: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [session permission/request API](https://www.electronjs.org/docs/latest/api/session), [Microsoft program-scoped firewall rules](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule).
