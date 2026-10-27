import assert from "node:assert/strict";
import test from "node:test";

import { createRig } from "../server/rig.js";

const entries = ["ana", "bo", "cy", "dee", "ell"].map((label, i) => ({
  id: `id${i}`,
  label,
  color: "#ff2fd0",
}));

test("fair mode spreads across every entry", () => {
  const rig = createRig();
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(rig.pick(entries).index);
  assert.equal(seen.size, entries.length);
});

test("next forces one spin then reverts to fair", () => {
  const rig = createRig();
  rig.set({ next: "id3" });
  assert.equal(rig.isArmed(), true);

  const first = rig.pick(entries);
  assert.equal(first.index, 3);
  assert.equal(first.rigged, true);
  assert.equal(first.reason, "next");

  assert.equal(rig.isArmed(), false);
  assert.equal(rig.get().next, null);
  assert.equal(rig.pick(entries).reason, "fair");
});

test("queue is consumed in order and outranks next and always", () => {
  const rig = createRig();
  rig.set({ queue: ["id2", "id0"], next: "id4", always: "id1" });

  assert.equal(rig.pick(entries).index, 2);
  assert.equal(rig.pick(entries).index, 0);
  // queue empty: next takes over, then always
  assert.equal(rig.pick(entries).index, 4);
  assert.equal(rig.pick(entries).index, 1);
  assert.equal(rig.pick(entries).index, 1);
});

test("queue entries that no longer exist are skipped, not stuck", () => {
  const rig = createRig();
  rig.set({ queue: ["ghost", "id1"] });
  assert.equal(rig.pick(entries).index, 1);
  assert.equal(rig.get().queue.length, 0);
});

test("always locks every spin until cleared", () => {
  const rig = createRig();
  rig.set({ always: "id2" });
  for (let i = 0; i < 50; i++) assert.equal(rig.pick(entries).index, 2);
  rig.set({ always: null });
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(rig.pick(entries).index);
  assert.ok(seen.size > 1);
});

test("blacklisted entries never win", () => {
  const rig = createRig();
  rig.set({ blacklist: ["id0", "id4"] });
  for (let i = 0; i < 10000; i++) {
    const { index } = rig.pick(entries);
    assert.ok(index !== 0 && index !== 4, `blacklisted entry ${index} won`);
  }
});

test("blacklisting everything degrades to fair rather than deadlocking", () => {
  const rig = createRig();
  rig.set({ blacklist: entries.map((e) => e.id) });
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(rig.pick(entries).index);
  assert.equal(seen.size, entries.length);
});

test("weights land within 1.5 points of the requested share", () => {
  const rig = createRig();
  // ana 7x, everyone else 1x  -> ana should win 7/11 = 63.6%
  rig.set({ weights: { id0: 7 } });
  const N = 100000;
  let wins = 0;
  for (let i = 0; i < N; i++) if (rig.pick(entries).index === 0) wins++;
  const pct = (100 * wins) / N;
  const expected = (100 * 7) / (7 + 4);
  assert.ok(Math.abs(pct - expected) < 1.5, `expected ~${expected.toFixed(1)}%, got ${pct.toFixed(1)}%`);
});

test("clear() wipes every rig channel", () => {
  const rig = createRig();
  rig.set({ next: "id1", always: "id2", queue: ["id3"], blacklist: ["id4"], weights: { id0: 9 } });
  rig.clear();
  const r = rig.get();
  assert.equal(r.next, null);
  assert.equal(r.always, null);
  assert.deepEqual(r.queue, []);
  assert.deepEqual(r.blacklist, []);
  assert.deepEqual(r.weights, {});
  assert.equal(rig.isArmed(), false);
});

test("an empty wheel returns null instead of throwing", () => {
  assert.equal(createRig().pick([]), null);
});
