// WebSocket hub. Three rooms — public / overlay / control — but only ONE spin message,
// broadcast byte-for-byte identically to all of them. Redaction happens on state snapshots
// (rig config, rigged flags) never on the spin itself.
import { WebSocketServer } from "ws";

export function createBus({ server, auth, onMessage, snapshotFor, heartbeatMs = 25000 }) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const clients = new Set();

  function send(ws, msg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://x");
    const role = auth.roleFor({
      cookieHeader: req.headers.cookie || "",
      key: url.searchParams.get("key"),
    });

    ws.meta = { role, alive: true, id: Math.random().toString(36).slice(2, 10) };
    clients.add(ws);

    send(ws, {
      t: "welcome",
      role,
      serverTime: Date.now(),
      state: snapshotFor(role),
    });

    ws.on("pong", () => {
      ws.meta.alive = true;
    });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== "string") return;
      if (msg.t === "ping") {
        // client clock sync: echo their stamp alongside ours
        send(ws, { t: "pong", c: msg.c, s: Date.now() });
        return;
      }
      onMessage(msg, ws.meta.role, ws);
    });

    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });

  const beat = setInterval(() => {
    for (const ws of clients) {
      if (!ws.meta.alive) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      ws.meta.alive = false;
      try {
        ws.ping();
      } catch {
        /* socket is going away anyway */
      }
    }
  }, heartbeatMs);
  beat.unref?.();

  return {
    send,
    /** Same payload to everyone. Used for spins — parity is the point. */
    broadcast(msg) {
      const data = JSON.stringify(msg);
      for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(data);
    },
    /** Per-role payload. Used for state snapshots, which ARE redacted. */
    broadcastByRole(build) {
      const cache = new Map();
      for (const ws of clients) {
        if (ws.readyState !== ws.OPEN) continue;
        const role = ws.meta.role;
        if (!cache.has(role)) cache.set(role, JSON.stringify(build(role)));
        ws.send(cache.get(role));
      }
    },
    toRole(role, msg) {
      const data = JSON.stringify(msg);
      for (const ws of clients) {
        if (ws.meta.role === role && ws.readyState === ws.OPEN) ws.send(data);
      }
    },
    counts() {
      const out = { public: 0, overlay: 0, control: 0 };
      for (const ws of clients) out[ws.meta.role] = (out[ws.meta.role] || 0) + 1;
      return out;
    },
    close() {
      clearInterval(beat);
      wss.close();
    },
  };
}
