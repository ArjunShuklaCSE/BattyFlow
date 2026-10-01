using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

// Long-lived Windows helper for BattyFlow. Speaks JSON lines on stdin/stdout.
//
//   target     foreground window identity, focused field, password/terminal/elevation flags
//   selection  the same, plus the selected text of the focused field (never for password fields)
//   paste      verify the foreground window, put text on the clipboard, send Ctrl+V (or Shift+Insert),
//              then restore the previous clipboard if nobody changed it in the meantime
//   ptt        watch one key combination and report press/release ("push-to-talk")
//
// It never reads window titles, files or the clipboard for any other purpose, and the keyboard hook
// only reports the configured combination. Compiled with the .NET Framework C# 5 compiler.
static class BattyHelper {
    const ulong Magic = 0x4246544655UL; // tags our own injected input so the hook can ignore it
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };
    static readonly BlockingCollection<string> Outbox = new BlockingCollection<string>();
    static Control clipboardThread;

    [STAThread]
    static int Main() {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        var writer = new Thread(() => { foreach (var message in Outbox.GetConsumingEnumerable()) { Console.Out.Write(message + "\n"); Console.Out.Flush(); } });
        writer.IsBackground = true; writer.Start();

        var ready = new ManualResetEvent(false);
        var ui = new Thread(() => {
            clipboardThread = new Control();
            clipboardThread.CreateControl();
            var unused = clipboardThread.Handle;
            ready.Set();
            Application.Run();
        });
        ui.SetApartmentState(ApartmentState.STA); ui.IsBackground = true; ui.Start();
        ready.WaitOne();
        Hook.Start();
        Task.Run(() => { try { var unused = AutomationElement.FocusedElement; } catch { } }); // first UIA call is slow
        Send(new Dictionary<string, object> { { "event", "ready" } });

        string line;
        while ((line = Console.In.ReadLine()) != null) {
            object id = null;
            try {
                var command = Json.Deserialize<Dictionary<string, object>>(line);
                id = command.ContainsKey("id") ? command["id"] : null;
                var reply = Handle(command);
                reply["id"] = id; reply["ok"] = true;
                Send(reply);
            } catch (Exception error) {
                Send(new Dictionary<string, object> { { "id", id }, { "ok", false }, { "error", error.Message } });
            }
        }
        return 0;
    }

    static void Send(Dictionary<string, object> message) { Outbox.Add(Json.Serialize(message)); }
    internal static void Event(string name, string state) { Send(new Dictionary<string, object> { { "event", name }, { "state", state } }); }

    static Dictionary<string, object> Handle(Dictionary<string, object> c) {
        string op = (string)c["op"];
        if (op == "ping") return new Dictionary<string, object>();
        if (op == "target") return new Dictionary<string, object> { { "target", Target.Probe(false) } };
        if (op == "selection") return new Dictionary<string, object> { { "target", Target.Probe(true) } };
        if (op == "paste") return new Dictionary<string, object> { { "result", Paste(c) } };
        if (op == "ptt") {
            var groups = ((System.Collections.IEnumerable)c["groups"]).Cast<System.Collections.IEnumerable>()
                .Select(g => g.Cast<object>().Select(Convert.ToInt32).ToArray()).ToArray();
            Hook.Configure(groups, c.ContainsKey("swallow") && (bool)c["swallow"]);
            return new Dictionary<string, object>();
        }
        throw new InvalidOperationException("UNKNOWN_OPERATION");
    }

    // ---------------------------------------------------------------- paste

    static string Paste(Dictionary<string, object> c) {
        string text = (string)c["text"];
        string identity = (string)c["identity"];
        bool terminal = c.ContainsKey("terminal") && (bool)c["terminal"];
        bool restore = !c.ContainsKey("restore") || (bool)c["restore"];
        int delay = c.ContainsKey("restoreDelayMs") ? Convert.ToInt32(c["restoreDelayMs"]) : 700;
        if (string.IsNullOrEmpty(text) || text.Length > 100000) throw new ArgumentException("INVALID_TEXT");

        // Same window, same process instance as when recording started. Never chase focus.
        var current = Target.Identity(Native.GetForegroundWindow());
        if (current == null || current != identity) return "focus-changed";
        uint pid; Native.GetWindowThreadProcessId(Native.GetForegroundWindow(), out pid);
        if (Target.IsElevated((int)pid)) return "elevated";
        if (Target.FocusedIsPassword()) return "secure";
        if (!WaitForModifiersReleased(1500)) return "keys-held";

        Clip.Snapshot saved = null;
        uint ours = 0;
        clipboardThread.Invoke(new Action(() => {
            if (restore) saved = Clip.Save();
            ours = Clip.SetText(text);
        }));
        if (ours == 0) return "clipboard-busy";

        if (terminal) Keys.Chord(Native.VK_SHIFT, Native.VK_INSERT, true);
        else Keys.Chord(Native.VK_CONTROL, 0x56 /* V */, false);

        if (restore && saved != null) {
            Thread.Sleep(Math.Max(100, Math.Min(5000, delay)));
            clipboardThread.Invoke(new Action(() => {
                // A newer copy by the user (or the target app) wins over our restore.
                if (Native.GetClipboardSequenceNumber() == ours) Clip.Restore(saved);
            }));
        }
        return "pasted";
    }

    static bool WaitForModifiersReleased(int timeoutMs) {
        var watch = Stopwatch.StartNew();
        int[] keys = { Native.VK_SHIFT, Native.VK_CONTROL, Native.VK_MENU, 0x5B, 0x5C };
        while (watch.ElapsedMilliseconds < timeoutMs) {
            if (keys.All(k => (Native.GetAsyncKeyState(k) & 0x8000) == 0)) return true;
            Thread.Sleep(10);
        }
        return false;
    }

    // ---------------------------------------------------------------- target

    static class Target {
        static readonly HashSet<string> Terminals = new HashSet<string> {
            "windowsterminal", "openconsole", "conhost", "cmd", "powershell", "pwsh", "wezterm-gui",
            "alacritty", "mintty", "tabby", "hyper", "warp", "wsl", "bash"
        };

        internal static string Identity(IntPtr hwnd) {
            if (hwnd == IntPtr.Zero) return null;
            uint pid; Native.GetWindowThreadProcessId(hwnd, out pid);
            try {
                using (var p = Process.GetProcessById((int)pid)) return hwnd.ToInt64() + ":" + pid + ":" + p.StartTime.ToUniversalTime().Ticks;
            } catch { return hwnd.ToInt64() + ":" + pid + ":0"; }
        }

        internal static Dictionary<string, object> Probe(bool includeSelection) {
            var result = new Dictionary<string, object> {
                { "platform", "windows" }, { "identity", null }, { "field", null }, { "secure", null },
                { "terminal", false }, { "elevated", false }, { "app", null }, { "pid", 0 }
            };
            var hwnd = Native.GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return result;
            uint pid; Native.GetWindowThreadProcessId(hwnd, out pid);
            result["identity"] = Identity(hwnd);
            result["pid"] = (int)pid;
            result["elevated"] = IsElevated((int)pid);
            try {
                using (var p = Process.GetProcessById((int)pid)) {
                    string name = p.ProcessName.ToLowerInvariant();
                    result["app"] = name;
                    result["terminal"] = Terminals.Contains(name);
                }
            } catch { }

            // UI Automation can hang on an unresponsive app. Identity above is enough to paste safely;
            // field details are best effort with a hard deadline.
            var uia = Task.Run(() => {
                var details = new Dictionary<string, object>();
                var element = AutomationElement.FocusedElement;
                if (element == null || element.Current.ProcessId != (int)pid) return details;
                details["field"] = string.Join(".", element.GetRuntimeId());
                bool password = element.Current.IsPassword;
                details["secure"] = password;
                if (includeSelection && !password) {
                    object pattern;
                    if (element.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) {
                        var ranges = ((TextPattern)pattern).GetSelection();
                        if (ranges.Length == 1) {
                            string text = ranges[0].GetText(16001);
                            if (!string.IsNullOrWhiteSpace(text) && text.Length <= 16000) details["selection"] = text;
                        }
                    }
                }
                // A focus change during the probe means none of this describes one field.
                if (Native.GetForegroundWindow() != hwnd || !Automation.Compare(AutomationElement.FocusedElement, element)) details.Clear();
                return details;
            });
            try {
                if (uia.Wait(includeSelection ? 1500 : 600)) foreach (var pair in uia.Result) result[pair.Key] = pair.Value;
            } catch { }
            return result;
        }

        internal static bool FocusedIsPassword() {
            var check = Task.Run(() => { var e = AutomationElement.FocusedElement; return e != null && e.Current.IsPassword; });
            try { return check.Wait(600) && check.Result; } catch { return false; }
        }

        // Windows silently drops input sent to a higher-integrity window (UIPI). Detect it up front.
        internal static bool IsElevated(int pid) {
            IntPtr process = Native.OpenProcess(0x1000 /* QUERY_LIMITED_INFORMATION */, false, pid);
            if (process == IntPtr.Zero) return true;
            try {
                IntPtr token;
                if (!Native.OpenProcessToken(process, 0x0008 /* TOKEN_QUERY */, out token)) return true;
                try { return Integrity(token) > Integrity(Native.GetCurrentProcessToken()); }
                finally { Native.CloseHandle(token); }
            } finally { Native.CloseHandle(process); }
        }

        static int Integrity(IntPtr token) {
            int length;
            Native.GetTokenInformation(token, 25 /* TokenIntegrityLevel */, IntPtr.Zero, 0, out length);
            IntPtr buffer = Marshal.AllocHGlobal(length);
            try {
                if (!Native.GetTokenInformation(token, 25, buffer, length, out length)) return 0;
                IntPtr sid = Marshal.ReadIntPtr(buffer);
                int count = Marshal.ReadByte(Native.GetSidSubAuthorityCount(sid));
                return Marshal.ReadInt32(Native.GetSidSubAuthority(sid, (uint)(count - 1)));
            } finally { Marshal.FreeHGlobal(buffer); }
        }
    }

    // ---------------------------------------------------------------- clipboard

    static class Clip {
        internal class Snapshot { public List<KeyValuePair<uint, byte[]>> Items = new List<KeyValuePair<uint, byte[]>>(); }
        static readonly uint[] Private = {
            Native.RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing"),
            Native.RegisterClipboardFormat("CanIncludeInClipboardHistory"),
            Native.RegisterClipboardFormat("CanUploadToCloudClipboard"),
        };

        static bool Open() {
            for (int i = 0; i < 25; i++) { if (Native.OpenClipboard(clipboardThread.Handle)) return true; Thread.Sleep(20); }
            return false;
        }

        // GDI handles, metafiles and private formats are not plain memory and cannot be copied byte for byte.
        // Windows re-synthesizes bitmaps from the saved DIB formats.
        static bool Copyable(uint format) {
            if (format == 2 || format == 3 || format == 9 || format == 14) return false;
            if (format == 0x80 || format == 0x82 || format == 0x83 || format == 0x8E) return false;
            return format < 0x200 || format > 0x3FF;
        }

        internal static Snapshot Save() {
            var snapshot = new Snapshot();
            if (!Open()) return null;
            try {
                long total = 0;
                for (uint format = Native.EnumClipboardFormats(0); format != 0; format = Native.EnumClipboardFormats(format)) {
                    if (!Copyable(format) || Private.Contains(format)) continue;
                    IntPtr handle = Native.GetClipboardData(format);
                    if (handle == IntPtr.Zero) continue;
                    long size = (long)Native.GlobalSize(handle).ToUInt64();
                    if (size <= 0 || (total += size) > 256L * 1024 * 1024) return null;
                    IntPtr data = Native.GlobalLock(handle);
                    if (data == IntPtr.Zero) continue;
                    try { var bytes = new byte[size]; Marshal.Copy(data, bytes, 0, (int)size); snapshot.Items.Add(new KeyValuePair<uint, byte[]>(format, bytes)); }
                    finally { Native.GlobalUnlock(handle); }
                }
            } finally { Native.CloseClipboard(); }
            return snapshot;
        }

        internal static uint SetText(string text) {
            if (!Open()) return 0;
            try {
                Native.EmptyClipboard();
                Put(13 /* CF_UNICODETEXT */, Encoding.Unicode.GetBytes(text + "\0"));
                MarkPrivate();
            } finally { Native.CloseClipboard(); }
            return Native.GetClipboardSequenceNumber();
        }

        internal static void Restore(Snapshot snapshot) {
            if (!Open()) return;
            try {
                Native.EmptyClipboard();
                foreach (var item in snapshot.Items) Put(item.Key, item.Value);
                // The original copy is already in clipboard history; don't add a duplicate.
                if (snapshot.Items.Count > 0) MarkPrivate();
            } finally { Native.CloseClipboard(); }
        }

        static void MarkPrivate() {
            Put(Private[0], new byte[4]);
            Put(Private[1], new byte[4]);
            Put(Private[2], new byte[4]);
        }

        static void Put(uint format, byte[] bytes) {
            IntPtr handle = Native.GlobalAlloc(0x0002 /* GMEM_MOVEABLE */, (UIntPtr)Math.Max(1, bytes.Length));
            if (handle == IntPtr.Zero) return;
            IntPtr data = Native.GlobalLock(handle);
            Marshal.Copy(bytes, 0, data, bytes.Length);
            Native.GlobalUnlock(handle);
            if (Native.SetClipboardData(format, handle) == IntPtr.Zero) Native.GlobalFree(handle);
        }
    }

    // ---------------------------------------------------------------- keyboard output

    static class Keys {
        internal static void Chord(int modifier, int key, bool extended) {
            var inputs = new[] {
                Input(modifier, false, false), Input(key, false, extended),
                Input(key, true, extended), Input(modifier, true, false),
            };
            Native.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Native.INPUT)));
        }

        internal static void Tap(int key) {
            var inputs = new[] { Input(key, false, false), Input(key, true, false) };
            Native.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Native.INPUT)));
        }

        static Native.INPUT Input(int vk, bool up, bool extended) {
            var input = new Native.INPUT { type = 1 };
            input.u.ki.wVk = (ushort)vk;
            input.u.ki.wScan = (ushort)Native.MapVirtualKey((uint)vk, 0);
            input.u.ki.dwFlags = (up ? 0x0002u : 0u) | (extended ? 0x0001u : 0u);
            input.u.ki.dwExtraInfo = (UIntPtr)Magic;
            return input;
        }
    }

    // ---------------------------------------------------------------- push-to-talk

    // Reports only the configured combination: "down" when every group has a key held and nothing else is,
    // "up" when it is released, "abort" if another key joins (the user was typing a shortcut instead).
    static class Hook {
        static readonly object Sync = new object();
        static readonly Native.HookProc Callback = Process;
        static readonly HashSet<int> Pressed = new HashSet<int>();
        static int[][] groups = new int[0][];
        static bool swallow, active, blocked;

        internal static void Start() {
            var thread = new Thread(() => {
                Native.SetWindowsHookEx(13 /* WH_KEYBOARD_LL */, Callback, Native.GetModuleHandle(null), 0);
                Native.MSG message;
                while (Native.GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { }
            });
            thread.IsBackground = true; thread.Start();
        }

        internal static void Configure(int[][] next, bool swallowKeys) {
            lock (Sync) {
                if (active) BattyHelper.Event("ptt", "abort");
                groups = next; swallow = swallowKeys; active = false; blocked = false; Pressed.Clear();
            }
        }

        static bool InCombo(int vk) { return groups.Any(g => g.Contains(vk)); }

        static IntPtr Process(int code, IntPtr wParam, IntPtr lParam) {
            if (code >= 0) {
                var k = (Native.KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(Native.KBDLLHOOKSTRUCT));
                // Ignore our own synthetic keys and the fake Left Ctrl that AltGr layouts generate.
                bool fakeCtrl = k.vkCode == 0xA2 && k.scanCode == 0x21D;
                if (k.dwExtraInfo.ToUInt64() != Magic && !fakeCtrl && Update((int)k.vkCode, wParam.ToInt32() == 0x100 || wParam.ToInt32() == 0x104))
                    return (IntPtr)1;
            }
            return Native.CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
        }

        static bool Update(int vk, bool down) {
            lock (Sync) {
                if (groups.Length == 0) return false;
                bool combo = InCombo(vk);
                if (down) Pressed.Add(vk); else Pressed.Remove(vk);
                bool satisfied = groups.All(g => g.Any(Pressed.Contains));
                if (active) {
                    if (down && !combo) { active = false; blocked = true; BattyHelper.Event("ptt", "abort"); }
                    else if (!down && combo && !satisfied) { active = false; BattyHelper.Event("ptt", "up"); }
                } else if (blocked) {
                    if (!Pressed.Any(InCombo)) blocked = false;
                } else if (down && combo && satisfied && Pressed.All(InCombo)) {
                    active = true;
                    BattyHelper.Event("ptt", "down");
                    // A key event while Win or Alt is held stops Windows from opening Start, or the app from
                    // focusing its menu bar, when the key is released. 0xE8 is an unassigned virtual key.
                    if (groups.Any(g => g.Any(key => key == 0x5B || key == 0x5C || key == 0xA4 || key == 0xA5))) Keys.Tap(0xE8);
                }
                return swallow && combo;
            }
        }
    }

    // ---------------------------------------------------------------- Win32

    static class Native {
        internal const int VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12, VK_INSERT = 0x2D;
        internal delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)] internal struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public UIntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)] internal struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }
        [StructLayout(LayoutKind.Sequential)] internal struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public UIntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)] internal struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public UIntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Explicit)] internal struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
        [StructLayout(LayoutKind.Sequential)] internal struct INPUT { public uint type; public InputUnion u; }

        [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
        [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int key);
        [DllImport("user32.dll")] internal static extern uint MapVirtualKey(uint code, uint mapType);
        [DllImport("user32.dll", SetLastError = true)] internal static extern uint SendInput(uint count, INPUT[] inputs, int size);
        [DllImport("user32.dll", SetLastError = true)] internal static extern IntPtr SetWindowsHookEx(int id, HookProc callback, IntPtr module, uint thread);
        [DllImport("user32.dll")] internal static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] internal static extern int GetMessage(out MSG message, IntPtr hwnd, uint min, uint max);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr GetModuleHandle(string name);
        [DllImport("user32.dll", SetLastError = true)] internal static extern bool OpenClipboard(IntPtr owner);
        [DllImport("user32.dll")] internal static extern bool CloseClipboard();
        [DllImport("user32.dll")] internal static extern bool EmptyClipboard();
        [DllImport("user32.dll")] internal static extern uint EnumClipboardFormats(uint format);
        [DllImport("user32.dll")] internal static extern IntPtr GetClipboardData(uint format);
        [DllImport("user32.dll")] internal static extern IntPtr SetClipboardData(uint format, IntPtr data);
        [DllImport("user32.dll")] internal static extern uint GetClipboardSequenceNumber();
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern uint RegisterClipboardFormat(string name);
        [DllImport("kernel32.dll")] internal static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);
        [DllImport("kernel32.dll")] internal static extern IntPtr GlobalLock(IntPtr handle);
        [DllImport("kernel32.dll")] internal static extern bool GlobalUnlock(IntPtr handle);
        [DllImport("kernel32.dll")] internal static extern UIntPtr GlobalSize(IntPtr handle);
        [DllImport("kernel32.dll")] internal static extern IntPtr GlobalFree(IntPtr handle);
        [DllImport("kernel32.dll")] internal static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
        [DllImport("kernel32.dll")] internal static extern bool CloseHandle(IntPtr handle);
        [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool GetTokenInformation(IntPtr token, int infoClass, IntPtr info, int length, out int returned);
        [DllImport("advapi32.dll")] internal static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
        [DllImport("advapi32.dll")] internal static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
        internal static IntPtr GetCurrentProcessToken() { return (IntPtr)(-4); }
    }
}
