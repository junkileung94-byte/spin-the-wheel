// Outcome control. Lives ONLY on the server and on the authenticated control socket —
// nothing here is ever serialised to the public page or the overlay.
//
// Precedence:  queue > next > always > (weights + blacklist) > fair
import crypto from "node:crypto";

export const EMPTY_RIG = {
  queue: [], // entry ids, consumed one per spin
  next: null, // entry id, forces one spin then auto-clears
  always: null, // entry id, forces every spin until cleared
  weights: {}, // entryId -> relative weight (1 = normal)
  blacklist: [], // entry ids that render on the wheel but can never win
  nearMissPct: 0, // 0-100, how often the wheel creeps in from a slice edge
};

/** Uniform float in [0,1) from the CSPRNG — no seeded RNG anywhere in the spin path. */
export function rand() {
  return crypto.randomInt(0, 2 ** 30) / 2 ** 30;
}

function pickUniform(pool) {
  return pool[crypto.randomInt(0, pool.length)];
}

function pickWeighted(pool, weights) {
  const scored = pool.map((e) => {
    const w = Number(weights[e.id]);
    return { e, w: Number.isFinite(w) && w > 0 ? w : 1 };
  });
  const total = scored.reduce((sum, s) => sum + s.w, 0);
  let roll = rand() * total;
  for (const s of scored) {
    roll -= s.w;
    if (roll <= 0) return s.e;
  }
  return scored[scored.length - 1].e;
}

export function createRig(initial) {
  let rig = { ...EMPTY_RIG, ...(initial || {}) };

  return {
    get: () => structuredClone(rig),

    set(patch) {
      rig = { ...rig, ...patch };
      // normalise: ids are strings, arrays are arrays
      rig.queue = Array.isArray(rig.queue) ? rig.queue.map(String) : [];
      rig.blacklist = Array.isArray(rig.blacklist) ? rig.blacklist.map(String) : [];
      rig.weights = rig.weights && typeof rig.weights === "object" ? rig.weights : {};
      rig.nearMissPct = Math.max(0, Math.min(100, Number(rig.nearMissPct) || 0));
      return this.get();
    },

    clear() {
      rig = { ...EMPTY_RIG, nearMissPct: rig.nearMissPct };
      return this.get();
    },

    /** True when this spin's outcome is already decided (drives the ARMED chip). */
    isArmed() {
      return Boolean(rig.queue.length || rig.next || rig.always);
    },

    /**
     * Choose the winning entry. Returns { index, rigged, reason }.
     * `rigged`/`reason` are for the operator's history only — they never leave the server
     * on a public or overlay socket.
     */
    pick(entries) {
      if (!entries.length) return null;
      const byId = new Map(entries.map((e) => [e.id, e]));
      const blocked = new Set(rig.blacklist);
      let pool = entries.filter((e) => !blocked.has(e.id));
      if (!pool.length) pool = entries; // everything blacklisted: blacklist is meaningless, ignore it

      const out = (entry, rigged, reason) => ({
        index: entries.indexOf(entry),
        rigged,
        reason,
      });

      // 1. queue — drop ids that no longer exist, then consume one
      while (rig.queue.length) {
        const id = rig.queue.shift();
        const entry = byId.get(id);
        if (entry) return out(entry, true, "queue");
      }

      // 2. next — one shot, then auto-revert to fair
      if (rig.next) {
        const entry = byId.get(rig.next);
        rig.next = null;
        if (entry) return out(entry, true, "next");
      }

      // 3. always — sticky until cleared
      if (rig.always) {
        const entry = byId.get(rig.always);
        if (entry) return out(entry, true, "always");
      }

      // 4. weights (only meaningful if someone set one that is not 1)
      const weighted = pool.some((e) => {
        const w = Number(rig.weights[e.id]);
        return Number.isFinite(w) && w > 0 && w !== 1;
      });
      if (weighted) return out(pickWeighted(pool, rig.weights), true, "weights");

      // 5. fair — but a blacklist still counts as a thumb on the scale
      return out(pickUniform(pool), blocked.size > 0, blocked.size > 0 ? "blacklist" : "fair");
    },
  };
}
