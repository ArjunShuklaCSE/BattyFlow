import type { PasteResult, PushToTalk, Target } from '../../shared/types';
import type { Platform } from './index';
import { Helper } from './helper';

// Virtual-key groups: every group needs one key held. Left/right variants count as the same key.
const keys: Record<Exclude<PushToTalk, 'off'>, { groups: number[][]; swallow: boolean }> = {
  'ctrl-win': {
    groups: [
      [0xa2, 0xa3],
      [0x5b, 0x5c],
    ],
    swallow: false,
  },
  'right-ctrl': { groups: [[0xa3]], swallow: false },
  'right-alt': { groups: [[0xa5]], swallow: false },
  // Swallowed so holding it doesn't toggle Caps Lock.
  'caps-lock': { groups: [[0x14]], swallow: true },
};

const pasteResults = new Set<PasteResult>([
  'pasted',
  'focus-changed',
  'elevated',
  'secure',
  'keys-held',
  'clipboard-busy',
]);

export function validTarget(value: unknown): value is Target {
  const t = value as Target;
  return (
    !!t &&
    t.platform === 'windows' &&
    (t.identity === null || typeof t.identity === 'string') &&
    (t.field === null || typeof t.field === 'string') &&
    [true, false, null].includes(t.secure) &&
    typeof t.terminal === 'boolean' &&
    (t.selection === undefined || (typeof t.selection === 'string' && t.selection.length <= 16000)) &&
    (t.app === undefined || t.app === null || (typeof t.app === 'string' && t.app.length < 260)) &&
    (t.pid === undefined || Number.isInteger(t.pid))
  );
}

export class WindowsPlatform implements Platform {
  private readonly helper: Helper;
  onPushToTalk: Platform['onPushToTalk'] = () => {};

  constructor(helperPath: string) {
    this.helper = new Helper(helperPath);
    this.helper.onEvent = (event, state) => {
      if (event === 'ptt' && (state === 'down' || state === 'up' || state === 'abort')) this.onPushToTalk(state);
    };
    this.helper.start();
  }

  async capture(includeSelection = false): Promise<Target> {
    try {
      const reply = await this.helper.request(
        includeSelection ? 'selection' : 'target',
        {},
        includeSelection ? 2500 : 1500,
      );
      if (validTarget(reply['target'])) return reply['target'];
    } catch {}
    return { platform: 'windows', identity: null, field: null, secure: null, terminal: false };
  }

  async paste(text: string, target: Target, options: { restore: boolean }): Promise<PasteResult> {
    if (!target.identity) return 'focus-changed';
    if (target.elevated) return 'elevated';
    try {
      const reply = await this.helper.request(
        'paste',
        { text, identity: target.identity, terminal: target.terminal, restore: options.restore, restoreDelayMs: 700 },
        5000,
      );
      const result = reply['result'] as PasteResult;
      return pasteResults.has(result) ? result : 'unavailable';
    } catch {
      return 'unavailable';
    }
  }

  async setPushToTalk(key: PushToTalk): Promise<boolean> {
    const config = key === 'off' ? { groups: [], swallow: false } : keys[key];
    try {
      await this.helper.configurePushToTalk(config.groups, config.swallow);
      return true;
    } catch {
      return false;
    }
  }

  capabilities(): Record<string, string> {
    return {
      'Paste into apps':
        'Pastes into the window you started in, only if it is still in front. Skips password fields and apps running as administrator.',
      'Push-to-talk': 'Hold the push-to-talk key to record, release to transcribe.',
      Selection: 'Reads the selected text in apps that expose it to Windows UI Automation (for Edit mode).',
      Clipboard: 'Your clipboard is restored after pasting. Dictated text is kept out of Windows clipboard history.',
    };
  }

  dispose(): void {
    this.helper.dispose();
  }
}
