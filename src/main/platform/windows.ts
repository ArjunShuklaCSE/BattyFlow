import type { Target } from '../../shared/types';
import { runProcess } from '../privacy/process';
import { ManualPlatform } from './index';
export class WindowsPlatform extends ManualPlatform {
  constructor(readonly helper: string) { super('windows'); }
  override async capture(includeSelection = false): Promise<Target> {
    try {
      const result = await runProcess(this.helper, [includeSelection ? 'selection' : 'target'], { signal: new AbortController().signal, timeoutMs: 3000, maxBytes: 128000 });
      const value = JSON.parse(result.stdout) as Target;
      if (value.platform !== 'windows' || (value.identity !== null && typeof value.identity !== 'string') || (value.field !== null && typeof value.field !== 'string') || ![true,false,null].includes(value.secure) || typeof value.terminal !== 'boolean' || (value.selection !== undefined && (typeof value.selection !== 'string' || value.selection.length > 16000))) throw new Error('INVALID_TARGET');
      return value;
    } catch { return super.capture(); }
  }
  override async read(target: Target): Promise<string | null> { return target.secure === false ? target.selection || null : null; }
  override async validate(target: Target): Promise<boolean> {
    const current = await this.capture(true);
    return target.identity !== null && target.field !== null && current.secure === false && target.identity === current.identity && target.field === current.field && !!target.selection && target.selection === current.selection;
  }
  override capabilities(): Record<string,string> {
    return { ...super.capabilities(), target: 'Windows UI Automation: foreground process/window and focused element; capability can fail per app', selection: 'Windows UI Automation text selection when available; preview/manual replacement only', insertion: 'Explicit copy only. UI Automation identity does not prove cursor integrity for automatic paste.' };
  }
}
