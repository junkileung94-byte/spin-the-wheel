// Wheel sounds.
//
// Recorded effects live in /sounds (generated with Higgsfield, see /sounds/CREDITS.md): a
// launch whoosh, a peg tick, a winner chime, bubble pops and a bubble burst. They load in
// the background; until they arrive, or if one fails, a WebAudio synth stands in, so a
// missing file never means silence or an error.
//
// Browsers block audio until a gesture, so the context is created lazily and resumed on the
// first click. OBS browser sources may play audio without a gesture.

const SAMPLES = {
  spin: ["spin"],
  tick: ["tick", "tick2"],
  win: ["win"],
  pop: ["pop1", "pop2", "pop3", "pop4"],
  bubbles: ["bubbles"],
};

export function createSound({ base = "/sounds/" } = {}) {
  let ctx = null;
  let master = null;
  let enabled = true;
  let volume = 0.6;
  let loading = null;
  const buffers = {}; // file name -> AudioBuffer
  let lastPop = 0;
  let livePops = 0;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
      load();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  function load() {
    if (loading) return loading;
    const names = [...new Set(Object.values(SAMPLES).flat())];
    loading = Promise.all(
      names.map(async (name) => {
        try {
          const res = await fetch(`${base}${name}.wav`);
          if (!res.ok) return;
          const data = await res.arrayBuffer();
          buffers[name] = await new Promise((resolve, reject) => ctx.decodeAudioData(data, resolve, reject));
        } catch {
          /* synth fallback covers it */
        }
      }),
    );
    return loading;
  }

  /** Play one recorded sample from the group; false if none is loaded yet. */
  function sample(group, { gain = 1, rate = 1, onEnd } = {}) {
    if (!enabled) return true;
    const c = ensure();
    if (!c) return true;
    const ready = SAMPLES[group].filter((n) => buffers[n]);
    if (!ready.length) return false;
    const src = c.createBufferSource();
    src.buffer = buffers[ready[(Math.random() * ready.length) | 0]];
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(g).connect(master);
    if (onEnd) src.onended = onEnd;
    src.start();
    return true;
  }

  // ── synth fallback ────────────────────────────────────────────────────

  function blip({ freq = 880, dur = 0.045, type = "triangle", gain = 0.22, sweep = 0 }) {
    if (!enabled) return;
    const c = ensure();
    if (!c) return;
    const t = c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise(dur = 0.5, gain = 0.12, filterFrom = 1800, filterTo = 300) {
    if (!enabled) return;
    const c = ensure();
    if (!c) return;
    const t = c.currentTime;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.setValueAtTime(filterFrom, t);
    filt.frequency.exponentialRampToValueAtTime(filterTo, t + dur);
    filt.Q.value = 1.2;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(filt).connect(g).connect(master);
    src.start(t);
  }

  function synthFanfare() {
    [0, 90, 180, 300].forEach((ms, i) => {
      setTimeout(() => {
        blip({ freq: [523.25, 659.25, 783.99, 1046.5][i], dur: 0.42, type: "triangle", gain: 0.2 });
        blip({ freq: [523.25, 659.25, 783.99, 1046.5][i] * 2, dur: 0.3, type: "sine", gain: 0.08 });
      }, ms);
    });
  }

  return {
    /** Create/resume the audio context and start loading the recorded sounds. */
    unlock: () => ensure(),
    /** Resolves once every recorded sound has loaded (or failed over to the synth). */
    ready: () => (ensure() ? load() : Promise.resolve()),
    set enabled(v) {
      enabled = Boolean(v);
    },
    get enabled() {
      return enabled;
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
      if (master) master.gain.value = volume;
    },
    /** One peg passing the flap. Pitch drifts a little so a long spin never sounds looped. */
    tick() {
      if (sample("tick", { gain: 0.55, rate: 0.94 + Math.random() * 0.14 })) return;
      blip({ freq: 1150 + Math.random() * 220, dur: 0.035, type: "square", gain: 0.11, sweep: -260 });
    },
    /** Wheel launch. */
    whoosh() {
      if (sample("spin", { gain: 0.9 })) return;
      noise(0.85, 0.16, 2400, 260);
    },
    /** Winner: chime, with the bubble burst under it. */
    fanfare() {
      if (!enabled) return;
      if (!sample("win", { gain: 0.9 })) synthFanfare();
      if (!sample("bubbles", { gain: 0.55 })) setTimeout(() => noise(1.1, 0.09, 5200, 900), 260);
    },
    /**
     * A single bubble popping. Called for every bubble in a burst, so it is rate-limited and
     * capped: a 170-bubble celebration becomes a pleasant patter, not a wall of noise.
     * Bigger bubbles pop lower.
     */
    pop(radius = 14) {
      if (!enabled || !ctx) return;
      const now = performance.now();
      if (now - lastPop < 45 || livePops >= 4) return;
      lastPop = now;
      const rate = Math.max(0.7, Math.min(1.5, 1.35 - radius / 50)) * (0.95 + Math.random() * 0.1);
      livePops++;
      const played = sample("pop", { gain: 0.25 + Math.random() * 0.2, rate, onEnd: () => livePops-- });
      if (!played) {
        livePops--;
        blip({ freq: 700 + Math.random() * 500, dur: 0.05, type: "sine", gain: 0.06, sweep: 600 });
      }
    },
  };
}
