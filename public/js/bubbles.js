// Bubble explosion — the winner celebration.
//
// Confetti would be off-brand; the whole kit is underwater (mermaid, jellyfish), so the
// burst is bubbles: fired radially, then buoyancy takes over and they rise, wobbling on a
// sine, each with a specular highlight, and they pop rather than fade out.
//
// The loop stops itself the moment the pool empties. That matters for OBS: an idle overlay
// must cost the streaming PC nothing.

const COLORS = ["#ff2fd0", "#ff6fe0", "#f9c4f3", "#c04ff0", "#7b2ff7", "#4fd8ff", "#ffffff"];

export function createBubbles(canvas, { onPop } = {}) {
  const ctx = canvas.getContext("2d");
  let dpr = 1;
  let particles = [];
  let running = false;
  let last = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
  }
  resize();
  window.addEventListener("resize", resize);

  const rand = (a, b) => a + Math.random() * (b - a);

  function spawn(cx, cy, count) {
    for (let i = 0; i < count; i++) {
      const angle = rand(0, Math.PI * 2);
      // burst speed is biased sideways so the cloud reads as a splash, not a fountain
      const speed = rand(180, 760) * (0.6 + Math.abs(Math.cos(angle)) * 0.7);
      const r = rand(5, 26);
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - rand(40, 180),
        r,
        // big bubbles rise slower and wobble wider — Stokes-ish, close enough for the eye
        buoy: rand(90, 240) / (1 + r / 18),
        drag: rand(1.1, 2.0),
        wob: rand(0.6, 2.4),
        wobPhase: rand(0, Math.PI * 2),
        wobAmp: rand(8, 34) * (r / 16),
        color: COLORS[(Math.random() * COLORS.length) | 0],
        life: 0,
        ttl: rand(1.8, 3.6),
        pop: 0,
      });
    }
    start();
  }

  function draw(p) {
    const x = p.x * dpr;
    const y = p.y * dpr;
    const r = p.r * dpr * (1 + p.pop * 0.6);
    const fade = p.pop > 0 ? 1 - p.pop : Math.min(1, p.life * 4);

    ctx.globalAlpha = 0.55 * fade;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.85)");
    g.addColorStop(0.45, p.color);
    g.addColorStop(1, "rgba(255,255,255,0.05)");
    ctx.fillStyle = g;
    ctx.fill();

    // rim + specular highlight: what actually makes it read as "bubble"
    ctx.globalAlpha = 0.8 * fade;
    ctx.lineWidth = Math.max(1, r * 0.09);
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.stroke();

    ctx.globalAlpha = 0.9 * fade;
    ctx.beginPath();
    ctx.arc(x - r * 0.34, y - r * 0.38, Math.max(1, r * 0.17), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fill();
  }

  function frame(ts) {
    if (!running) return;
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;

      if (p.pop > 0) {
        p.pop += dt * 5;
        if (p.pop >= 1) {
          particles.splice(i, 1);
          continue;
        }
      } else if (p.life > p.ttl || p.y < -60) {
        p.pop = 0.001; // start popping
        onPop?.(p.r);
      }

      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy = (p.vy + p.buoy * dt * -1.6) * k - p.buoy * dt * 0.4;

      p.wobPhase += p.wob * dt * Math.PI;
      p.x += (p.vx + Math.cos(p.wobPhase) * p.wobAmp) * dt;
      p.y += p.vy * dt;

      draw(p);
    }

    ctx.globalAlpha = 1;
    if (!particles.length) {
      running = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  return {
    /** Burst from a point (CSS pixels). Defaults to the middle of the screen. */
    burst(x = canvas.clientWidth / 2, y = canvas.clientHeight / 2, count = 90) {
      resize();
      spawn(x, y, count);
    },
    /** The winner celebration: a wide burst plus two offset ones for depth. */
    celebrate(count = 170) {
      resize();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      spawn(w / 2, h * 0.62, Math.round(count * 0.5));
      setTimeout(() => spawn(w * 0.22, h * 0.78, Math.round(count * 0.25)), 120);
      setTimeout(() => spawn(w * 0.78, h * 0.78, Math.round(count * 0.25)), 220);
    },
    clear() {
      particles = [];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
    resize,
  };
}
