using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Automation;

// Read-only, no clipboard, input synthesis, project scanning, or networking.
class TargetProbe {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [MTAThread]
    static void Main(string[] args) {
        var result = new Dictionary<string, object> {
            {"platform", "windows"}, {"identity", null}, {"field", null}, {"secure", null}, {"terminal", false}
        };
        try {
            var window = GetForegroundWindow(); uint pid;
            GetWindowThreadProcessId(window, out pid);
            var process = Process.GetProcessById((int)pid);
            var element = AutomationElement.FocusedElement;
            // A cross-process focused element or a focus race is not an established target.
            if (window == IntPtr.Zero || element == null || element.Current.ProcessId != (int)pid) throw new InvalidOperationException();
            result["identity"] = window.ToInt64().ToString() + ":" + pid + ":" + process.StartTime.ToUniversalTime().Ticks;
            result["field"] = string.Join(".", element.GetRuntimeId());
            result["secure"] = element.Current.IsPassword;
            string name = process.ProcessName.ToLowerInvariant();
            result["terminal"] = name == "windowsterminal" || name == "powershell" || name == "pwsh" || name == "cmd" || name == "conhost" || name == "wezterm-gui";
            if (args.Length == 1 && args[0] == "selection" && !element.Current.IsPassword) {
                object pattern;
                if (element.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) {
                    var selections = ((TextPattern)pattern).GetSelection();
                    if (selections.Length == 1) {
                        string text = selections[0].GetText(16001);
                        if (!string.IsNullOrWhiteSpace(text) && text.Length <= 16000) result["selection"] = text;
                    }
                }
            }
            if (GetForegroundWindow() != window || !Automation.Compare(AutomationElement.FocusedElement, element)) {
                result["identity"] = null; result["field"] = null; result.Remove("selection");
            }
        } catch { result["identity"] = null; result["field"] = null; result.Remove("selection"); }
        Console.OutputEncoding = new System.Text.UTF8Encoding(false);
        Console.Write(new JavaScriptSerializer().Serialize(result));
    }
}
