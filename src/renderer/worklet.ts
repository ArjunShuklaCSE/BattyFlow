import { Resampler, FRAME } from '../shared/audio';
declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;
class PCMProcessor extends AudioWorkletProcessor {
  private resampler = new Resampler(sampleRate);
  private pending: number[] = [];
  private active = true;
  constructor() {
    super(); this.port.onmessage = e => {
      if (e.data === 'stop') { this.send(this.resampler.push(new Float32Array(0), true)); if (this.pending.length) this.port.postMessage(Float32Array.from(this.pending)); this.pending = []; this.active = false; this.port.postMessage('stopped'); }
    };
  }
  private send(samples: Float32Array): void {
    for (const s of samples) this.pending.push(s);
    while (this.pending.length >= FRAME) { const frame = Float32Array.from(this.pending.splice(0, FRAME)); this.port.postMessage(frame, [frame.buffer]); }
  }
  process(inputs: Float32Array[][]): boolean {
    if (!this.active) return false;
    const channels = inputs[0]; if (!channels?.length || !channels[0]) return true;
    const mono = new Float32Array(channels[0].length);
    for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] ?? 0) + (channel[i] ?? 0) / channels.length;
    this.send(this.resampler.push(mono)); return true;
  }
}
registerProcessor('batty-pcm', PCMProcessor);
