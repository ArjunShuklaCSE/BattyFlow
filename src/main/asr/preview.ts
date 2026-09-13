// A bounded whole-prefix preview: every result replaces the provisional tail.
// Nothing is committed or concatenated; final transcription always owns final text.
export class PreviewScheduler {
  private controller: AbortController | null = null;
  private work: Promise<void> | null = null;
  offer(infer: (signal: AbortSignal) => Promise<string>, publish: (text: string) => void): boolean {
    if (this.work) return false;
    const controller = new AbortController(); this.controller = controller;
    this.work = infer(controller.signal).then(text => { if (!controller.signal.aborted) publish(text); }).catch(() => {}).finally(() => { this.work = null; this.controller = null; });
    return true;
  }
  async stop(): Promise<void> { this.controller?.abort(); await this.work; }
}
