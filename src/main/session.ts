import { randomUUID } from 'node:crypto';
import type { Mode, State, Target } from '../shared/types';
export const transitions: Record<State, readonly State[]> = {
  idle: ['arming'], arming: ['recording', 'cancelled', 'error'],
  recording: ['transcribing', 'cancelled', 'error'], transcribing: ['transforming', 'ready', 'cancelled', 'error'],
  transforming: ['ready', 'cancelled', 'error'], ready: ['inserting', 'cancelled'],
  inserting: ['idle', 'error', 'cancelled'], cancelled: ['idle'], error: ['idle'],
};
export class Session {
  readonly id = randomUUID();
  readonly controller = new AbortController();
  state: State = 'idle';
  text = ''; partial = ''; notice = ''; attempted = false;
  timings: Record<string, number> = {};
  constructor(readonly mode: Mode, readonly target: Target) { this.move('arming'); }
  move(next: State): void {
    if (!transitions[this.state].includes(next)) throw new Error('INVALID_TRANSITION');
    this.state = next;
  }
  cancel(): void {
    this.controller.abort(); this.text = ''; this.partial = '';
    if (transitions[this.state].includes('cancelled')) this.move('cancelled');
  }
  alive(id = this.id): boolean { return this.id === id && !this.controller.signal.aborted && !['error', 'cancelled', 'idle'].includes(this.state); }
  claimInsertion(): void {
    if (!this.alive() || this.attempted || this.state !== 'ready') throw new Error('INSERTION_NOT_AUTHORIZED');
    this.attempted = true; this.move('inserting');
  }
}
