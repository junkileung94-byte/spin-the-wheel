// One key, one job:
//   OVERLAY_KEY — assigns the read-only overlay WebSocket role (keeps the OBS link stable
//                  and stops a stray tab from counting as an operator page)
//
// There is no sign-in: the app is meant for loopback or a private tailnet, and anyone who
// can reach it may use the dashboard. Do not expose it to the open internet.
import crypto from "node:crypto";

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  // timingSafeEqual throws on length mismatch, so hash first to a fixed width
  const ha = crypto.createHash("sha256").update(ba).digest();
  const hb = crypto.createHash("sha256").update(bb).digest();
  return crypto.timingSafeEqual(ha, hb);
};

export function createAuth({ overlayKey }) {
  return {
    overlayKey,
    isOverlay: (key) => Boolean(key) && safeEqual(key, overlayKey),
    /** Role for a websocket, decided server-side and never taken from the client. */
    roleFor({ key }) {
      return this.isOverlay(key) ? "overlay" : "control";
    },
  };
}
