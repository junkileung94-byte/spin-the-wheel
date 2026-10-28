// End-to-end: boots the real server, drives it over real websockets, and checks the two
// things that actually matter on stream —
//   1. an armed name wins, derived from the broadcast angle the same way a browser does
//   2. every page and the overlay see the identical spin payload, with no winner in it
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { WebSocket } from "ws";

import { indexAt, POINTER_ANGLE } from "../server/spin.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let PORT;
const KEY = "test-overlay-key";
let BASE;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(headers = {}, query = "") {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws${query}`, { headers });
  const inbox = [];
  const waiters = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    inbox.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(msg)) waiters.splice(i, 1)[0].resolve(msg);
    }
  });
  return {
    ws,
    send: (m) => ws.send(JSON.stringify(m)),
    seen: (t) => inbox.filter((m) => m.t === t),
    wait(t, timeout = 15000) {
      const hit = inbox.find((m) => m.t === t);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for "${t}"`)), timeout);
        waiters.push({
          match: (m) => m.t === t,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
        });
      });
    },
    /** Wait for the first message — past or future — matching a predicate. */
    until(match, timeout = 15000) {
      const hit = inbox.find(match);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for predicate")), timeout);
        waiters.push({
          match,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
        });
      });
    },
    open: () => new Promise((r) => (ws.readyState === WebSocket.OPEN ? r() : ws.once("open", r))),
    close: () => ws.close(),
  };
}

test("rigged spin lands on the armed entry and leaks nothing to the public socket", async (t) => {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  PORT = listener.address().port;
  BASE = `http://127.0.0.1:${PORT}`;
  await new Promise((resolve) => listener.close(resolve));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wheel-e2e-"));
  const server = spawn(process.execPath, ["server/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      BIND: "127.0.0.1",
      DATA_DIR: dataDir,
      OVERLAY_KEY: KEY,
      SPIN_LEAD_MS: "100",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => console.error("[server]", d.toString().trim()));

  t.after(async () => {
    server.kill("SIGTERM");
    await sleep(150);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // wait for the port
  for (let i = 0; i < 60; i++) {
    assert.equal(server.exitCode, null, "test server exited before becoming ready");
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  assert.ok((await fetch(`${BASE}/api/health`).then((r) => r.json())).ok, "server never came up");

  // no sign-in: a plain page socket is the operator role; the keyed overlay is read-only
  const control = client();
  const pub = client();
  const overlay = client({}, `?key=${KEY}`);
  await Promise.all([control.open(), pub.open(), overlay.open()]);

  const ctlWelcome = await control.wait("welcome");
  const pubWelcome = await pub.wait("welcome");
  const ovWelcome = await overlay.wait("welcome");

  assert.equal(ctlWelcome.role, "control");
  assert.equal(pubWelcome.role, "control");
  assert.equal(ovWelcome.role, "overlay");

  // the overlay is a display: its snapshot must not carry rig state or the overlay key
  assert.equal(ovWelcome.state.rig, undefined, "overlay socket received rig state");
  assert.equal(ovWelcome.state.overlayKey, undefined, "overlay socket received the overlay key");
  assert.ok(ctlWelcome.state.rig, "page socket is missing rig state");

  const entries = ctlWelcome.state.entries;
  assert.ok(entries.length >= 5);
  const target = entries[3];

  // short spins so the test is quick
  control.send({ t: "settings:set", settings: { durationMin: 900, durationMax: 900 } });
  control.send({ t: "rig:set", rig: { next: target.id } });
  await sleep(200);

  const armed = await control.until((m) => m.t === "state" && m.state.armed === true);
  assert.equal(armed.state.rig.next, target.id, "the armed entry is not the one we set");

  control.send({ t: "spin" });

  const ctlSpin = await control.wait("spin");
  const pubSpin = await pub.wait("spin");
  const ovSpin = await overlay.wait("spin");

  // parity: every socket got the identical payload, and it carries no winner
  assert.deepEqual(pubSpin, ctlSpin, "page spin payload differs from control");
  assert.deepEqual(ovSpin, ctlSpin, "overlay spin payload differs from control");
  assert.equal(pubSpin.index, undefined);
  assert.equal(pubSpin.label, undefined);
  assert.deepEqual(
    Object.keys(pubSpin).sort(),
    ["count", "durationMs", "finalAngle", "pointer", "spinId", "startAt", "t", "turns"],
    "spin payload shape changed",
  );

  // derive the winner exactly as the browser does
  const derived = indexAt(pubSpin.finalAngle, entries.length, POINTER_ANGLE[pubSpin.pointer]);
  assert.equal(derived, 3, `angle points at slice ${derived}, expected 3`);

  const settled = await pub.wait("settled");
  assert.equal(settled.label, target.label, "the armed entry did not win");
  assert.equal(settled.index, 3);

  // rig auto-reverted, and the operator's history kept the audit trail
  const latest = await control.until((m) => m.t === "state" && m.state.history?.length > 0);
  assert.equal(latest.state.rig.next, null, "next was not consumed");
  assert.equal(latest.state.armed, false, "wheel stayed armed after a one-shot rig");
  assert.equal(latest.state.history[0].rigged, true, "control history lost the rigged flag");
  assert.equal(latest.state.history[0].reason, "next");


  control.close();
  pub.close();
  overlay.close();
  await sleep(100);
});
