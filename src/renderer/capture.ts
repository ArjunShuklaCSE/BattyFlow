import type { CaptureCommand } from '../shared/types';
let current: { id: string; context: AudioContext; stream: MediaStream; node: AudioWorkletNode; pending: Set<Promise<unknown>>; sequence: number; stopping: boolean; timeout: ReturnType<typeof setTimeout> } | null = null;
let generation = 0;
async function release(): Promise<void> {
  const old = current; current = null;
  if (!old) return;
  clearTimeout(old.timeout); old.stream.getTracks().forEach(t => t.stop()); old.node.disconnect();
  await old.context.close().catch(() => {});
}
async function failed(id: string, code: string): Promise<void> { generation++; await release(); await window.capture.failed(id, code); }
async function handle(command: CaptureCommand): Promise<void> {
  if (command.action === 'cancel') { generation++; if (current?.id === command.id) await release(); return; }
  if (command.action === 'stop') {
    if (current?.id !== command.id || current.stopping) return;
    current.stopping = true; current.node.port.postMessage('stop'); return;
  }
  const epoch = ++generation; await release();
  let stream: MediaStream | null = null; let context: AudioContext | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(command.device ? { deviceId: { exact: command.device } } : {}), channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
    if (epoch !== generation) { stream.getTracks().forEach(t => t.stop()); return; }
    context = new AudioContext(); await context.audioWorklet.addModule('worklet.js');
    if (epoch !== generation) { stream.getTracks().forEach(t => t.stop()); await context.close(); return; }
    const node = new AudioWorkletNode(context, 'batty-pcm');
    const source = context.createMediaStreamSource(stream); source.connect(node);
    const mute = context.createGain(); mute.gain.value = 0; node.connect(mute).connect(context.destination);
    const recording = { id: command.id, context, stream, node, pending: new Set<Promise<unknown>>(), sequence: 0, stopping: false, timeout: setTimeout(() => { void failed(command.id, 'CAPTURE_DURATION_LIMIT'); }, (command.maxSeconds + 5) * 1000) };
    current = recording;
    node.port.onmessage = event => {
      if (current !== recording) return;
      if (event.data === 'stopped') {
        void Promise.all(recording.pending).then(async () => { if (current !== recording) return; await release(); await window.capture.stopped(command.id); }); return;
      }
      if (!(event.data instanceof Float32Array)) return;
      if (recording.pending.size >= 8) { void failed(command.id, 'AUDIO_BACKPRESSURE'); return; }
      const promise = window.capture.frame(command.id, recording.sequence++, event.data).catch(() => { void failed(command.id, 'CAPTURE_IPC_FAILED'); }).finally(() => recording.pending.delete(promise));
      recording.pending.add(promise);
    };
    for (const track of stream.getAudioTracks()) track.onended = () => { if (current === recording && !recording.stopping) void failed(command.id, 'MICROPHONE_DISCONNECTED'); };
    node.onprocessorerror = () => { void failed(command.id, 'AUDIO_WORKLET_FAILED'); };
    await context.resume(); await window.capture.started(command.id, context.sampleRate);
  } catch (error) {
    stream?.getTracks().forEach(t => t.stop()); await context?.close().catch(() => {});
    if (epoch !== generation) return;
    const name = error instanceof DOMException ? error.name : '';
    await failed(command.id, name === 'NotAllowedError' ? 'MICROPHONE_PERMISSION_DENIED' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'MICROPHONE_NOT_FOUND' : 'MICROPHONE_START_FAILED');
  }
}
window.capture.onCommand(command => { void handle(command); });
window.capture.onDevices(async () => (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput').map((d,i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i+1} (grant permission to see name)` })));
window.addEventListener('beforeunload', () => { current?.stream.getTracks().forEach(t => t.stop()); });
