// Main wheel page.
import { applyLogo } from "./brand.js";
import { createBubbles } from "./bubbles.js";
import { connect } from "./net.js";
import { createSound } from "./sound.js";
import { createWheel } from "./wheel.js";

const $ = (id) => document.getElementById(id);

const sound = createSound();
const bubbles = createBubbles($("bubbles"));

let state = null;
let entriesDirty = false;
let pendingWinner = null;

const net = connect({
  onStatus(s) {
    $("dot").className = `dot ${s === "open" ? "on" : "off"}`;
    $("statusText").textContent = s === "open" ? "live" : "reconnecting…";
  },
});

const wheel = createWheel($("wheel"), {
  now: () => net.now(),
  onTick() {
    if (state?.settings.tick) sound.tick();
  },
});

// ── incoming ────────────────────────────────────────────────────────────

net.on((msg) => {
  if (msg.t === "welcome" || msg.t === "state") {
    applyState(msg.state);
  } else if (msg.t === "spin") {
    startSpin(msg);
  } else if (msg.t === "settled") {
    showWinner(msg.label);
  } else if (msg.t === "toast") {
    toast(msg.text);
  }
});

function applyState(next) {
  const first = !state;
  state = next;

  wheel.setPointer(state.settings.pointer);
  wheel.setEntries(state.entries);
  if (!wheel.isSpinning()) wheel.setAngle(state.angle);
  applyLogo(state.logo, wheel);

  $("brandName").textContent = state.title;
  $("stageTitle").textContent = state.title;
  document.title = `${state.title} — Spin the Wheel`;
  $("count").textContent = `${state.entries.length} entries`;
  $("spinBtn").disabled = state.entries.length < 2 || state.spinning;

  if (!entriesDirty && document.activeElement !== $("entries")) {
    $("entries").value = state.entries.map((e) => e.label).join("\n");
  }

  sound.enabled = state.settings.sound;
  sound.setVolume(state.settings.volume);

  renderWheels();
  renderHistory();
  fillSettings(); // another tab or the dashboard may have changed them
  if (first) {
    // a shared link carries its entries in the hash
    const shared = readShareHash();
    if (shared?.length) {
      $("entries").value = shared.join("\n");
      pushEntries();
      history.replaceState(null, "", location.pathname);
    }
    // resume an in-flight spin (page opened mid-spin)
    if (state.spin) startSpin(state.spin);
  }
}

function startSpin(spin) {
  hideWinner();
  bubbles.clear();
  if (state?.settings.sound) sound.whoosh();
  wheel.run(spin, state.angle, () => {});
  $("spinBtn").disabled = true;
}

function showWinner(label) {
  pendingWinner = label;
  $("winnerName").textContent = label;
  $("winnerVeil").classList.add("show");
  if (state?.settings.confetti) bubbles.celebrate();
  if (state?.settings.sound) sound.fanfare();
  $("spinBtn").disabled = (state?.entries.length ?? 0) < 2;
}

function hideWinner() {
  $("winnerVeil").classList.remove("show");
}

// ── outgoing ────────────────────────────────────────────────────────────

const parseEntries = () =>
  $("entries")
    .value.split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 500);

function pushEntries() {
  const labels = parseEntries();
  // keep ids/colours for labels that already exist so the wheel does not reshuffle colours
  const byLabel = new Map((state?.entries || []).map((e) => [e.label, e]));
  const used = new Set();
  const entries = labels.map((label) => {
    const prev = byLabel.get(label);
    if (prev && !used.has(prev.id)) {
      used.add(prev.id);
      return { id: prev.id, label, color: prev.color };
    }
    return { label };
  });
  net.send({ t: "entries:set", entries });
  entriesDirty = false;
}

let entriesTimer = null;
$("entries").addEventListener("input", () => {
  entriesDirty = true;
  $("count").textContent = `${parseEntries().length} entries`;
  clearTimeout(entriesTimer);
  entriesTimer = setTimeout(pushEntries, 500);
});
$("entries").addEventListener("blur", () => entriesDirty && pushEntries());

const spin = () => {
  sound.unlock();
  if (state && !state.spinning && state.entries.length >= 2) net.send({ t: "spin" });
};

$("spinBtn").addEventListener("click", spin);
$("wheel").addEventListener("click", spin);

$("shuffleBtn").addEventListener("click", () => {
  const l = parseEntries();
  for (let i = l.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [l[i], l[j]] = [l[j], l[i]];
  }
  $("entries").value = l.join("\n");
  pushEntries();
});

$("sortBtn").addEventListener("click", () => {
  $("entries").value = parseEntries().sort((a, b) => a.localeCompare(b)).join("\n");
  pushEntries();
});

$("dedupeBtn").addEventListener("click", () => {
  $("entries").value = [...new Set(parseEntries())].join("\n");
  pushEntries();
});

const PALETTE = ["#ff2fd0", "#7b2ff7", "#ff6fe0", "#3b2f8f", "#c04ff0", "#ff9ae8", "#4a2a7a", "#e11fa8", "#4fd8ff", "#ffd76f"];

$("recolorBtn").addEventListener("click", () => {
  // start the palette at a random point so every press gives a visibly different wheel
  const offset = Math.floor(Math.random() * PALETTE.length);
  const byLabel = new Map(state.entries.map((e) => [e.label, e]));
  net.send({
    t: "entries:set",
    entries: parseEntries().map((label, i) => ({
      id: byLabel.get(label)?.id,
      label,
      color: PALETTE[(i + offset) % PALETTE.length],
    })),
  });
});

// ── winner popup buttons ────────────────────────────────────────────────

