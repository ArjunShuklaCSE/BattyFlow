import type { View } from '../shared/types';
import { hydrateIcons } from './icons';

const pill = document.getElementById('pill')!;
const label = document.getElementById('label')!;
const time = document.getElementById('time')!;
const wave = document.getElementById('wave')!;
const bars = Array.from({ length: 22 }, () => wave.appendChild(document.createElement('span')));
const levels: number[] = Array(bars.length).fill(0);
let state = 'idle';
let audio: AudioContext | null = null;

function pillState(v: View): [string, string] {
  switch (v.state) {
    case 'arming':
      return ['arming', 'Starting…'];
    case 'recording':
      return ['recording', v.partial ? `…${v.partial.slice(-48)}` : ''];
    case 'transcribing':
      return ['working', 'Transcribing…'];
    case 'transforming':
      return ['working', 'Polishing…'];
    case 'inserting':
      return ['working', 'Pasting…'];
    case 'error':
      return ['error', v.notice || 'Something went wrong.'];
    case 'cancelled':
      return ['note', v.notice || 'Discarded'];
  }
  if (v.delivered === 'pasted') return ['pasted', 'Pasted'];
  if (v.delivered === 'copied')
    return ['copied', v.notice && v.notice !== 'Copied. Press Ctrl+V to paste.' ? v.notice : 'Copied · press Ctrl+V'];
  if (v.delivered === 'kept') return ['pasted', 'Done'];
  return v.notice ? ['note', v.notice] : ['idle', ''];
}

/** Short sine blips; quiet enough not to be annoying. */
function blip(from: number, to: number, ms = 70): void {
  audio ??= new AudioContext();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  const now = audio.currentTime;
  osc.frequency.setValueAtTime(from, now);
  osc.frequency.exponentialRampToValueAtTime(to, now + ms / 1000);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);
  osc.connect(gain).connect(audio.destination);
  osc.start(now);
  osc.stop(now + ms / 1000 + 0.02);
}

function update(v: View): void {
  const [next, text] = pillState(v);
  if (v.settings.sounds && next !== state) {
    if (next === 'recording') blip(620, 880);
    else if (state === 'recording' && next === 'working') blip(880, 560);
    else if (next === 'error') blip(300, 220, 140);
  }
  if (next === 'recording') {
    levels.shift();
    // Speech RMS is roughly 0.01-0.3; a square root spreads quiet and loud speech across the bar height.
    levels.push(Math.min(1, Math.sqrt(v.level) * 2.4));
    bars.forEach((bar, i) => (bar.style.height = `${3 + Math.round(levels[i]! * 21)}px`));
    const seconds = Math.floor(v.elapsed);
    time.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  } else {
    if (state === 'recording') levels.fill(0);
    time.textContent = '';
  }
  state = next;
  pill.dataset['state'] = next;
  label.textContent = text;
  label.hidden = !text;
  pill.classList.add('visible');
}

document.getElementById('stop')!.addEventListener('click', () => void window.batty.toggle());
document.getElementById('cancel')!.addEventListener('click', () => {
  if (['arming', 'recording', 'working'].includes(state)) void window.batty.cancel();
  else void window.batty.hideOverlay().catch(() => {});
});
// The window is larger than the pill; let clicks through everywhere except the pill itself.
pill.addEventListener('mouseenter', () => void window.batty.overlayHover(true));
pill.addEventListener('mouseleave', () => void window.batty.overlayHover(false));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  pill.classList.remove('visible');
  void pill.offsetWidth; // restart the entrance transition
  pill.classList.add('visible');
});

hydrateIcons();
window.batty.onView(update);
void window.batty.snapshot().then(update);
