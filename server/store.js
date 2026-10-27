// JSON-file persistence. Small enough that a database would be a liability, not a feature.
// Every write is atomic (tmp file + rename) and debounced, so an OBS-night crash cannot
// leave a half-written wheel behind.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// DATA_DIR is overridable so the end-to-end test can boot a throwaway server without
// trampling the live wheel.
const DATA_DIR =
  process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

function read(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8"));
  } catch {
    return fallback;
  }
}

const pending = new Map();

function write(name, value) {
  clearTimeout(pending.get(name));
  const timer = setTimeout(() => {
    pending.delete(name);
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const target = path.join(DATA_DIR, name);
      const tmp = `${target}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
      fs.renameSync(tmp, target);
    } catch (err) {
      console.error(`[store] failed to write ${name}:`, err.message);
    }
  }, 250);
  timer.unref?.();
  pending.set(name, timer);
}

/** Flush any debounced writes immediately — used on shutdown. */
export function flush(all) {
  for (const [name, timer] of pending) clearTimeout(timer);
  pending.clear();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const [name, value] of Object.entries(all)) {
    const target = path.join(DATA_DIR, name);
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(value, null, 2));
    fs.renameSync(`${target}.tmp`, target);
  }
}

export const store = {
  loadWheels: () => read("wheels.json", {}),
  saveWheels: (w) => write("wheels.json", w),
  loadHistory: () => read("history.json", []),
  saveHistory: (h) => write("history.json", h.slice(0, 200)),
  loadState: () => read("state.json", null),
  saveState: (s) => write("state.json", s),
  loadRig: () => read("rig.json", null),
  saveRig: (r) => write("rig.json", r),
};
