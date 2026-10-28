import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { WebSocket } from "ws";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("fresh self-host loads .env, keeps credentials private and restores data after restart", { timeout: 20000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "wheel-self-host-"));
  const data = path.join(temp, "private-data");
  const envFile = path.join(temp, "settings.env");
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  fs.writeFileSync(envFile, `PORT=${port}\nBIND=127.0.0.1\nDATA_DIR="${data.replaceAll("\\", "/")}"\n`);
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  for (const key of ["PORT", "BIND", "DATA_DIR", "OVERLAY_KEY"]) delete env[key];
  let child;
  let output = "";
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  };
  t.after(async () => {
    await stop();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const start = async () => {
    child = spawn(process.execPath, [`--env-file=${envFile}`, "server/index.js"], {
      cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    for (let attempt = 0; attempt < 80; attempt++) {
      assert.equal(child.exitCode, null, "server exited before becoming ready");
      try {
        if ((await fetch(`${base}/api/health`)).ok) return;
      } catch { /* Wait for the child listener, not a production server. */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail("server did not become ready");
  };
  await start();
  const secretFile = path.join(data, "secrets.json");
  const original = fs.readFileSync(secretFile);
  const secrets = JSON.parse(original);
  assert.ok(secrets.overlayKey, "overlay key generated in the configured directory");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(secretFile).mode & 0o777, 0o600, "credential file is owner-only");
  }
  for (const route of ["/", "/assets/wheel.svg", "/css/theme.css", "/js/app.js"]) {
    assert.equal((await fetch(base + route)).status, 200, `asset reachable: ${route}`);
  }
  for (const route of ["/.env", "/data/secrets.json", "/server/index.js"]) {
    assert.equal((await fetch(base + route)).status, 404, `private path not served: ${route}`);
  }
  // no sign-in: the dashboard is open to whoever can reach the server
  assert.equal((await fetch(base + "/control")).status, 200);
  assert.equal((await fetch(base + "/dashboard")).status, 200);
  assert.equal((await fetch(base + "/login")).status, 404);

  const ws = new WebSocket(base.replace("http:", "ws:") + "/ws");
  const messages = [];
  ws.on("message", (raw) => messages.push(JSON.parse(raw)));
  await once(ws, "open");
  const updated = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("state update timed out")), 5000);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw);
      if (msg.t === "state" && msg.state.title === "Persistence check") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  ws.send(JSON.stringify({ t: "title:set", title: "Persistence check" }));
  await updated;
  const closed = once(ws, "close");
  ws.close();
  await closed;
  assert.ok(messages.some((m) => m.t === "welcome"), "public WebSocket connected");
  // no sign-in: a page socket is the operator role, so it does see this data
  assert.ok(messages.every((m) => !m.state || typeof m.state !== "object" || m.state.entries !== undefined), "state snapshots arrive");
  const keyed = new WebSocket(base.replace("http:", "ws:") + `/ws?key=${secrets.overlayKey}`);
  const [overlayRaw] = await once(keyed, "message");
  const overlayState = JSON.parse(overlayRaw).state;
  assert.ok(!overlayState.rig && !overlayState.overlayKey, "overlay state omits operator data");
  const keyedDone = once(keyed, "close");
  keyed.close();
  await keyedDone;
  // Windows child.kill() terminates without delivering a POSIX signal handler.
  // Wait for the normal debounced write before testing restart persistence there.
  if (process.platform === "win32") {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if (JSON.parse(fs.readFileSync(path.join(data, "state.json"))).title === "Persistence check") break;
      } catch { /* First debounced write may not exist yet. */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  await stop();
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, "state.json"))).title, "Persistence check");
  await start();
  assert.ok(fs.readFileSync(secretFile).equals(original), "restart preserves exact credentials");
  const restarted = new WebSocket(base.replace("http:", "ws:") + "/ws");
  const [raw] = await once(restarted, "message");
  assert.equal(JSON.parse(raw).state.title, "Persistence check", "restart restores wheel state");
  const done = once(restarted, "close");
  restarted.close();
  await done;
  await stop();
  assert.ok(!output.includes(secrets.overlayKey), "logs contain no generated credentials");
});
