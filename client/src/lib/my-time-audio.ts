// Sound for My Time, made in the browser so there is nothing to download: chime notes, and a few
// soft backgrounds (rain, lapping water, sea, breeze) shaped from filtered noise.

export type AmbienceKind = "rain" | "lake" | "sea" | "breeze";

type Shape = { low?: number; high?: number; band?: number; level: number; swell?: { every: number; depth: number } };
const shapes: Record<AmbienceKind, Shape> = {
  rain: { low: 6500, high: 900, level: 0.11 },
  lake: { low: 480, level: 0.2, swell: { every: 5.5, depth: 0.55 } },
  sea: { low: 760, level: 0.24, swell: { every: 9, depth: 0.8 } },
  breeze: { band: 520, level: 0.16, swell: { every: 7, depth: 0.6 } },
};

let shared: AudioContext | null = null;

/** One audio context for the page, created on the first tap (browsers require a gesture). */
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return null;
    shared = shared ?? new Context();
    if (shared.state === "suspended") void shared.resume();
    return shared;
  } catch { return null; }
}

/** The seven chimes, low to high: a pentatonic scale, so any two notes sit well together. */
export const CHIME_NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66];

/** Rings one chime. Quietly does nothing where sound is not available. */
export function ringChime(frequency: number, loudness = 1) {
  const context = audio();
  if (!context) return;
  const start = context.currentTime;
  // A bell is a fundamental plus a couple of faint, faster-fading overtones.
  const partials: [number, number, number][] = [[1, 0.2, 2.6], [2.76, 0.05, 1.2], [5.4, 0.02, 0.6]];
  partials.forEach(([ratio, level, seconds]) => {
    const tone = context.createOscillator();
    const gain = context.createGain();
    tone.type = "sine";
    tone.frequency.value = frequency * ratio;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level * loudness), start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
    tone.connect(gain);
    gain.connect(context.destination);
    tone.start(start);
    tone.stop(start + seconds + 0.05);
  });
}

/** Starts a soft background and returns the function that fades it out. */
export function startAmbience(kind: AmbienceKind): () => void {
  const context = audio();
  if (!context) return () => {};
  const shape = shapes[kind];
  const seconds = 3;
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const samples = buffer.getChannelData(0);
  // Brown-ish noise: each sample leans on the last, which takes the hiss out.
  let last = 0;
  for (let i = 0; i < samples.length; i++) {
    last = (last + (Math.random() * 2 - 1) * 0.08) / 1.02;
    samples[i] = last * 3.2;
  }
  // The buffer loops, so its end is eased back to where it began; otherwise each loop would tick.
  const drift = samples[samples.length - 1] - samples[0];
  for (let i = 0; i < samples.length; i++) {
    samples[i] += -drift * (i / (samples.length - 1)) + (Math.random() * 2 - 1) * (kind === "rain" ? 0.5 : 0.04);
  }
  const noise = context.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;

  let node: AudioNode = noise;
  const through = (type: BiquadFilterType, frequency: number, q = 0.7) => {
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    node.connect(filter);
    node = filter;
  };
  if (shape.high) through("highpass", shape.high);
  if (shape.low) through("lowpass", shape.low);
  if (shape.band) through("bandpass", shape.band, 0.6);

  const swell = context.createGain();
  swell.gain.value = 1;
  node.connect(swell);
  let wave: OscillatorNode | null = null;
  if (shape.swell) {
    // A very slow wave on the volume gives water its coming and going.
    wave = context.createOscillator();
    const depth = context.createGain();
    wave.frequency.value = 1 / shape.swell.every;
    depth.gain.value = shape.swell.depth / 2;
    swell.gain.value = 1 - shape.swell.depth / 2;
    wave.connect(depth);
    depth.connect(swell.gain);
    wave.start();
  }
  const master = context.createGain();
  const now = context.currentTime;
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(shape.level, now + 1.2);
  swell.connect(master);
  master.connect(context.destination);
  noise.start();

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const end = context.currentTime;
    try {
      master.gain.cancelScheduledValues(end);
      master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), end);
      master.gain.exponentialRampToValueAtTime(0.0001, end + 0.6);
      noise.stop(end + 0.7);
      wave?.stop(end + 0.7);
    } catch { /* already stopped */ }
  };
}
