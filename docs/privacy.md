# Privacy

BattyFlow is built so that your voice and your words stay on your computer. This page lists exactly what it stores, what touches the network, and how to check for yourself.

## What never leaves your PC

- **Audio.** Recorded with the browser audio stack inside BattyFlow, held in memory, and written to a temporary WAV file only for the moment whisper.cpp reads it. The file is deleted straight after, and any leftovers from a crash are removed the next time the app starts. Audio is never kept.
- **Transcripts.** Shown in the app, pasted where you asked, and stored in History if History is on.
- **What you type into or select in other apps.** BattyFlow asks Windows which window and field are focused (so it pastes in the right place and skips password fields). It reads selected text only when you use Edit mode on purpose.

There is no account, no analytics, no crash reporting, no update check and no cloud fallback.

## The network

BattyFlow makes network requests in exactly one situation: **you click Download** on the Models page (or in first-run setup). Then it fetches that one file:

- from `github.com` (whisper.cpp and llama.cpp releases) or `huggingface.co` (models), following their redirects to their own CDNs, over HTTPS only;
- through a separate network session that refuses every other host, including redirects;
- and it checks the file against a SHA-256 hash pinned in the app before using it. A mismatch deletes the file.

Everything else is blocked in code:

- The app's windows can only load BattyFlow's own files; every other request is cancelled.
- Node's `http`, `https`, `net`, `tls`, `dgram`, `dns` and `fetch` are disabled in the main process after startup.
- Chromium background networking, component updates, sync and domain reliability reporting are switched off.
- whisper.cpp and llama.cpp run as local processes with a stripped environment (no proxy settings) and are only ever given local file paths.

If you never click Download, for example on an offline machine where you import models yourself, BattyFlow never touches the network.

## What is stored, and where

| What                          | Where                                 | Notes                                                                                                                                                                            |
| ----------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings                      | `%APPDATA%\BattyFlow\settings.json`   | Includes the paths and hashes of your models.                                                                                                                                    |
| Vocabulary                    | `%APPDATA%\BattyFlow\dictionary.json` |                                                                                                                                                                                  |
| History                       | `%APPDATA%\BattyFlow\history.json`    | Last 500 transcripts with time, word count and how they were delivered. No audio, no app names. Turning History off stops recording new entries; **Clear all** deletes the file. |
| Downloaded engines and models | `%LOCALAPPDATA%\BattyFlow`            | Delete from the Models page, or remove the folder.                                                                                                                               |
| Temporary audio               | `%APPDATA%\BattyFlow\sessions`        | Locked to your user account and SYSTEM. Deleted after each transcription.                                                                                                        |

Deleting a file is not secure erasure: a forensic tool could recover temporary audio from the disk until the space is reused. If that matters, use full-disk encryption (BitLocker).

## Pasting and the clipboard

Windows apps receive pasted text through the clipboard, so BattyFlow:

1. checks that the window you started recording in is still the active one, and that the focused field isn't a password field or an app running as administrator;
2. saves what's on your clipboard (every format, including images and files);
3. puts the transcript on the clipboard, marked so that **Windows clipboard history (Win+V) and cloud clipboard sync skip it**;
4. presses Ctrl+V (Shift+Insert in terminals);
5. about 0.7 seconds later, puts your original clipboard back, unless something else was copied in the meantime.

Clipboard managers that don't respect Windows' exclusion flags may still see the transcript. If you'd rather BattyFlow never touch the clipboard, set **When you stop** to _Show it in BattyFlow only_.

Text you paste into another app is then handled by that app, like anything you type.

## Push-to-talk and the keyboard hook

Holding a key to talk needs to know when the key goes up, which Windows only reports through a low-level keyboard hook. BattyFlow's helper installs one, and it only acts on your push-to-talk combination. It does not log, store or send keystrokes; other keys are only checked to cancel push-to-talk when you're actually typing a shortcut such as Ctrl+Win+D. You can turn push-to-talk off in Settings, and the hook stops matching anything.

## Check it yourself

**Watch connections.** `scripts/observe-network.ps1` samples the TCP and UDP activity of BattyFlow and its helper processes while you use the app:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\observe-network.ps1 -Seconds 60
```

Sampling can miss very short connections, so it's evidence, not proof.

**Block it outright.** From an Administrator PowerShell, `scripts/privacy-block.ps1` adds outbound firewall rules for the programs you list, in their own rule group, without touching anything else:

```powershell
$programs = @(
  "$env:LOCALAPPDATA\Programs\BattyFlow\BattyFlow.exe",
  "$env:LOCALAPPDATA\Programs\BattyFlow\resources\app.asar.unpacked\dist\native\BattyHelper.exe",
  "$env:LOCALAPPDATA\BattyFlow\runtimes\whisper-cpu\Release\whisper-cli.exe"
)
.\scripts\privacy-block.ps1 -Programs $programs
# use BattyFlow; dictation keeps working, downloads fail
.\scripts\privacy-block.ps1 -Programs $programs -Remove
```

**Read the code.** Network rules are in [`src/main/app.ts`](../src/main/app.ts) and [`src/main/downloads.ts`](../src/main/downloads.ts), the Node network lock in [`src/main/privacy/network.ts`](../src/main/privacy/network.ts), and everything the helper can do is in one file: [`native/windows/BattyHelper.cs`](../native/windows/BattyHelper.cs).

Found a privacy problem? Please report it as described in [SECURITY.md](../SECURITY.md).
