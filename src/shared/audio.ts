export const RATE = 16000;
export const FRAME = 320;
// Streaming windowed-sinc low-pass interpolation. 64 taps, 32 source samples latency.
// The retained history is bounded independently of utterance length.
export class Resampler {
  private buffer: number[] = Array(32).fill(0) as number[];
  private position = 32;
  constructor(readonly sourceRate: number, readonly targetRate = RATE) {
    if (!Number.isFinite(sourceRate) || sourceRate < 8000 || sourceRate > 192000) throw new Error('SAMPLE_RATE');
  }
  push(input: Float32Array, flush = false): Float32Array {
    for (const sample of input) this.buffer.push(Number.isFinite(sample) ? sample : 0);
    if (flush) this.buffer.push(...Array<number>(32).fill(0));
    const result: number[] = [];
    const step = this.sourceRate / this.targetRate;
    const cutoff = Math.min(1, this.targetRate / this.sourceRate) * 0.94;
    while (this.position + 32 < this.buffer.length) {
      const base = Math.floor(this.position); let sum = 0; let norm = 0;
      for (let k = -31; k <= 32; k++) {
        const distance = base + k - this.position;
        const x = Math.PI * distance * cutoff;
        const weight = (Math.abs(x) < 1e-8 ? 1 : Math.sin(x) / x) * (0.5 + 0.5 * Math.cos(Math.PI * distance / 32)) * cutoff;
        sum += (this.buffer[base + k] ?? 0) * weight; norm += weight;
      }
      result.push(Math.max(-1, Math.min(1, sum / norm))); this.position += step;
    }
    const remove = Math.max(0, Math.floor(this.position) - 32);
    this.buffer.splice(0, remove); this.position -= remove;
    return Float32Array.from(result);
  }
}
export function rms(frame: Float32Array): number {
  let sum = 0; for (const x of frame) sum += x * x;
  return Math.sqrt(sum / Math.max(1, frame.length));
}
export class EnergyVad {
  speechFrames = 0; consecutive = 0; silenceFrames = 0;
  accept(frame: Float32Array): boolean {
    const voiced = rms(frame) >= 0.012;
    this.consecutive = voiced ? this.consecutive + 1 : 0;
    if (voiced) this.speechFrames++;
    this.silenceFrames = voiced ? 0 : this.silenceFrames + 1;
    return this.consecutive >= 3;
  }
  get hasSpeech(): boolean { return this.speechFrames >= 8; }
  reset(): void { this.speechFrames = 0; this.consecutive = 0; this.silenceFrames = 0; }
}
export function wav(pcm: Float32Array): Buffer {
  const data = Buffer.alloc(44 + pcm.length * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(RATE, 24); data.writeUInt32LE(RATE * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(pcm.length * 2, 40);
  pcm.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * (v < 0 ? 32768 : 32767)), 44 + i * 2));
  return data;
}
export function readWav(data: Buffer): Float32Array {
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') throw new Error('INVALID_WAV');
  let format = false;
  for (let p = 12; p + 8 <= data.length;) {
    const id = data.toString('ascii', p, p + 4); const size = data.readUInt32LE(p + 4); const start = p + 8;
    if (start + size > data.length) throw new Error('TRUNCATED_WAV');
    if (id === 'fmt ') {
      if (size < 16 || data.readUInt16LE(start) !== 1 || data.readUInt16LE(start + 2) !== 1 || data.readUInt32LE(start + 4) !== RATE || data.readUInt16LE(start + 14) !== 16) throw new Error('WAV_REQUIRES_16KHZ_MONO_PCM16');
      format = true;
    }
    if (id === 'data') {
      if (!format || size % 2) throw new Error('INVALID_WAV');
      return Float32Array.from({ length: size / 2 }, (_, i) => data.readInt16LE(start + i * 2) / 32768);
    }
    p = start + size + size % 2;
  }
  throw new Error('NO_WAV_DATA');
}
