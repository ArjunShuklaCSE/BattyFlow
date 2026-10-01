import { readFile, rm } from 'node:fs/promises';
import type { HistoryEntry, Stats } from '../shared/types';
import { atomicJson } from './settings/store';

const limit = 500;

/** Recent transcripts, kept in one local JSON file. Turning history off deletes the file. */
export class History {
  private entries: HistoryEntry[] = [];
  private writing: Promise<void> = Promise.resolve();
  constructor(readonly path: string) {}

  async load(): Promise<void> {
    try {
      const data: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (Array.isArray(data)) this.entries = data.filter(valid).slice(0, limit);
    } catch {}
  }

  list(): HistoryEntry[] {
    return this.entries;
  }

  add(entry: HistoryEntry): Promise<void> {
    this.entries = [entry, ...this.entries].slice(0, limit);
    return this.save();
  }

  remove(id: string): Promise<void> {
    this.entries = this.entries.filter(entry => entry.id !== id);
    return this.save();
  }

  async clear(): Promise<void> {
    this.entries = [];
    await this.writing;
    await rm(this.path, { force: true });
  }

  stats(now = Date.now()): Stats {
    const midnight = new Date(now).setHours(0, 0, 0, 0);
    let words = 0;
    let wordsToday = 0;
    let seconds = 0;
    for (const entry of this.entries) {
      words += entry.words;
      seconds += entry.seconds;
      if (entry.at >= midnight) wordsToday += entry.words;
    }
    return {
      sessions: this.entries.length,
      words,
      wordsToday,
      wpm: seconds >= 5 ? Math.round(words / (seconds / 60)) : null,
    };
  }

  private save(): Promise<void> {
    // Serialise writes so a slow disk can't reorder them.
    this.writing = this.writing.then(() => atomicJson(this.path, this.entries)).catch(() => {});
    return this.writing;
  }
}

function valid(value: unknown): value is HistoryEntry {
  const e = value as HistoryEntry;
  return (
    !!e &&
    typeof e.id === 'string' &&
    typeof e.text === 'string' &&
    e.text.length <= 100000 &&
    Number.isFinite(e.at) &&
    Number.isFinite(e.seconds) &&
    Number.isInteger(e.words) &&
    ['pasted', 'copied', 'kept'].includes(e.delivered)
  );
}
