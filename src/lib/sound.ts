/**
 * The replay's soundtrack, synthesised.
 *
 * No audio files. Every cue is built from oscillators and a noise buffer at play time,
 * which keeps the bundle unchanged, needs no CDN (the CSP would refuse one anyway) and
 * lets a cue be pitched by the thing that caused it: a buy and a sell are the same tick a
 * fifth apart, so a run of fills reads as a melody going the right way.
 *
 * `AudioContext` cannot start before a gesture, so nothing here is constructed until the
 * first cue fires, and the first cue only fires from a click.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

/** Cues collapse when several land in a frame, so a burst of fills is one sound. */
let lastAt = 0;
const MIN_GAP_MS = 28;

export type Cue = "buy" | "sell" | "liquidation" | "profit" | "settle";

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
  } catch {
    return null;
  }
  return ctx;
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noise) return noise;
  const len = Math.floor(c.sampleRate * 0.5);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) {
    // Decaying white noise, so one buffer serves both the thud and the wash.
    data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  }
  noise = buf;
  return buf;
}

interface ToneOptions {
  freq: number;
  /** Frequency at the end of the tone, for a sweep. Defaults to `freq`. */
  to?: number;
  type?: OscillatorType;
  duration: number;
  gain?: number;
  delay?: number;
}

function tone(c: AudioContext, o: ToneOptions): void {
  const at = c.currentTime + (o.delay ?? 0);
  const osc = c.createOscillator();
  const env = c.createGain();

  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq, at);
  if (o.to && o.to !== o.freq) osc.frequency.exponentialRampToValueAtTime(o.to, at + o.duration);

  const peak = o.gain ?? 0.5;
  // A 6ms attack rather than an instant one: a square wave started at full gain clicks.
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(peak, at + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, at + o.duration);

  osc.connect(env);
  env.connect(master!);
  osc.start(at);
  osc.stop(at + o.duration + 0.02);
}

function thud(c: AudioContext): void {
  const at = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);

  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1400, at);
  filter.frequency.exponentialRampToValueAtTime(120, at + 0.4);

  const env = c.createGain();
  env.gain.setValueAtTime(0.9, at);
  env.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);

  src.connect(filter);
  filter.connect(env);
  env.connect(master!);
  src.start(at);
  src.stop(at + 0.5);
}

/**
 * Play one cue.
 *
 * Silent and harmless when muted, before any gesture, or on a browser with no Web Audio.
 * Nothing here throws, because a failed sound must never take the replay down with it.
 */
export function play(cue: Cue, muted: boolean): void {
  if (muted) return;
  const c = ensure();
  if (!c || !master) return;
  if (c.state === "suspended") void c.resume().catch(() => {});

  const now = performance.now();
  if (cue !== "settle" && cue !== "liquidation" && now - lastAt < MIN_GAP_MS) return;
  lastAt = now;

  try {
    switch (cue) {
      /** Buys sit a fifth above sells, so scaling into a position rises. */
      case "buy":
        tone(c, { freq: 880, to: 1180, type: "triangle", duration: 0.07, gain: 0.34 });
        break;
      case "sell":
        tone(c, { freq: 587, to: 440, type: "triangle", duration: 0.08, gain: 0.34 });
        break;
      /** A struck bell, not a fanfare. It fires often enough that a fanfare would grate. */
      case "profit":
        tone(c, { freq: 1046, type: "sine", duration: 0.16, gain: 0.3 });
        tone(c, { freq: 1568, type: "sine", duration: 0.22, gain: 0.16, delay: 0.05 });
        break;
      /** The only cue with weight to it. It should land like something being taken away. */
      case "liquidation":
        thud(c);
        tone(c, { freq: 180, to: 55, type: "sawtooth", duration: 0.55, gain: 0.4 });
        break;
      /** The end card: a plain fifth, resolving, so the clip has a full stop. */
      case "settle":
        tone(c, { freq: 392, type: "sine", duration: 0.5, gain: 0.26 });
        tone(c, { freq: 587, type: "sine", duration: 0.6, gain: 0.2, delay: 0.07 });
        break;
    }
  } catch {
    // A cue that cannot play is not worth reporting.
  }
}

const KEY = "runback:muted";

/** Muted state, remembered per browser. Defaults to ON, because the sound is the point. */
export function readMuted(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(KEY, muted ? "1" : "0");
  } catch {
    // Private windows and blocked site data. The preference simply does not persist.
  }
}
