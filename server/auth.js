// Two secrets, two jobs:
//   CONTROL_TOKEN — unlocks /control (the operator panel that can rig outcomes)
//   OVERLAY_KEY   — assigns the read-only overlay WebSocket role, not page privacy
//
// The whole app is tailnet-only, so these guard against the wrong person on the tailnet
// and against a URL leaking into a stream frame — not against the open internet.
import crypto from "node:crypto";

export const COOKIE = "ks_control";

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  // timingSafeEqual throws on length mismatch, so hash first to a fixed width
  const ha = crypto.createHash("sha256").update(ba).digest();
  const hb = crypto.createHash("sha256").update(bb).digest();
  return crypto.timingSafeEqual(ha, hb);
};

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createAuth({ controlToken, overlayKey }) {
  return {
    controlToken,
    overlayKey,
    isControl: (token) => Boolean(token) && safeEqual(token, controlToken),
    isOverlay: (key) => Boolean(key) && safeEqual(key, overlayKey),
    /** Role for a websocket, decided server-side and never taken from the client. */
    roleFor({ cookieHeader, key }) {
      if (this.isControl(parseCookies(cookieHeader)[COOKIE])) return "control";
      if (this.isOverlay(key)) return "overlay";
      return "public";
    },
  };
}
