/**
 * Signature chimes made with the Web Audio API (no audio files to load).
 * Browsers only allow sound after the user has interacted with the page, so `unlockAudio()`
 * is called on the first tap/click/key press.
 */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  return ctx;
}

export function unlockAudio() {
  const a = audio();
  if (a && a.state === "suspended") void a.resume();
}

/** One soft bell note: a sine with a quiet octave + fifth overtone and a long exponential tail. */
function bell(a: AudioContext, out: AudioNode, freq: number, at: number, length = 1.6, gain = 0.32) {
  for (const [mult, g] of [[1, 1], [2, 0.28], [3, 0.08]] as const) {
    const osc = a.createOscillator();
    const env = a.createGain();
    osc.type = "sine";
    osc.frequency.value = freq * mult;
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain * g, at + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, at + length / mult);
    osc.connect(env).connect(out);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }
}

const N = { G4: 392, C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5 };

export type ChimeKind = "break" | "shift_end";

/** break: calm descending "tea-time" bell · shift_end: bright rising fanfare. */
export function playChime(kind: ChimeKind, volume = 0.9) {
  const a = audio();
  if (!a) return;
  if (a.state === "suspended") void a.resume();
  const master = a.createGain();
  master.gain.value = volume;
  master.connect(a.destination);
  const t = a.currentTime + 0.05;
  const notes: [number, number][] =
    kind === "break"
      ? [[N.E6, 0], [N.C6, 0.32], [N.A5, 0.64], [N.E5, 0.96]]
      : [[N.G4, 0], [N.C5, 0.14], [N.E5, 0.28], [N.G5, 0.42], [N.C6, 0.62], [N.E6, 0.62]];
  for (const [f, d] of notes) bell(a, master, f, t + d, kind === "break" ? 1.8 : 2.2);
}
