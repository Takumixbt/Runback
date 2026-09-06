/**
 * The replay's soundtrack, synthesised.
 *
 * No audio files. Every cue is built from oscillators and a noise buffer at play time,
 * which keeps the bundle unchanged, needs no CDN and lets a cue be pitched by the thing
 * that caused it: a buy ping sits above a sell ping, so a run of fills reads as a melody
 * going the right way.
 *
 * The synthesis is written against `BaseAudioContext`, not `AudioContext`, and that is the
 * whole point of the shape of this file. The same functions render into an
 * `OfflineAudioContext` to produce the exported clip's audio track, so a clip sounds
 * exactly like the replay it came from rather than being silent, which is what it was.
 */

export type Cue = "buy" | "sell" | "liquidation" | "profit" | "settle";

/**
 * How far ahead of `AudioContext.currentTime` a live cue is placed.
 *
 * Automation scheduled at `currentTime` is already in the past by the time the audio
 * thread consumes it, so the envelope never leaves its near-silent start value and the
 * arrow appears with no ping. A short lookahead is what makes a tick actually sound.
 */
export const LOOKAHEAD = 0.03;

/**
 * Minimum space between live cues on the audio clock.
 *
 * A skipped-frame walk used to fire every pending ping in one call and then DROP the
 * ones that landed inside 28ms, so three sell arrows could draw and only the first
 * would ring. Spacing them on the clock keeps every arrow audible.
 */
export const SPACING = 0.034;

/** Next live cue time: never in the past, never stacked on the previous tick. */
export function nextCueTime(now: number, lastAt: number): number {
  return Math.max(now + LOOKAHEAD, lastAt + SPACING);
}

/* ------------------------------------------------------------- synthesis */

const noiseByCtx = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseBuffer(c: BaseAudioContext): AudioBuffer {
  const hit = noiseByCtx.get(c);
  if (hit) return hit;
  const len = Math.floor(c.sampleRate * 0.5);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) {
    // Decaying white noise, so one buffer serves both the thud and the tick.
    data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  }
  noiseByCtx.set(c, buf);
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
  if (o.to && o.to !== o.freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + o.duration);
  }

  const peak = o.gain ?? 0.5;
  // A short attack rather than an instant one: a square wave started at full gain clicks
  // in a way that reads as a glitch, not as a tick. 0.001 not 0: exponential ramps
  // refuse a zero.
  env.gain.setValueAtTime(0.001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  env.gain.exponentialRampToValueAtTime(0.001, t + o.duration);

  osc.connect(env);
  env.connect(out);
  osc.start(t);
  osc.stop(t + o.duration + 0.03);
}

/** A few milliseconds of bright noise, so a ping cuts through instead of blooming. */
function tick(c: BaseAudioContext, out: AudioNode, at: number, gain: number): void {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);

  const filter = c.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.setValueAtTime(2200, at);

  const env = c.createGain();
  env.gain.setValueAtTime(gain, at);
  env.gain.exponentialRampToValueAtTime(0.001, at + 0.028);

  src.connect(filter);
  filter.connect(env);
  env.connect(out);
  src.start(at);
  src.stop(at + 0.04);
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
  env.gain.exponentialRampToValueAtTime(0.001, at + 0.45);

  src.connect(filter);
  filter.connect(env);
  env.connect(out);
  src.start(at);
  src.stop(at + 0.5);
}