$("winnerClose").addEventListener("click", hideWinner);
$("winnerAgain").addEventListener("click", () => {
  hideWinner();
  spin();
});
$("winnerRemove").addEventListener("click", () => {
  const entry = state?.entries.find((e) => e.label === pendingWinner);
  if (entry) net.send({ t: "entry:remove", id: entry.id });
  hideWinner();
});

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea")) return;
  if (e.code === "Space") {
    e.preventDefault();
    $("winnerVeil").classList.contains("show") ? hideWinner() : spin();
  }
  if (e.code === "Escape") hideWinner();
});

// ── tabs ────────────────────────────────────────────────────────────────

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    for (const t of document.querySelectorAll(".tab")) t.setAttribute("aria-selected", String(t === tab));
    for (const p of document.querySelectorAll(".tabpanel")) {
      p.classList.toggle("active", p.dataset.panel === tab.dataset.tab);
    }
  });
}

// ── settings ────────────────────────────────────────────────────────────

function fillSettings() {
  const s = state.settings;
  const set = (id, prop, value) => {
    if (document.activeElement !== $(id)) $(id)[prop] = value;
  };
  set("titleInput", "value", state.title);
  set("durMin", "value", (s.durationMin / 1000).toFixed(1));
  set("durMax", "value", (s.durationMax / 1000).toFixed(1));
  set("pointer", "value", s.pointer);
  set("removeWinner", "checked", s.removeWinner);
  set("confetti", "checked", s.confetti);
  set("sound", "checked", s.sound);
  set("tick", "checked", s.tick);
  set("volume", "value", s.volume);
}

const sendSettings = (patch) => net.send({ t: "settings:set", settings: patch });

$("titleInput").addEventListener("change", (e) => net.send({ t: "title:set", title: e.target.value }));
$("durMin").addEventListener("change", (e) => sendSettings({ durationMin: Number(e.target.value) * 1000 }));
$("durMax").addEventListener("change", (e) => sendSettings({ durationMax: Number(e.target.value) * 1000 }));
$("pointer").addEventListener("change", (e) => sendSettings({ pointer: e.target.value }));
for (const id of ["removeWinner", "confetti", "sound", "tick"]) {
  $(id).addEventListener("change", (e) => sendSettings({ [id]: e.target.checked }));
}
$("volume").addEventListener("input", (e) => {
  sound.setVolume(e.target.value);
  sendSettings({ volume: Number(e.target.value) });
});

$("fullscreenBtn").addEventListener("click", () => {
  const el = document.querySelector(".stage");
  document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.();
  setTimeout(() => wheel.resize(), 120);
});

// ── saved wheels ────────────────────────────────────────────────────────

function renderWheels() {
  const list = $("wheelList");
  const wheels = state.wheels || [];
  list.innerHTML = "";
  if (!wheels.length) {
    list.innerHTML = '<div class="hint">No saved wheels yet. Save the current one above.</div>';
    return;
  }
  for (const w of wheels) {
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `<span class="grow"></span><span class="hint"></span>`;
    row.querySelector(".grow").textContent = w.name;
    row.querySelector(".hint").textContent = `${w.count}`;
    const load = document.createElement("button");
    load.className = "btn small";
    load.textContent = "Load";
    load.onclick = () => net.send({ t: "wheel:load", id: w.id });
    const del = document.createElement("button");
    del.className = "btn small danger";
    del.textContent = "✕";
    del.onclick = () => net.send({ t: "wheel:delete", id: w.id });
    row.append(load, del);
    list.append(row);
  }
}

$("saveWheel").addEventListener("click", () => {
  const name = $("wheelName").value.trim() || state.title;
  net.send({ t: "wheel:save", name });
  $("wheelName").value = "";
  toast(`Saved “${name}”`);
});

function renderHistory() {
  const list = $("historyList");
  list.innerHTML = "";
  const h = state.history || [];
  if (!h.length) {
    list.innerHTML = '<div class="hint">Nothing spun yet.</div>';
    return;
  }
  for (const item of h) {
    const row = document.createElement("div");
    row.className = "item";
    const time = new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    row.innerHTML = `<span class="swatch" style="background:#ff2fd0;color:#ff2fd0"></span><span class="grow"></span><span class="hint"></span>`;
    row.querySelector(".grow").textContent = item.label;
    row.querySelector(".hint").textContent = time;
    list.append(row);
  }
}

// ── import / export / share ─────────────────────────────────────────────

$("exportBtn").addEventListener("click", () => {
  const blob = new Blob(
    [JSON.stringify({ title: state.title, entries: state.entries.map((e) => ({ label: e.label, color: e.color })) }, null, 2)],
    { type: "application/json" },
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${state.title.replace(/\W+/g, "-").toLowerCase()}-wheel.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const entries = (data.entries || data).map((x) => (typeof x === "string" ? { label: x } : x));
    net.send({ t: "entries:set", entries });
    if (data.title) net.send({ t: "title:set", title: data.title });
    toast(`Imported ${entries.length} entries`);
  } catch {
    toast("That file is not a wheel export");
  }
  e.target.value = "";
});

$("shareBtn").addEventListener("click", async () => {
  const hash = btoa(encodeURIComponent(parseEntries().join("\n")));
  const url = `${location.origin}${location.pathname}#w=${hash}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("Share link copied");
  } catch {
    prompt("Copy this link:", url);
  }
});

function readShareHash() {
  const m = location.hash.match(/#w=(.+)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(atob(m[1])).split("\n").filter(Boolean);
  } catch {
    return null;
  }
}

// ── misc ────────────────────────────────────────────────────────────────

let toastTimer = null;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

document.addEventListener("click", () => sound.unlock(), { once: true });
window.addEventListener("resize", () => bubbles.resize());
