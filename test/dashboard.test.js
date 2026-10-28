// Dashboard plumbing: open access, the logo upload, and the pages the dashboard needs.
// Boots a throwaway server on a free port with its own data directory.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { WebSocket } from "ws";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

// 1x1 transparent PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function freePort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

function welcome(base, query = "") {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace("http:", "ws:")}/ws${query}`);
    ws.once("message", (raw) => {
      ws.close();
      resolve(JSON.parse(raw));
    });
    ws.once("error", reject);
  });
}

test("dashboard opens without sign-in; logo upload and sound assets", { timeout: 20000 }, async (t) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "wheel-dash-"));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), BIND: "127.0.0.1", DATA_DIR: data, OVERLAY_KEY: "k" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    fs.rmSync(data, { recursive: true, force: true });
  });

  for (let i = 0; i < 80; i++) {
    assert.equal(child.exitCode, null, "server exited before becoming ready");
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  assert.ok(output.includes("/control"), "startup output points to the dashboard");
  assert.ok(!output.includes("k"), "startup output never prints the overlay key");

  // no sign-in: the dashboard opens directly, and the sign-in machinery is gone
  for (const route of ["/control", "/dashboard"]) {
    const page = await fetch(base + route);
    assert.equal(page.status, 200, `${route} opens without signing in`);
    assert.match(await page.text(), /Edit wheel/);
  }
  assert.equal((await fetch(base + "/login")).status, 404, "no login page anymore");
  for (const asset of ["/css/dashboard.css", "/js/control.js", "/js/brand.js", "/js/sound.js", "/fonts/Quicksand-Bold.ttf"]) {
    assert.equal((await fetch(base + asset)).status, 200, `asset reachable: ${asset}`);
  }

  const sounds = ["spin", "tick", "tick2", "win", "bubbles", "pop1", "pop2", "pop3", "pop4"].map((n) => `/sounds/${n}.wav`);
  for (const s of sounds) {
    const head = Buffer.from(await (await fetch(base + s)).arrayBuffer()).subarray(0, 12).toString("latin1");
    assert.ok(head.startsWith("RIFF") && head.endsWith("WAVE"), `${s} is a WAV file`);
  }
  const st = (await welcome(base)).state.settings;
  assert.equal(st.popSounds, true, "bubble pop sounds default on");
  assert.equal(st.overlaySound, false, "overlay sound defaults off so audio is never doubled");

  // default logo, then an upload that every socket hears about
  const before = await fetch(`${base}/api/logo`);
  assert.equal(before.status, 200);
  assert.match(before.headers.get("content-type"), /svg/);
  assert.equal((await welcome(base)).state.logo, 0);

  const upload = (body) =>
    fetch(`${base}/api/logo`, { method: "POST", headers: { "Content-Type": "application/json" }, body });

  const svg = await upload(JSON.stringify({ dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" }));
  assert.equal(svg.status, 400, "SVG uploads are refused");
  const big = await upload(JSON.stringify({ dataUrl: `data:image/png;base64,${"A".repeat(2_900_000)}` }));
  assert.equal(big.status, 400, "oversized images are refused");

  const ok = await upload(JSON.stringify({ dataUrl: `data:image/png;base64,${PNG}` }));
  assert.equal(ok.status, 200);
  const after = await fetch(`${base}/api/logo`);
  assert.match(after.headers.get("content-type"), /png/);
  assert.ok(fs.existsSync(path.join(data, "logo.png")), "logo is stored in the data directory");
  assert.ok((await welcome(base)).state.logo > 0, "state carries the new logo version");

  assert.equal((await fetch(`${base}/api/logo`, { method: "DELETE" })).status, 200);
  assert.ok(!fs.existsSync(path.join(data, "logo.png")));
  assert.equal((await welcome(base)).state.logo, 0);

  // the keyed overlay stays a display: its snapshot carries no operator data
  const keyed = await welcome(base, "?key=k");
  assert.equal(keyed.role, "overlay");
  assert.ok(!keyed.state.rig && !keyed.state.overlayKey, "overlay state omits operator data");
});
