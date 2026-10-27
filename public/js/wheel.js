// Canvas wheel: renderer + spin animation.
//
// The geometry here is a deliberate mirror of server/spin.js — same conventions, same
// easing, same index derivation. The client never receives a winner; it works out who won
// by looking at where the pointer ended up, exactly as it would on a fair wheel.
//
//   0 rad = 3 o'clock, positive = clockwise
//   slice i occupies local [i*THETA, (i+1)*THETA)
//   localAngleUnderPointer = norm(pointerAngle - rot)

export const TAU = Math.PI * 2;

export const POINTER_ANGLE = {
  top: (3 * Math.PI) / 2,
  right: 0,
  bottom: Math.PI / 2,
  left: Math.PI,
};

export const norm = (a) => ((a % TAU) + TAU) % TAU;

export function indexAt(rot, count, pointerAngle) {
  if (count <= 0) return -1;
  return Math.floor(norm(pointerAngle - rot) / (TAU / count)) % count;
}

export function easeOut(p) {
  return 1 - Math.pow(1 - p, 5);
}

// Flip label colour on slice luminance so nothing ever goes grey-on-grey.
function inkFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.42 ? "#1a0b2e" : "#ffffff";
}

export function createWheel(canvas, opts = {}) {
  const ctx = canvas.getContext("2d");
  const logo = new Image();
  logo.src = opts.logo || "/assets/wheel.svg";

  let entries = [];
  let rot = 0;
  let pointer = "top";
  let dpr = 1;
  let size = 0;
  let raf = 0;
  let anim = null; // { from, to, startAt, durationMs, onTick, onDone }
  let lastIndex = -1;
  let flap = { v: 0, a: 0 }; // pointer deflection spring
  let glow = 0; // rim glow, pulses while spinning

  const nowFn = opts.now || (() => Date.now());

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || opts.size || 600;
    const cssH = canvas.clientHeight || cssW;
    size = Math.min(cssW, cssH);
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    render();
  }

  function drawSlices(cx, cy, r) {
    const n = entries.length;
    const theta = TAU / n;

    for (let i = 0; i < n; i++) {
      const a0 = rot + i * theta;
      const a1 = a0 + theta;
      const color = entries[i].color || "#ff2fd0";

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a0, a1);
      ctx.closePath();

      const g = ctx.createRadialGradient(cx, cy, r * 0.12, cx, cy, r);
      g.addColorStop(0, color);
      g.addColorStop(1, shade(color, -0.28));
      ctx.fillStyle = g;
      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = Math.max(1, r * 0.004);
      ctx.stroke();
    }

    // labels
    ctx.save();
    ctx.translate(cx, cy);
    const fontSize = Math.max(11, Math.min(r * 0.11, (r * 1.35 * theta) / 1.15, 34));
    ctx.font = `700 ${fontSize}px Quicksand, sans-serif`;
    ctx.textBaseline = "middle";
    const maxW = r * 0.68;

    for (let i = 0; i < n; i++) {
      const mid = rot + (i + 0.5) * theta;
      // labels on the left half would sit upside-down, so flip them and read outward-in
      const flip = norm(mid) > Math.PI / 2 && norm(mid) < (3 * Math.PI) / 2;
      ctx.save();
      ctx.rotate(flip ? mid + Math.PI : mid);
      ctx.fillStyle = inkFor(entries[i].color || "#ff2fd0");
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = fontSize * 0.35;
      ctx.textAlign = flip ? "left" : "right";
      ctx.fillText(fit(entries[i].label, maxW), flip ? -r * 0.9 : r * 0.9, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  function fit(text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 2 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
    return `${s}…`;
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.max(0, Math.min(255, Math.round(c + c * amt)));
    return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, "0")).join("")}`;
  }

  function drawRim(cx, cy, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.008, 0, TAU);
    ctx.lineWidth = r * 0.035;
    ctx.strokeStyle = "#ff2fd0";
    ctx.shadowColor = "#ff2fd0";
    ctx.shadowBlur = r * (0.09 + glow * 0.13);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.008, 0, TAU);
    ctx.lineWidth = r * 0.012;
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.shadowBlur = r * 0.05;
    ctx.stroke();
    ctx.restore();
  }

  function drawHub(cx, cy, r) {
    const hr = r * 0.17;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, hr, 0, TAU);
    ctx.fillStyle = "#120a2c";
    ctx.shadowColor = "rgba(255,47,208,0.7)";
    ctx.shadowBlur = r * 0.08;
    ctx.fill();
    ctx.lineWidth = r * 0.012;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.stroke();

    if (logo.complete && logo.naturalWidth) {
      const d = hr * 1.62;
      ctx.globalAlpha = 0.96;
      ctx.drawImage(logo, cx - d / 2, cy - d / 2, d, d);
    }
    ctx.restore();
  }

  function drawPointer(cx, cy, r) {
    const base = POINTER_ANGLE[pointer] ?? POINTER_ANGLE.top;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(base + flap.a);
    ctx.translate(r * 1.045, 0);
    ctx.rotate(Math.PI); // point back toward the hub

    const s = r * 0.11;
    ctx.beginPath();
    ctx.moveTo(s * 1.15, 0);
    ctx.lineTo(-s * 0.35, -s * 0.62);
    ctx.quadraticCurveTo(-s * 0.9, 0, -s * 0.35, s * 0.62);
    ctx.closePath();

    const g = ctx.createLinearGradient(-s, 0, s, 0);
    g.addColorStop(0, "#7b2ff7");
    g.addColorStop(1, "#ff62e0");
    ctx.fillStyle = g;
    ctx.shadowColor = "#ff2fd0";
    ctx.shadowBlur = r * 0.07;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.008);
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!entries.length) return;

    ctx.scale(dpr, dpr);
    const cw = w / dpr;
    const ch = h / dpr;
    const cx = cw / 2;
    const cy = ch / 2;
    const r = Math.min(cw, ch) / 2 - Math.min(cw, ch) * 0.075;

    drawSlices(cx, cy, r);
    drawRim(cx, cy, r);
    drawHub(cx, cy, r);
    drawPointer(cx, cy, r);
  }

  function tickPhysics(dt) {
    // pointer flap: spring back to centre, kicked on every peg it passes
    flap.v += -flap.a * 220 * dt;
    flap.v *= Math.exp(-9 * dt);
    flap.a += flap.v * dt;
    if (Math.abs(flap.a) < 0.0005 && Math.abs(flap.v) < 0.01) {
      flap.a = 0;
      flap.v = 0;
    }
  }

  function loop() {
    raf = 0;
    const t = nowFn();
    let alive = false;

    if (anim) {
      const p = Math.max(0, Math.min(1, (t - anim.startAt) / anim.durationMs));
      rot = anim.from + (anim.to - anim.from) * easeOut(p);
      glow = Math.min(1, glow + 0.05);
      alive = true;
      if (p >= 1) {
        rot = anim.to;
        const done = anim.onDone;
        anim = null;
        glow = 0;
        done?.(indexAt(rot, entries.length, POINTER_ANGLE[pointer] ?? POINTER_ANGLE.top));
      }
    } else if (glow > 0) {
      glow = Math.max(0, glow - 0.04);
      alive = glow > 0;
    }

    const idx = indexAt(rot, entries.length, POINTER_ANGLE[pointer] ?? POINTER_ANGLE.top);
    if (idx !== lastIndex) {
      if (lastIndex !== -1 && anim) {
        flap.v = -7.5; // kick the flap the way the pegs push it
        opts.onTick?.(idx);
      }
      lastIndex = idx;
    }

    const dt = 1 / 60;
    if (flap.a !== 0 || flap.v !== 0) {
      tickPhysics(dt);
      alive = true;
    }

    render();
    if (alive) raf = requestAnimationFrame(loop);
  }

  const kick = () => {
    if (!raf) raf = requestAnimationFrame(loop);
  };

  window.addEventListener("resize", resize);
  logo.addEventListener("load", render);
  queueMicrotask(resize);

  return {
    setEntries(list) {
      entries = list || [];
      lastIndex = -1;
      render();
    },
    setPointer(p) {
      pointer = p in POINTER_ANGLE ? p : "top";
      render();
    },
    setAngle(a) {
      if (anim) return;
      rot = a;
      render();
    },
    getAngle: () => rot,
    isSpinning: () => Boolean(anim),

    /**
     * Run a spin the server planned.
     * @param {object} s  { finalAngle, durationMs, startAt } — startAt is SERVER time
     * @param {number} fromAngle  resting angle the server spun from
     */
    run(s, fromAngle, onDone) {
      anim = {
        from: fromAngle,
        to: s.finalAngle,
        startAt: s.startAt,
        durationMs: s.durationMs,
        onDone,
      };
      // a late joiner (restarted OBS source) drops straight into the right frame
      lastIndex = -1;
      kick();
    },

    stop() {
      anim = null;
      glow = 0;
      render();
    },
    resize,
    render,
  };
}
