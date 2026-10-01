import type { PasteResult, PushToTalk, Target } from '../../shared/types';

export interface Platform {
  /** Foreground window and focused field when recording starts. */
  capture(includeSelection: boolean): Promise<Target>;
  /** Paste into the window captured at the start, only if it is still in front. */
  paste(text: string, target: Target, options: { restore: boolean }): Promise<PasteResult>;
  setPushToTalk(key: PushToTalk): Promise<boolean>;
  onPushToTalk: (state: 'down' | 'up' | 'abort') => void;
  capabilities(): Record<string, string>;
  dispose(): void;
}

/** macOS and Linux: recording, transcription and copy work; nothing is typed into other apps yet. */
export class ManualPlatform implements Platform {
  onPushToTalk: Platform['onPushToTalk'] = () => {};
  constructor(readonly name: 'macos' | 'linux-x11' | 'linux-wayland' | 'windows') {}
  async capture(): Promise<Target> {
    return { platform: this.name, identity: null, field: null, secure: null, terminal: false };
  }
  async paste(): Promise<PasteResult> {
    return 'unavailable';
  }
  async setPushToTalk(): Promise<boolean> {
    return false;
  }
  capabilities(): Record<string, string> {
    return {
      'Paste into apps': 'Not available on this platform yet. Results are copied for you to paste.',
      'Push-to-talk': 'Not available on this platform yet. Use the toggle shortcut.',
      Selection: 'Not available on this platform yet.',
    };
  }
  dispose(): void {}
}

export function platformName(): ManualPlatform['name'] {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return process.env['XDG_SESSION_TYPE'] === 'wayland' ? 'linux-wayland' : 'linux-x11';
}
