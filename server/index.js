// Spin the Wheel: spin wheel + OBS overlay.
//
// One process, one port: HTTP for the three pages, WebSocket (/ws) for live state.
// The server is the only place that knows who is going to win.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { COOKIE, createAuth, parseCookies } from "./auth.js";
import { createBus } from "./bus.js";
import { createRig } from "./rig.js";
import { indexAt, norm, planSpin, POINTER_ANGLE, TAU } from "./spin.js";
import { flush, store } from "./store.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");

// ---------------------------------------------------------------- config

const PORT = Number(process.env.PORT || 21030);
const BIND = process.env.BIND || "127.0.0.1";
const SPIN_LEAD_MS = Number(process.env.SPIN_LEAD_MS || 250);

// Secrets survive restarts so OBS never needs its Browser Source URL re-pasted.
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const secretsPath = path.join(DATA_DIR, "secrets.json");
let secrets = {};
try {
  secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
} catch {
  secrets = {};
}
const need = (envName, key) => {
  if (process.env[envName]) return process.env[envName];
  if (!secrets[key]) {
    secrets[key] = crypto.randomBytes(12).toString("base64url");
    fs.mkdirSync(path.dirname(secretsPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(secretsPath, JSON.stringify(secrets, null, 2), { mode: 0o600 });
    console.log(`[auth] generated ${envName}; stored in the private data directory`);
  }
  return secrets[key];
};
const auth = createAuth({
  controlToken: need("CONTROL_TOKEN", "controlToken"),
  overlayKey: need("OVERLAY_KEY", "overlayKey"),
});

// ---------------------------------------------------------------- state

const PALETTE = [
  "#ff2fd0",
  "#7b2ff7",
  "#ff6fe0",
  "#3b2f8f",
  "#c04ff0",
  "#ff9ae8",
  "#4a2a7a",
  "#e11fa8",
];

const DEFAULT_SETTINGS = {
  turnsMin: 5,
  turnsMax: 9,
  durationMin: 5600,
  durationMax: 8400,
  pointer: "top",
  removeWinner: false,
  sound: true,
  tick: true,
  volume: 0.6,
  autohideSec: 7,
  confetti: true,
};

const newId = () => crypto.randomBytes(6).toString("hex");

function makeEntry(label, i) {
  return { id: newId(), label: String(label).slice(0, 80), color: PALETTE[i % PALETTE.length] };
}

const DEFAULT_ENTRIES = [
  "Chat picks the game",
  "Host picks the game",
  "Horror hour",
  "Just chatting",
  "Karaoke",
  "Viewer 1v1",
  "Speedrun attempt",
  "Mystery box",
].map(makeEntry);

const persisted = store.loadState();
const state = {
  title: persisted?.title ?? "Spin the Wheel",
  entries: persisted?.entries?.length ? persisted.entries : DEFAULT_ENTRIES,
  settings: { ...DEFAULT_SETTINGS, ...(persisted?.settings || {}) },
  angle: persisted?.angle ?? 0,
  overlay: persisted?.overlay ?? { visible: true, showTitle: true },
  spin: null, // live spin, public-safe fields only
};

let wheels = store.loadWheels();
let history = store.loadHistory();
const rig = createRig(store.loadRig());

// Entries are frozen for the duration of a spin so the wheel a viewer sees is the wheel
// the winner was drawn from.
let inflight = null; // { spinId, entries, index, rigged, reason, endsAt, timer }

const persist = () => {
  store.saveState({
    title: state.title,
    entries: state.entries,
    settings: state.settings,
    angle: state.angle,
    overlay: state.overlay,
  });
};

// ---------------------------------------------------------------- snapshots

function snapshotFor(role) {
  const base = {
    title: state.title,
    entries: state.entries,
    settings: state.settings,
    angle: state.angle,
    overlay: state.overlay,
    spinning: Boolean(inflight),
    // Mid-spin joiners (an OBS source that restarted) get the live spin and catch up.
    spin: state.spin,
    // saved wheels are not secret — the main page manages them too
    wheels: Object.entries(wheels).map(([id, w]) => ({ id, name: w.name, count: w.entries.length })),
    history: history.slice(0, 30).map((h) => ({ ts: h.ts, label: h.label })),
  };
  if (role !== "control") return base;
  return {
    ...base,
    history: history.slice(0, 60),
    rig: rig.get(),
    armed: rig.isArmed(),
    overlayKey: auth.overlayKey,
    clients: bus.counts(),
  };
}

const pushState = () => bus.broadcastByRole((role) => ({ t: "state", state: snapshotFor(role) }));

// ---------------------------------------------------------------- spin

function doSpin() {
  if (inflight) return;
  if (state.entries.length < 2) return;

  const pick = rig.pick(state.entries);
  if (!pick) return;
  store.saveRig(rig.get()); // queue/next were consumed — survive a restart mid-stream

  const nearMiss = Math.random() * 100 < (rig.get().nearMissPct || 0);
  const plan = planSpin({
    index: pick.index,
    count: state.entries.length,
    fromAngle: state.angle,
    settings: state.settings,
    nearMiss,
  });

  const spinId = newId();
  const startAt = Date.now() + SPIN_LEAD_MS;

  // Exactly these fields, every time. No winner, no rig, no reason.
  state.spin = {
    spinId,
    finalAngle: plan.finalAngle,
    durationMs: plan.durationMs,
    turns: plan.turns,
    pointer: plan.pointer,
    startAt,
    count: state.entries.length,
  };

  inflight = {
    spinId,
    entries: state.entries.slice(),
    index: pick.index,
    rigged: pick.rigged,
    reason: pick.reason,
    endsAt: startAt + plan.durationMs,
  };

  bus.broadcast({ t: "spin", ...state.spin });
  pushState();

  inflight.timer = setTimeout(settle, startAt + plan.durationMs - Date.now() + 60);
}

function settle() {
  if (!inflight) return;
  const { entries, spinId, rigged, reason } = inflight;

  // Recompute from the angle rather than trusting the plan: this is the same derivation
  // every client does, so if they ever disagreed we would see it here first.
  const finalAngle = state.spin.finalAngle;
  const index = indexAt(finalAngle, entries.length, POINTER_ANGLE[state.settings.pointer]);
  const winner = entries[index] ?? entries[inflight.index];

  state.angle = norm(finalAngle);
  state.spin = null;
  inflight = null;

  history.unshift({ ts: Date.now(), label: winner.label, id: winner.id, rigged, reason });
  history = history.slice(0, 200);
  store.saveHistory(history);

  bus.broadcast({ t: "settled", spinId, index, label: winner.label });

  if (state.settings.removeWinner) {
    state.entries = state.entries.filter((e) => e.id !== winner.id);
  }
  persist();
  pushState();
}

// ---------------------------------------------------------------- commands

function sanitizeEntries(list) {
  if (!Array.isArray(list)) return null;
  const out = list
    .slice(0, 500)
    .map((e, i) => {
      const label = String(e?.label ?? e ?? "").trim().slice(0, 80);
      if (!label) return null;
      return {
        id: typeof e?.id === "string" && e.id.length <= 32 ? e.id : newId(),
        label,
        color: /^#[0-9a-f]{6}$/i.test(e?.color || "") ? e.color : PALETTE[i % PALETTE.length],
      };
    })
    .filter(Boolean);
  return out;
}

const CONTROL_ONLY = new Set(["rig:set", "rig:clear", "overlay:set", "overlay:test", "history:clear"]);

function onMessage(msg, role, ws) {
  if (role === "overlay") return; // the overlay is a display, never an input
  if (CONTROL_ONLY.has(msg.t) && role !== "control") return;

  switch (msg.t) {
    case "spin":
      doSpin();
      break;

    case "entries:set": {
      if (inflight) {
        bus.send(ws, { t: "toast", kind: "warn", text: "Wheel is spinning — edit rejected." });
        return;
      }
      const entries = sanitizeEntries(msg.entries);
      if (!entries) return;
      state.entries = entries;
      persist();
      pushState();
      break;
    }

    case "title:set":
      state.title = String(msg.title || "").slice(0, 60);
      persist();
      pushState();
      break;

    case "settings:set": {
      const s = { ...state.settings };
      const n = (v, lo, hi, d) => {
        const x = Number(v);
        return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d;
      };
      if (msg.settings.turnsMin !== undefined) s.turnsMin = n(msg.settings.turnsMin, 1, 20, s.turnsMin);
      if (msg.settings.turnsMax !== undefined) s.turnsMax = n(msg.settings.turnsMax, 1, 20, s.turnsMax);
      if (msg.settings.durationMin !== undefined)
        s.durationMin = n(msg.settings.durationMin, 1000, 60000, s.durationMin);
      if (msg.settings.durationMax !== undefined)
        s.durationMax = n(msg.settings.durationMax, 1000, 60000, s.durationMax);
      if (msg.settings.autohideSec !== undefined) s.autohideSec = n(msg.settings.autohideSec, 0, 120, s.autohideSec);
      if (msg.settings.volume !== undefined) s.volume = n(msg.settings.volume, 0, 1, s.volume);
      if (msg.settings.pointer !== undefined && POINTER_ANGLE[msg.settings.pointer] !== undefined)
        s.pointer = msg.settings.pointer;
      for (const k of ["removeWinner", "sound", "tick", "confetti"]) {
        if (msg.settings[k] !== undefined) s[k] = Boolean(msg.settings[k]);
      }
      if (s.turnsMax < s.turnsMin) s.turnsMax = s.turnsMin;
      if (s.durationMax < s.durationMin) s.durationMax = s.durationMin;
      state.settings = s;
      persist();
      pushState();
      break;
    }

    case "wheel:save": {
      const name = String(msg.name || state.title || "Untitled").slice(0, 60);
      const id = msg.id || newId();
      wheels[id] = { name, entries: state.entries, title: state.title, saved: Date.now() };
      store.saveWheels(wheels);
      pushState();
      break;
    }

    case "wheel:load": {
      const w = wheels[msg.id];
      if (!w || inflight) return;
      state.entries = w.entries.map((e) => ({ ...e, id: e.id || newId() }));
      state.title = w.title || state.title;
      persist();
      pushState();
      break;
    }

    case "wheel:delete":
      delete wheels[msg.id];
      store.saveWheels(wheels);
      pushState();
      break;

    case "entry:remove":
      if (inflight) return;
      state.entries = state.entries.filter((e) => e.id !== msg.id);
      persist();
      pushState();
      break;

    case "history:clear":
      history = [];
      store.saveHistory(history);
      pushState();
      break;

    // ---- control only ------------------------------------------------
    case "rig:set":
      rig.set(msg.rig || {});
      store.saveRig(rig.get());
      pushState();
      break;

    case "rig:clear":
      rig.clear();
      store.saveRig(rig.get());
      pushState();
      break;

    case "overlay:set":
      state.overlay = { ...state.overlay, ...msg.overlay };
      persist();
      pushState();
      break;

    case "overlay:test":
      bus.broadcast({
        t: "settled",
        spinId: "test",
        index: -1,
        label: String(msg.label || "TEST WINNER").slice(0, 80),
        test: true,
      });
      break;
  }
}

// ---------------------------------------------------------------- http

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false }));

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, entries: state.entries.length, spinning: Boolean(inflight) }),
);

