// OBS Browser Source.
//
// A display, never an input: its WebSocket role is read-only. It renders the same wheel as
// the main page, driven by the same server timestamps, so the two stay frame-locked.
//
// URL params
//   key=…        overlay key (required for control-panel commands to reach it)
//   w=900        wheel size in px (default: fits the viewport)
//   title=0      hide the title above the wheel
//   idle=hide    keep the wheel hidden until a spin starts
//   autohide=7   seconds the winner card stays up (0 = stay until the next spin)
import { applyLogo } from "./brand.js";
import { createBubbles } from "./bubbles.js";
import { connect } from "./net.js";
import { createSound } from "./sound.js";
import { createWheel } from "./wheel.js";

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

const wheelSize = Number(params.get("w")) || Math.min(window.innerWidth, window.innerHeight) * 0.82;
const showTitleParam = params.get("title") !== "0";
const idleHide = params.get("idle") === "hide";
const autohideParam = params.get("autohide");

$("wheel").style.width = `${wheelSize}px`;
$("wheel").style.height = `${wheelSize}px`;

// Sound here is opt-in (dashboard: "Play sounds in the OBS overlay"), so a streamer who
// already captures the wheel page's audio never hears everything twice. OBS lets a browser
// source play audio without a click; a normal browser tab stays silent until clicked.
const sound = createSound();
const audible = () => Boolean(state?.settings.overlaySound && state.settings.sound);
const bubbles = createBubbles($("bubbles"), {
  onPop: (r) => audible() && state.settings.popSounds !== false && sound.pop(r),
});
let state = null;
let hideTimer = null;
let spinning = false;

const net = connect({ key: params.get("key") || "" });
const wheel = createWheel($("wheel"), {
  now: () => net.now(),
  onTick() {
    if (audible() && state.settings.tick) sound.tick();
  },
});

net.on((msg) => {
  if (msg.t === "welcome" || msg.t === "state") {
    apply(msg.state);
  } else if (msg.t === "spin") {
    spinning = true;
    hideWinner();
    bubbles.clear();
    reveal(true);
    if (audible()) sound.whoosh();
    wheel.run(msg, state.angle, () => {});
  } else if (msg.t === "settled") {
    spinning = false;
    showWinner(msg.label);
  }
});

function apply(next) {
  const first = !state;
  state = next;
  wheel.setPointer(state.settings.pointer);
  wheel.setEntries(state.entries);
  if (!wheel.isSpinning()) wheel.setAngle(state.angle);
  applyLogo(state.logo, wheel);
  sound.enabled = audible();
  sound.setVolume(state.settings.volume);
  if (audible()) sound.unlock();

  const showTitle = showTitleParam && state.overlay.showTitle !== false;
  $("ovTitle").textContent = state.title;
  $("ovTitle").classList.toggle("hidden", !showTitle);

  reveal(state.overlay.visible !== false && (!idleHide || spinning));

  // an OBS source that restarted mid-spin drops straight back into the running animation
  if (first && state.spin) {
    spinning = true;
    reveal(true);
    wheel.run(state.spin, state.angle, () => {});
  }
}

function reveal(on) {
  $("stage").classList.toggle("visible", Boolean(on) && state?.overlay.visible !== false);
}

function showWinner(label) {
  $("wname").textContent = label;
  $("winner").classList.add("show");
  $("stage").classList.add("dimmed");
  if (state?.settings.confetti !== false) bubbles.celebrate(190);
  if (audible()) sound.fanfare();

  clearTimeout(hideTimer);
  const secs = autohideParam !== null ? Number(autohideParam) : (state?.settings.autohideSec ?? 7);
  if (secs > 0) {
    hideTimer = setTimeout(() => {
      hideWinner();
      if (idleHide) reveal(false);
    }, secs * 1000);
  }
}

function hideWinner() {
  clearTimeout(hideTimer);
  $("winner").classList.remove("show");
  $("stage").classList.remove("dimmed");
}

window.addEventListener("resize", () => {
  if (!params.get("w")) {
    const s = Math.min(window.innerWidth, window.innerHeight) * 0.82;
    $("wheel").style.width = `${s}px`;
    $("wheel").style.height = `${s}px`;
  }
  wheel.resize();
  bubbles.resize();
});
