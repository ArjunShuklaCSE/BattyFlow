import type { Target } from '../../shared/types';
import type { Session } from '../session';
export interface ClipboardPort { formats(): string[]; readText(): string; writeText(text: string): void; clear(): void }
export interface DeliveryPort { current(): Promise<Target>; paste(): Promise<void> }
export function sameTarget(a: Target, b: Target): boolean {
  return a.identity !== null && a.field !== null && a.identity === b.identity && a.field === b.field && b.secure === false && !b.terminal && a.selection === b.selection;
}
export class InsertionTransaction {
  private busy = false;
  async run(s: Session, text: string, clipboard: ClipboardPort, delivery: DeliveryPort): Promise<'manual' | 'attempted'> {
    if (this.busy || !s.alive() || s.attempted) return 'manual';
    this.busy = true;
    try {
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) || !sameTarget(s.target, await delivery.current()) || !s.alive()) return 'manual';
      // Never flatten rich clipboard data or files into a text snapshot.
      if (clipboard.formats().some(f => !['text/plain', 'text'].includes(f))) return 'manual';
      const hadText = clipboard.formats().length > 0; const previous = clipboard.readText();
      s.claimInsertion(); clipboard.writeText(text);
      try {
        const current = await delivery.current();
        if (!s.alive() || !sameTarget(s.target, current)) throw new Error('TARGET_CHANGED');
        await delivery.paste();
        if (s.alive()) s.move('idle');
        return 'attempted';
      } finally {
        // This abstraction is not enabled on an OS without an atomic clipboard generation check.
        if (clipboard.formats().every(f => ['text/plain', 'text'].includes(f)) && clipboard.readText() === text) {
          if (hadText) clipboard.writeText(previous); else clipboard.clear();
        }
      }
    } catch (error) { if (s.alive()) s.move('error'); throw error; }
    finally { this.busy = false; }
  }
}