const requireControl = (req, res, next) => {
  if (auth.isControl(parseCookies(req.headers.cookie || "")[COOKIE])) return next();
  return res.redirect("/login");
};

app.get("/login", (_req, res) => res.sendFile(path.join(PUBLIC, "login.html")));

app.post("/login", (req, res) => {
  if (auth.isControl((req.body?.token || "").trim())) {
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${encodeURIComponent(auth.controlToken)}; Path=/; Max-Age=${60 * 60 * 24 * 30}; HttpOnly; SameSite=Lax`,
    );
    return res.redirect("/control");
  }
  return res.redirect("/login?bad=1");
});

app.get("/control", requireControl, (_req, res) => res.sendFile(path.join(PUBLIC, "control.html")));
app.get("/overlay", (_req, res) => res.sendFile(path.join(PUBLIC, "overlay.html")));

app.use(
  express.static(PUBLIC, {
    setHeaders(res, filePath) {
      if (filePath.endsWith(".ttf")) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  }),
);
const server = http.createServer(app);
const bus = createBus({ server, auth, onMessage, snapshotFor });

server.listen(PORT, BIND, () => {
  console.log(`[spin-the-wheel] http://${BIND}:${PORT}`);
  console.log("[auth] Open your private data/secrets.json file locally for operator credentials; do not share it.");
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    try {
      flush({
        "state.json": {
          title: state.title,
          entries: state.entries,
          settings: state.settings,
          angle: state.angle,
          overlay: state.overlay,
        },
        "history.json": history.slice(0, 200),
        "wheels.json": wheels,
        "rig.json": rig.get(),
      });
    } catch (err) {
      console.error("[shutdown] flush failed:", err.message);
    }
    process.exit(0);
  });
}

export { TAU };
