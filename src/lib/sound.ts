/**
 * The replay's soundtrack, synthesised.
 *
 * No audio files. Every cue is built from oscillators and a noise buffer at play time,
 * which keeps the bundle unchanged, needs no CDN and lets a cue be pitched by the thing
 * that caused it: a buy and a sell are the same tick a fifth apart, so a run of fills reads
 * as a melody going the right way.
 *
 * The synthesis is written against `BaseAudioContext`, not `AudioContext`, and that is the
 * whole point of the shape of this file. The same functions render into an
 * `OfflineAudioContext` to produce the exported clip's audio track, so a clip sounds
 * exactly like the replay it came from rather than being silent, which is what it was.
 */

export type Cue = "buy" | "sell" | "liquidation" | "profit" | "settle";

/* ------------------------------------------------------------- synthesis */

function noiseBuffer(c: BaseAudioContext): AudioBuffer {
  const len = Math.floor(c.sampleRate * 0.5);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) {
    // Decaying white noise, so one buffer serves both the thud and the wash.
    data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  }
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

function tone(c: BaseAudioContext, out: AudioNode, at: number, o: ToneOptions): void {
  const t = at + (o.delay ?? 0);
  const osc = c.createOscillator();
  const env = c.createGain();

  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.to && o.to !== o.freq) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.duration);

  const peak = o.gain ?? 0.5;
  // A 6ms attack rather than an instant one: a square wave started at full gain clicks.
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, t + o.duration);

  osc.connect(env);
  env.connect(out);
  osc.start(t);
  osc.stop(t + o.duration + 0.02);
}

function thud(c: BaseAudioContext, out: AudioNode, at: number): void {
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
  env.connect(out);
  src.start(at);
  src.stop(at + 0.5);
}

/** Schedule one cue at `at` seconds on the context's own clock. */
function schedule(c: BaseAudioContext, out: AudioNode, cue: Cue, at: number): void {
  switch (cue) {
    /** Buys sit a fifth above sells, so scaling into a position rises. */
    case "buy":
      tone(c, out, at, { freq: 880, to: 1180, type: "triangle", duration: 0.07, gain: 0.34 });
      break;
    /**
     * A till, because a sale is money arriving. It rings on every bar that sold. Two bright
     * notes, up, rather than the old descending blip, which
     * read as an error tone.
     */
    case "sell":
      tone(c, out, at, { freq: 1245, type: "triangle", duration: 0.06, gain: 0.3 });
      tone(c, out, at, { freq: 1865, type: "triangle", duration: 0.11, gain: 0.24, delay: 0.05 });
      break;
    /** A struck bell, not a fanfare. It fires often enough that a fanfare would grate. */
    case "profit":
      tone(c, out, at, { freq: 1046, type: "sine", duration: 0.16, gain: 0.3 });
      tone(c, out, at, { freq: 1568, type: "sine", duration: 0.22, gain: 0.16, delay: 0.05 });
      break;
    /** The only cue with weight. It should land like something being taken away. */
    case "liquidation":
      thud(c, out, at);
      tone(c, out, at, { freq: 180, to: 55, type: "sawtooth", duration: 0.55, gain: 0.4 });
      break;
    /** The end card: a plain fifth, resolving, so the clip has a full stop. */
    case "settle":
      tone(c, out, at, { freq: 392, type: "sine", duration: 0.5, gain: 0.26 });
      tone(c, out, at, { freq: 587, type: "sine", duration: 0.6, gain: 0.2, delay: 0.07 });
      break;
  }
}

/* --------------------------------------------------------- live playback */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/** Cues collapse when several land in a frame, so a burst of fills is one sound. */
let lastAt = 0;
const MIN_GAP_MS = 28;

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

/**
 * Play one cue now.
 *
 * Silent and harmless when muted, before any gesture, or on a browser with no Web Audio.
 * Nothing here throws, because a failed sound must never take the replay down with it.
 *
 * Watch is the gesture that opens the replay. The AudioContext has to be created and
 * resumed in that click; creating it later, after candles return, leaves it suspended
 * and the whole soundtrack is silent.
 */
export function unlock(): void {
  const c = ensure();
  if (!c) return;
  if (c.state === "suspended") void c.resume().catch(() => {});
}

export function play(cue: Cue, muted: boolean): void {
  if (muted) return;
  const c = ensure();
  if (!c || !master) return;

  const fire = () => {
    if (!master) return;
    const now = performance.now();
    if (cue !== "settle" && cue !== "liquidation" && now - lastAt < MIN_GAP_MS) return;
    lastAt = now;
    try {
      schedule(c, master, cue, c.currentTime);
    } catch {
      // A cue that cannot play is not worth reporting.
    }
  };

  if (c.state === "suspended") {
    void c.resume().then(fire).catch(() => {});
    return;
  }
  fire();
}

/* ------------------------------------------------------------- rendering */

export interface TimedCue {
  cue: Cue;
  /** Seconds from the start of the clip. */
  at: number;
}

/**
 * The whole soundtrack as one buffer, for muxing into an exported clip.
 *
 * Rendered offline rather than recorded, so it is sample-accurate regardless of what the
 * machine managed while encoding, and identical every time the same trade is exported.
 * Returns null wherever offline audio is unavailable; the caller then produces a silent
 * clip rather than no clip.
 */
export async function renderTrack(
  cues: TimedCue[],
  seconds: number,
): Promise<AudioBuffer | null> {
  if (typeof window === "undefined" || cues.length === 0) return null;
  const Ctor =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!Ctor) return null;

  try {
    const rate = 48_000;
    const c = new Ctor(2, Math.ceil(seconds * rate), rate);
    const master = c.createGain();
    master.gain.value = 0.28;

    /**
     * A limiter, because an export can stack cues in a way live playback never does.
     * Live, a burst collapses to one sound by the rate gate below; here every cue in the
     * trade is scheduled, and forty fills inside one second would clip hard without this.
     */
    const squash = c.createDynamicsCompressor();
    squash.threshold.setValueAtTime(-14, 0);
    squash.ratio.setValueAtTime(12, 0);
    squash.attack.setValueAtTime(0.003, 0);
    squash.release.setValueAtTime(0.18, 0);

    master.connect(squash);
    squash.connect(c.destination);

    let previous = -Infinity;
    for (const { cue, at } of cues) {
      if (at < 0 || at > seconds) continue;
      // The same collapse rule live playback uses, so a clip sounds like the replay did.
      if (cue !== "settle" && cue !== "liquidation" && at - previous < MIN_GAP_MS / 1000) {
        continue;
      }
      previous = at;
      schedule(c, master, cue, at);
    }

    return await c.startRendering();
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- muted-ness */

const KEY = "runback:muted";

/** Muted state, remembered per browser. */
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
