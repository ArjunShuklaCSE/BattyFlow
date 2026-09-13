# Platform support

“Tested” means only the specific environment/cases in `docs/verification.md`. It does not mean universal app compatibility.

| Capability | Windows x64, build 26200 | macOS | Linux X11 | Linux Wayland |
|---|---|---|---|---|
| Microphone / PCM | Tested physical capture/cancel and synthetic full pipeline | Implemented web API; unverified permissions | Implemented web API; unverified | Implemented web API; unverified |
| Global toggle | Registration tested; real user keypress still requires manual check | Implemented; unverified | Implemented; unverified | Portal-dependent; unverified |
| Push-to-talk | Unsupported | Unsupported | Unsupported | Unsupported |
| Target inspection | Read-only UIA helper; tested controlled Chromium field | Explicit unavailable fallback | Explicit unavailable fallback | Explicit unavailable fallback |
| Selection retrieval | UIA selected range; controlled field/password tests pass; app-dependent | Unavailable | Unavailable | Unavailable |
| External automatic insertion | Not enabled; explicit copy/manual paste | Not enabled | Not enabled | Not enabled |
| External selection replacement | Preview/manual only; no replacement automation | Unavailable | Unavailable | Unavailable |
| In-app test insertion | Tested, at most one claim/session | Implemented, unverified | Implemented, unverified | Implemented, unverified |
| Terminal delivery | Explicit copy only; no keys or Enter synthesized | Copy only | Copy only | Copy only |
| Tray / non-activating overlay | Launch/cancel controls tested; overlay `focusable:false` | Implemented, unverified | Implemented, unverified | Compositor-dependent, unverified |
| Packaging | Portable and unpacked x64 build generated; packaged workflow tested | Configuration only; unsigned/unnotarized | AppImage recipe only | AppImage recipe only |

The Windows probe checks HWND + PID + process start time and UIA runtime ID. It verifies foreground/focused-element stability during capture, and never reads a secure field's selection. It can fail for inaccessible/elevated apps, apps without TextPattern, complex documents, and custom editors. A matching element and selection string do not prove unchanged cursor offsets or target readiness. That is why the external automatic insertion transaction remains disconnected. No clipboard copy-shortcut fallback is used.

Separate recording toggle and command/edit shortcuts use Electron `globalShortcut`. Activation is not a key-release event. Registration failures are shown and settings permit rebinding; overlay/tray cancellation never depends on capturing Escape. A 300 ms debounce limits rapid activation callbacks, but held-key behavior still requires manual validation on each platform. Suspend/lock cancel current work; wake re-registers shortcuts. Wayland requires an appropriate desktop portal/identity and remains unvalidated.

Reference: [Electron globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut). The source/types actually installed in the pinned Electron version are authoritative for this build; latest web documentation may describe later platform behavior.
