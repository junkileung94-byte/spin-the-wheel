// WebSocket client: auto-reconnect + server clock offset.
//
// The offset matters more than it looks. The wheel page and the OBS overlay each start
// their animation at an absolute server timestamp; if their clocks disagree by 200 ms the
// two wheels visibly drift apart on stream. We measure the offset the same way NTP does
// and keep the best (lowest-latency) sample.

export function connect({ key = "", onMessage, onStatus } = {}) {
  const url = new URL("/ws", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  if (key) url.searchParams.set("key", key);

  let ws = null;
  let retry = 0;
  let pingTimer = null;
  let best = { rtt: Infinity, offset: 0 };
  const listeners = new Set(onMessage ? [onMessage] : []);

  function sample() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ t: "ping", c: Date.now() }));
  }

  function open() {
    ws = new WebSocket(url);

    ws.onopen = () => {
      retry = 0;
      onStatus?.("open");
      sample();
      // three quick samples to settle the offset, then a slow keepalive
      setTimeout(sample, 400);
      setTimeout(sample, 900);
      clearInterval(pingTimer);
      pingTimer = setInterval(sample, 15000);
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === "pong") {
        const now = Date.now();
        const rtt = now - msg.c;
        if (rtt < best.rtt) best = { rtt, offset: msg.s + rtt / 2 - now };
        return;
      }
      for (const fn of listeners) fn(msg);
    };

    ws.onclose = () => {
      clearInterval(pingTimer);
      onStatus?.("closed");
      retry = Math.min(retry + 1, 6);
      // OBS restarts a source by tearing the page down; come back fast, then back off
      setTimeout(open, [300, 600, 1200, 2400, 4000, 6000, 8000][retry]);
    };

    ws.onerror = () => ws?.close();
  }

  open();

  return {
    /** Server time as this client best understands it. */
    now: () => Date.now() + best.offset,
    offset: () => best.offset,
    rtt: () => best.rtt,
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    send(msg) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
  };
}
