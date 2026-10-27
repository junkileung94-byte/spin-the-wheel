// Spin geometry.
//
// The whole anti-tell design lives here: the server decides the winner, then works
// BACKWARDS to an angle. What goes on the wire is an angle, a duration and a turn count —
// the exact same shape whether the spin was rigged or fair. A viewer with devtools open on
// the public page sees a number that a genuinely random wheel would also have produced.
//
// Geometry conventions (shared verbatim with public/js/wheel.js):
//   * canvas angles: 0 rad = 3 o'clock, positive = clockwise
//   * slice i occupies local [i*THETA, (i+1)*THETA)
//   * the wheel is drawn rotated by `rot`; the pointer is fixed in world space
//   * therefore: localAngleUnderPointer = norm(pointerAngle - rot)
import { rand } from "./rig.js";

export const TAU = Math.PI * 2;

export const POINTER_ANGLE = {
  top: (3 * Math.PI) / 2,
  right: 0,
  bottom: Math.PI / 2,
  left: Math.PI,
};

// Never land dead-centre in a slice (a tell) and never land on a border (ambiguous).
const EDGE_MARGIN = 0.12;

export const norm = (a) => ((a % TAU) + TAU) % TAU;

/** Which slice sits under the pointer at rotation `rot`. The client runs this same math. */
export function indexAt(rot, count, pointerAngle) {
  if (count <= 0) return -1;
  return Math.floor(norm(pointerAngle - rot) / (TAU / count)) % count;
}

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Build the broadcast payload for a spin that must land on `index`.
 *
 * @param {object} o
 * @param {number} o.index        winning slice
 * @param {number} o.count        number of slices
 * @param {number} o.fromAngle    current resting rotation
 * @param {object} o.settings     { turnsMin, turnsMax, durationMin, durationMax, pointer }
 * @param {boolean} o.nearMiss    land hard against the entry edge for drama
 */
export function planSpin({ index, count, fromAngle, settings, nearMiss = false }) {
  const theta = TAU / count;
  const pointerAngle = POINTER_ANGLE[settings.pointer] ?? POINTER_ANGLE.top;

  // Where inside the slice to stop, as a fraction of the slice.
  // The pointer sweeps from the slice's high edge toward its low edge as the wheel turns
  // clockwise, so a high fraction reads as "only just crept in" — the dramatic landing.
  const frac = nearMiss
    ? lerp(1 - EDGE_MARGIN - 0.08, 1 - EDGE_MARGIN, rand())
    : lerp(EDGE_MARGIN, 1 - EDGE_MARGIN, rand());

  const targetRot = norm(pointerAngle - (index * theta + frac * theta));
  const turns = Math.floor(lerp(settings.turnsMin, settings.turnsMax + 1, rand()));
  const durationMs = Math.round(lerp(settings.durationMin, settings.durationMax, rand()));

  return {
    finalAngle: fromAngle + turns * TAU + norm(targetRot - fromAngle),
    durationMs,
    turns,
    pointer: settings.pointer,
  };
}

/**
 * Easing, duplicated in public/js/wheel.js. A long quintic tail is what makes a wheel read
 * as "heavy thing coasting to a stop" rather than "CSS transition".
 */
export function easeOut(p) {
  return 1 - Math.pow(1 - p, 5);
}
