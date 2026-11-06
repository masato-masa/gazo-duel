// 効果音は WebAudio で合成する（ファイルを持たない）。?mute で止める。
let ctx: AudioContext | null = null;
let muted = false;
try {
  muted = new URLSearchParams(location.search).has('mute') || localStorage.getItem('gazo-mute') === '1';
} catch {
  /* 保存できない環境では既定のまま */
}

export const isMuted = (): boolean => muted;
export function setMuted(v: boolean): void {
  muted = v;
  try {
    localStorage.setItem('gazo-mute', v ? '1' : '0');
  } catch {
    /* 無視 */
  }
}

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(c: AudioContext, t0: number, f0: number, f1: number, dur: number, type: OscillatorType, vol: number): void {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(c: AudioContext, t0: number, dur: number, vol: number, hp = 200): void {
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t0);
}

export type Sfx = 'summon' | 'attack' | 'damage' | 'heal' | 'destroy' | 'trap' | 'drink' | 'ability' | 'win' | 'tap';

export function sfx(kind: Sfx): void {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  switch (kind) {
    case 'tap':
      tone(c, t, 660, 880, 0.06, 'triangle', 0.08);
      break;
    case 'summon':
      tone(c, t, 160, 60, 0.25, 'sine', 0.35);
      tone(c, t + 0.05, 600, 1500, 0.3, 'triangle', 0.1);
      break;
    case 'attack':
      noise(c, t, 0.18, 0.18, 800);
      tone(c, t, 500, 120, 0.18, 'sawtooth', 0.12);
      break;
    case 'damage':
      noise(c, t, 0.25, 0.3, 120);
      tone(c, t, 140, 40, 0.3, 'square', 0.2);
      break;
    case 'heal':
      [523, 659, 784, 1047].forEach((f, i) => tone(c, t + i * 0.07, f, f * 1.01, 0.25, 'sine', 0.13));
      break;
    case 'destroy':
      noise(c, t, 0.45, 0.35, 60);
      tone(c, t, 300, 40, 0.4, 'sawtooth', 0.15);
      break;
    case 'trap':
      tone(c, t, 300, 900, 0.18, 'square', 0.12);
      tone(c, t + 0.18, 900, 300, 0.18, 'square', 0.12);
      noise(c, t + 0.3, 0.2, 0.15, 1500);
      break;
    case 'drink':
      [0, 0.08, 0.17].forEach((d) => tone(c, t + d, 400 + d * 900, 200, 0.12, 'sine', 0.14));
      break;
    case 'ability':
      tone(c, t, 440, 880, 0.2, 'triangle', 0.12);
      tone(c, t + 0.1, 660, 1320, 0.25, 'sine', 0.08);
      break;
    case 'win':
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(c, t + i * 0.12, f, f, 0.4, 'triangle', 0.14));
      break;
  }
}

export function buzz(ms: number): void {
  try {
    if (!muted) navigator.vibrate?.(ms);
  } catch {
    /* 非対応の端末 */
  }
}
