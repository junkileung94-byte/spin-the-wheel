// All audio is synthesised in WebAudio — no sample files, so nothing to license, nothing
// to 404, and no extra requests from an OBS Browser Source.
//
// Browsers block audio until a gesture, so the context is created lazily and resumed on the
// first click. The overlay never gets a gesture, so it runs muted by design — stream audio
// belongs to OBS, not to a hidden browser tab.

export function createSound() {
  let ctx = null;
  let master = null;
  let enabled = true;
  let volume = 0.6;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

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

  return {
    unlock: () => ensure(),
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
      blip({ freq: 1150 + Math.random() * 220, dur: 0.035, type: "square", gain: 0.11, sweep: -260 });
    },
    /** Wheel launch. */
    whoosh() {
      noise(0.85, 0.16, 2400, 260);
    },
    /** Winner. A rising arpeggio in the same key each time, so it reads as a stinger. */
    fanfare() {
      if (!enabled) return;
      const c = ensure();
      if (!c) return;
      [0, 90, 180, 300].forEach((ms, i) => {
        setTimeout(() => {
          blip({ freq: [523.25, 659.25, 783.99, 1046.5][i], dur: 0.42, type: "triangle", gain: 0.2 });
          blip({ freq: [523.25, 659.25, 783.99, 1046.5][i] * 2, dur: 0.3, type: "sine", gain: 0.08 });
        }, ms);
      });
      setTimeout(() => noise(1.1, 0.09, 5200, 900), 260); // the bubble fizz under it
    },
  };
}