/** Schedule one cue at `at` seconds on the context's own clock. */
function schedule(c: BaseAudioContext, out: AudioNode, cue: Cue, at: number): void {
  switch (cue) {
    /** Buys sit above sells, a short rising ping on the arrow. */
    case "buy":
      tick(c, out, at, 0.18);
      tone(c, out, at, { freq: 1320, to: 1760, type: "triangle", duration: 0.09, gain: 0.42 });
      break;
    /**
     * Same family as the buy ping, a fifth down and no sweep — a descending blip
     * read as an error tone, and a cash-register till did not read as an arrow.
     */
    case "sell":
      tick(c, out, at, 0.16);
      tone(c, out, at, { freq: 880, type: "triangle", duration: 0.1, gain: 0.4 });
      break;
    /** A struck bell, not a fanfare. It fires often enough that a fanfare would grate. */
    case "profit":
      tone(c, out, at, { freq: 1046, type: "sine", duration: 0.16, gain: 0.32 });
      tone(c, out, at, { freq: 1568, type: "sine", duration: 0.22, gain: 0.18, delay: 0.05 });
      break;
    /** The only cue with weight. It should land like something being taken away. */
    case "liquidation":
      thud(c, out, at);
      tone(c, out, at, { freq: 180, to: 55, type: "sawtooth", duration: 0.55, gain: 0.4 });
      break;
    /** The end card: a plain fifth, resolving, so the clip has a full stop. */
    case "settle":
      tone(c, out, at, { freq: 392, type: "sine", duration: 0.5, gain: 0.28 });
      tone(c, out, at, { freq: 587, type: "sine", duration: 0.6, gain: 0.22, delay: 0.07 });
      break;
  }
}

/* --------------------------------------------------------- live playback */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let armed = false;
/** Audio-clock time the last live cue was placed, for spacing. */
let lastAt = Number.NEGATIVE_INFINITY;

function ctor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

function running(c: AudioContext): boolean {
  return c.state === "running";
}

/**
 * A near-silent tone that holds the graph open.
 *
 * After a stretch of quiet bars some browsers suspend the context, and the next
 * `resume()` from a React effect is not a user gesture — so the next arrow draws
 * and the ping is dropped. The bed is inaudible; it exists so the context stays up.
 */
function bed(c: AudioContext, dest: AudioNode): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.frequency.value = 40;
  g.gain.value = 0.00002;
  osc.connect(g);
  g.connect(dest);
  osc.start();
}

function arm(): void {
  if (armed || typeof window === "undefined") return;
  armed = true;
  const go = () => unlock();
  window.addEventListener("pointerdown", go);
  window.addEventListener("keydown", go);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) unlock();
  });
}

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  arm();
  if (ctx) return ctx;
  const Ctor = ctor();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.34;
    master.connect(ctx.destination);
    bed(ctx, master);
  } catch {
    ctx = null;
    master = null;
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
 * and the whole soundtrack is silent. `unlock` is also wired to pointer and key events
 * so a context that slept during a quiet stretch comes back on the next interaction.
 */
export function unlock(): void {
  const c = ensure();
  if (!c) return;
  if (!running(c)) void c.resume().catch(() => {});
}

export function play(cue: Cue, muted: boolean): void {
  if (muted) return;
  const c = ensure();
  if (!c || !master) return;

  const fire = () => {
    if (!master || !ctx) return;
    try {
      const at = nextCueTime(c.currentTime, lastAt);
      lastAt = at;
      schedule(c, master, cue, at);
    } catch {
      // A cue that cannot play is not worth reporting.
    }
  };

  if (!running(c)) {
    void c
      .resume()
      .then(() => {
        if (running(c)) fire();
      })
      .catch(() => {});
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
 * Returns null wherever offline audio is unavailable. The caller must refuse the
 * export rather than mux a silent file — a clip that looks like the replay and
 * sounds like nothing is how this used to ship.
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
    master.gain.value = 0.34;

    /**
     * A limiter, because an export can stack cues in a way live playback never does.
     * Live, a catch-up burst is spaced on the clock; here every cue sits on its bar,
     * and forty fills inside one second would clip hard without this.
     */
    const squash = c.createDynamicsCompressor();
    squash.threshold.setValueAtTime(-14, 0);
    squash.ratio.setValueAtTime(12, 0);
    squash.attack.setValueAtTime(0.003, 0);
    squash.release.setValueAtTime(0.18, 0);

    master.connect(squash);
    squash.connect(c.destination);

    for (const { cue, at } of cues) {
      if (at < 0 || at > seconds) continue;
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
