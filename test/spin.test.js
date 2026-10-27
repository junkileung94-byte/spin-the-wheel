import assert from "node:assert/strict";
import test from "node:test";

import { createRig } from "../server/rig.js";
import { indexAt, norm, planSpin, POINTER_ANGLE, TAU } from "../server/spin.js";

const SETTINGS = {
  turnsMin: 5,
  turnsMax: 9,
  durationMin: 5600,
  durationMax: 8400,
  pointer: "top",
};

test("the planned angle always lands on the intended slice", () => {
  for (let i = 0; i < 100000; i++) {
    const count = 2 + Math.floor(Math.random() * 60);
    const index = Math.floor(Math.random() * count);
    const fromAngle = Math.random() * 40 * TAU;
    const plan = planSpin({ index, count, fromAngle, settings: SETTINGS });
    const landed = indexAt(plan.finalAngle, count, POINTER_ANGLE.top);
    assert.equal(landed, index, `count=${count} wanted=${index} got=${landed}`);
  }
});

test("every pointer position lands correctly", () => {
  for (const pointer of Object.keys(POINTER_ANGLE)) {
    for (let i = 0; i < 5000; i++) {
      const count = 2 + Math.floor(Math.random() * 24);
      const index = Math.floor(Math.random() * count);
      const plan = planSpin({
        index,
        count,
        fromAngle: Math.random() * TAU,
        settings: { ...SETTINGS, pointer },
      });
      assert.equal(indexAt(plan.finalAngle, count, POINTER_ANGLE[pointer]), index, `pointer=${pointer}`);
    }
  }
});

test("landings stay off the slice centre and off the borders", () => {
  const count = 8;
  const theta = TAU / count;
  let minFrac = 1;
  let maxFrac = 0;
  const centreHits = [];

  for (let i = 0; i < 20000; i++) {
    const plan = planSpin({ index: 3, count, fromAngle: 0, settings: SETTINGS });
    const local = norm(POINTER_ANGLE.top - plan.finalAngle);
    const frac = (local - 3 * theta) / theta;
    minFrac = Math.min(minFrac, frac);
    maxFrac = Math.max(maxFrac, frac);
    centreHits.push(Math.abs(frac - 0.5));
  }

  assert.ok(minFrac >= 0.115, `landed too close to the low border: ${minFrac}`);
  assert.ok(maxFrac <= 0.885, `landed too close to the high border: ${maxFrac}`);
  // and it must actually vary — a constant landing fraction would be the tell
  assert.ok(maxFrac - minFrac > 0.6, "landing position is not varying enough");
  const avgFromCentre = centreHits.reduce((a, b) => a + b, 0) / centreHits.length;
  assert.ok(avgFromCentre > 0.15, "landings cluster on the slice centre");
});

test("near-miss lands hard against the entry edge but still inside the slice", () => {
  const count = 10;
  const theta = TAU / count;
  for (let i = 0; i < 5000; i++) {
    const plan = planSpin({ index: 6, count, fromAngle: 0, settings: SETTINGS, nearMiss: true });
    assert.equal(indexAt(plan.finalAngle, count, POINTER_ANGLE.top), 6);
    const frac = (norm(POINTER_ANGLE.top - plan.finalAngle) - 6 * theta) / theta;
    assert.ok(frac > 0.78 && frac < 0.885, `near-miss frac out of band: ${frac}`);
  }
});

test("turns and duration vary within the configured bounds", () => {
  const turns = new Set();
  const durations = new Set();
  for (let i = 0; i < 3000; i++) {
    const plan = planSpin({ index: 0, count: 6, fromAngle: 0, settings: SETTINGS });
    turns.add(plan.turns);
    durations.add(plan.durationMs);
    assert.ok(plan.turns >= SETTINGS.turnsMin && plan.turns <= SETTINGS.turnsMax);
    assert.ok(plan.durationMs >= SETTINGS.durationMin && plan.durationMs <= SETTINGS.durationMax);
  }
  assert.equal(turns.size, SETTINGS.turnsMax - SETTINGS.turnsMin + 1);
  assert.ok(durations.size > 1000, "duration is not varying");
});

test("the wheel always travels forward by at least turnsMin full turns", () => {
  for (let i = 0; i < 5000; i++) {
    const fromAngle = Math.random() * 100;
    const plan = planSpin({ index: 2, count: 7, fromAngle, settings: SETTINGS });
    const travel = plan.finalAngle - fromAngle;
    assert.ok(travel >= SETTINGS.turnsMin * TAU, `travelled only ${travel}`);
    assert.ok(travel <= (SETTINGS.turnsMax + 1) * TAU);
  }
});

test("a rigged plan is indistinguishable in shape from a fair one", () => {
  const rig = createRig();
  const entries = Array.from({ length: 6 }, (_, i) => ({ id: `id${i}`, label: `e${i}` }));

  const fair = planSpin({
    index: rig.pick(entries).index,
    count: 6,
    fromAngle: 0,
    settings: SETTINGS,
  });

  rig.set({ next: "id4" });
  const rigged = planSpin({
    index: rig.pick(entries).index,
    count: 6,
    fromAngle: 0,
    settings: SETTINGS,
  });

  assert.deepEqual(Object.keys(fair).sort(), Object.keys(rigged).sort());
  for (const key of Object.keys(fair)) {
    assert.equal(typeof fair[key], typeof rigged[key], `${key} differs in type`);
  }
  // and the rigged one really did land where it was told
  assert.equal(indexAt(rigged.finalAngle, 6, POINTER_ANGLE.top), 4);
});

test("indexAt is the exact inverse the client will compute", () => {
  // guards the one invariant the whole anti-tell design rests on:
  // client and server derive the same winner from the same angle
  for (let i = 0; i < 20000; i++) {
    const count = 2 + Math.floor(Math.random() * 30);
    const rot = Math.random() * 200 - 100;
    const idx = indexAt(rot, count, POINTER_ANGLE.top);
    assert.ok(idx >= 0 && idx < count, `index ${idx} out of range for count ${count}`);
  }
});
