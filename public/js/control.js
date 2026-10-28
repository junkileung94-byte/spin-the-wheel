// Dashboard (/control). The only page that ever sees who is going to win.
//
// Left column: the live wheel, who wins next, SPIN, show/hide on stream.
// Right column: tabs for editing entries, picking a winner, look & sound, OBS, history.
import { applyLogo } from "./brand.js";
import { connect } from "./net.js";
import { createBubbles } from "./bubbles.js";
import { createSound } from "./sound.js";
import { createWheel } from "./wheel.js";

const $ = (id) => document.getElementById(id);

const PALETTE = ["#ff2fd0", "#7b2ff7", "#ff6fe0", "#3b2f8f", "#c04ff0", "#ff9ae8", "#4a2a7a", "#e11fa8", "#4fd8ff", "#ffd76f"];

let state = null;
let wonTimer = null;

const net = connect({
  onStatus(s) {
    $("dot").className = `dot ${s === "open" ? "on" : "off"}`;
    $("statusText").textContent = s === "open" ? "live" : "reconnecting…";
  },
});

const wheel = createWheel($("wheel"), { now: () => net.now() });

net.on((msg) => {
  if (msg.t === "welcome" || msg.t === "state") apply(msg.state);
  else if (msg.t === "spin") {
    wheel.run(msg, state?.angle ?? 0, () => {});
  } else if (msg.t === "settled" && !msg.test) {
    celebrate(msg.label);
  } else if (msg.t === "toast") {
    toast(msg.text);
  }
});

// ── banner: who wins, in one sentence ───────────────────────────────────

const nameOf = (id) => state?.entries.find((e) => e.id === id)?.label || "an entry that was removed";

function bannerCopy() {
  const r = state.rig;
  if (r.queue.length) {
    return {
      cls: "picked",
      kicker: "Next spin",
      text: `${nameOf(r.queue[0])} wins${r.queue.length > 1 ? `, then ${r.queue.length - 1} more lined up` : ""}`,
    };
  }
  if (r.next) return { cls: "picked", kicker: "Next spin", text: `${nameOf(r.next)} will win` };
  if (r.always) return { cls: "picked", kicker: "Locked", text: `${nameOf(r.always)} wins every spin` };
  const weighted = Object.entries(r.weights || {}).some(
    ([id, w]) => Number(w) !== 1 && state.entries.some((e) => e.id === id),
  );
  if (weighted) return { cls: "picked", kicker: "Next spin", text: "Random, but some entries have better chances" };
  if (r.blacklist.length) {
    return { cls: "picked", kicker: "Next spin", text: `Random, but ${r.blacklist.length} can’t win` };
  }
  return { cls: "fair", kicker: "Next spin", text: "Random: anyone can win" };
}

function paintBanner() {
  if (wonTimer) return; // a winner announcement owns the banner for a few seconds
  const { cls, kicker, text } = bannerCopy();
  $("banner").className = `banner ${cls}`;
  $("bannerKicker").textContent = kicker;
  $("bannerText").textContent = text;
}

function celebrate(label) {
  clearTimeout(wonTimer);
  $("banner").className = "banner won";
  $("bannerKicker").textContent = "Winner";
  $("bannerText").textContent = `${label} won!`;
  wonTimer = setTimeout(() => {
    wonTimer = null;
    paintBanner();
  }, 6000);
}

// ── state ───────────────────────────────────────────────────────────────

function apply(next) {
  const first = !state;
  state = next;

  wheel.setPointer(state.settings.pointer);
  wheel.setEntries(state.entries);
  if (!wheel.isSpinning()) wheel.setAngle(state.angle);
  applyLogo(state.logo, wheel);
  if (first && state.spin) wheel.run(state.spin, state.angle, () => {});

  document.title = `Dashboard - ${state.title || "Spin the Wheel"}`;
  $("dashTitle").textContent = state.title ? `${state.title} dashboard` : "Dashboard";

  paintBanner();
  $("spinBtn").disabled = state.spinning || state.entries.length < 2;
  $("spinBtn").textContent = state.spinning
    ? "SPINNING…"
    : state.entries.length < 2
      ? "ADD 2+ ENTRIES TO SPIN"
      : "SPIN THE WHEEL";

  const visible = state.overlay.visible !== false;
  $("ovShow").classList.toggle("on", visible);
  $("ovHide").classList.toggle("on", !visible);
  $("ovState").textContent = visible ? "The wheel is showing on stream." : "The wheel is hidden on stream.";
  $("ovVisible").checked = visible;
  $("ovTitleOn").checked = state.overlay.showTitle !== false;

  renderEditor();
  renderSavedWheels();
  renderNames();
  renderQueue();
  renderChances();
  renderHistory();
  fillLook();

  $("alwaysOn").checked = Boolean(state.rig.always);
  if (document.activeElement !== $("nearMiss")) $("nearMiss").value = state.rig.nearMissPct || 0;
  $("nmVal").textContent = state.rig.nearMissPct || 0;

  const c = state.clients || {};
  $("clients").textContent = `Open right now: ${c.control || 0} wheel/dashboard page(s) · ${c.overlay || 0} OBS overlay(s)`;

  if (first) renderOverlayUrl();
}

// ── edit: entries ───────────────────────────────────────────────────────

const sendEntries = (entries) => net.send({ t: "entries:set", entries });
const cloneEntries = () => state.entries.map((e) => ({ id: e.id, label: e.label, color: e.color }));

/** Don't rebuild the list under someone's typing; it catches up when they leave the field. */
const editing = () =>
  $("entryList").contains(document.activeElement) && document.activeElement.matches('input[type="text"]');

/** Apply a change to the entry with this id, against the latest state, and send it. */
function editEntry(id, change) {
  const list = cloneEntries();
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return;
  change(list, i);
  sendEntries(list);
}

function renderEditor() {
  if (document.activeElement !== $("titleInput")) $("titleInput").value = state.title;
  $("count").textContent = `${state.entries.length} ${state.entries.length === 1 ? "entry" : "entries"}`;
  $("spinLock").hidden = !state.spinning;
  $("entryList").classList.toggle("locked", state.spinning);
  if (editing()) return;

  const list = $("entryList");
  list.innerHTML = "";
  if (!state.entries.length) {
    list.innerHTML = '<div class="hint">The wheel is empty. Add entries below.</div>';
    return;
  }

  state.entries.forEach((entry, i) => {
    const row = document.createElement("div");
    row.className = "entry";

    const num = document.createElement("span");
    num.className = "num";
    num.textContent = String(i + 1);

    const color = document.createElement("input");
    color.type = "color";
    color.value = entry.color || PALETTE[i % PALETTE.length];
    color.title = "Slice colour";
    color.setAttribute("aria-label", `Colour for ${entry.label}`);
    color.addEventListener("change", () => {
      editEntry(entry.id, (list, j) => (list[j].color = color.value));
    });

    const label = document.createElement("input");
    label.type = "text";
    label.maxLength = 80;
    label.value = entry.label;
    label.setAttribute("aria-label", `Entry ${i + 1}`);
    const commit = () => {
      const text = label.value.trim();
      if (text === entry.label) return;
      editEntry(entry.id, (list, j) => (text ? (list[j].label = text) : list.splice(j, 1)));
    };
    label.addEventListener("change", commit);
    label.addEventListener("keydown", (e) => {
      if (e.key === "Enter") label.blur();
      if (e.key === "Escape") {
        label.value = entry.label;
        label.blur();
      }
    });
    label.addEventListener("blur", () => setTimeout(() => !editing() && renderEditor(), 0));

    const tools = document.createElement("div");
    tools.className = "tools";
    const mk = (text, title, fn, disabled = false) => {
      const b = document.createElement("button");
      b.className = "btn small icon-btn";
      b.textContent = text;
      b.title = title;
      b.setAttribute("aria-label", `${title}: ${entry.label}`);
      b.disabled = disabled;
      b.addEventListener("click", fn);
      return b;
    };
    const move = (by) => () =>
      editEntry(entry.id, (list, j) => {
        const [item] = list.splice(j, 1);
        list.splice(Math.max(0, Math.min(list.length, j + by)), 0, item);
      });
    tools.append(
      mk("↑", "Move up", move(-1), i === 0),
      mk("↓", "Move down", move(1), i === state.entries.length - 1),
      mk("✕", "Remove", () => {
        editEntry(entry.id, (list, j) => list.splice(j, 1));
        toast(`Removed “${entry.label}”`);
      }),
    );
    tools.lastChild.classList.add("danger");

    row.append(num, color, label, tools);
    list.append(row);
  });
}

$("titleInput").addEventListener("change", (e) => net.send({ t: "title:set", title: e.target.value.trim() }));
$("titleInput").addEventListener("keydown", (e) => e.key === "Enter" && e.target.blur());

$("addForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("addInput").value.trim();
  if (!text) return;
  if (state.spinning) return toast("Wait for the wheel to stop first");
  const list = cloneEntries();
  list.push({ label: text, color: PALETTE[list.length % PALETTE.length] });
  sendEntries(list);
  $("addInput").value = "";
  $("addInput").focus();
});

$("shuffleBtn").addEventListener("click", () => {
  const list = cloneEntries();
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  sendEntries(list);
});

$("sortBtn").addEventListener("click", () => {
  sendEntries(cloneEntries().sort((a, b) => a.label.localeCompare(b.label)));
});

$("recolorBtn").addEventListener("click", () => {
  const offset = Math.floor(Math.random() * PALETTE.length);
  sendEntries(cloneEntries().map((e, i) => ({ ...e, color: PALETTE[(i + offset) % PALETTE.length] })));
});

$("bulkBtn").addEventListener("click", () => {
  $("bulkText").value = state.entries.map((e) => e.label).join("\n");
  $("bulkBox").hidden = false;
  $("bulkText").focus();
});
$("bulkCancel").addEventListener("click", () => ($("bulkBox").hidden = true));
$("bulkApply").addEventListener("click", () => {
  const labels = $("bulkText").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const byLabel = new Map(state.entries.map((e) => [e.label, e]));
  const used = new Set();
  sendEntries(
    labels.map((label, i) => {
      const prev = byLabel.get(label);
      if (prev && !used.has(prev.id)) {
        used.add(prev.id);
        return { id: prev.id, label, color: prev.color };
      }
      return { label, color: PALETTE[i % PALETTE.length] };
    }),
  );
  $("bulkBox").hidden = true;
  toast(`Wheel now has ${labels.length} entries`);
});

$("clearBtn").addEventListener("click", () => {
  if (!state.entries.length) return;
  if (!confirm("Remove every entry from the wheel? Save it under Saved wheels first if you want it back.")) return;
  sendEntries([]);
});

// ── edit: saved wheels ──────────────────────────────────────────────────

function renderSavedWheels() {
  const list = $("wheelList");
  list.innerHTML = "";
  const wheels = state.wheels || [];
  if (!wheels.length) {
    list.innerHTML = '<div class="hint">No saved wheels yet. Save the current wheel to switch back to it later.</div>';
    return;
  }
  for (const w of wheels) {
    const row = document.createElement("div");
    row.className = "item";
    const name = document.createElement("span");
    name.className = "grow";
    name.textContent = w.name;
    const count = document.createElement("span");
    count.className = "hint";
    count.textContent = `${w.count} entries`;
    const btn = (text, cls, fn) => {
      const b = document.createElement("button");
      b.className = `btn small ${cls}`;
      b.textContent = text;
      b.addEventListener("click", fn);
      return b;
    };
    row.append(
      name,
      count,
      btn("Load", "primary", () => {
        if (state.spinning) return toast("Wait for the wheel to stop first");
        net.send({ t: "wheel:load", id: w.id });
        toast(`Loaded “${w.name}”`);
      }),
      btn("Overwrite", "", () => {
        if (!confirm(`Replace the saved “${w.name}” with the wheel as it is now?`)) return;
        net.send({ t: "wheel:save", id: w.id, name: w.name });
        toast(`Updated “${w.name}”`);
      }),
      btn("Delete", "danger", () => {
        if (!confirm(`Delete the saved wheel “${w.name}”? The wheel on screen stays as it is.`)) return;
        net.send({ t: "wheel:delete", id: w.id });
      }),
    );
    list.append(row);
  }
}

$("saveForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("wheelName").value.trim() || state.title || "My wheel";
  net.send({ t: "wheel:save", name });
  $("wheelName").value = "";
  toast(`Saved “${name}”`);
});

// ── pick a winner ───────────────────────────────────────────────────────

/** The one entry that actually wins the next spin: same precedence the server uses. */
function chosenId() {
  const r = state.rig;
  return r.queue[0] ?? r.next ?? r.always ?? null;
}

function pick(id) {
  const r = state.rig;
  if (chosenId() === id) {
    net.send({ t: "rig:set", rig: { next: null, always: null, queue: r.queue.filter((q) => q !== id) } });
    return;
  }
  if (r.queue.length) toast("Line-up cleared: this entry wins next");
  if (r.always) {
    net.send({ t: "rig:set", rig: { always: id, next: null, queue: [] } });
    return;
  }
  net.send({ t: "rig:set", rig: { next: id, always: null, queue: [] } });
}

const enqueue = (id) => net.send({ t: "rig:set", rig: { queue: [...state.rig.queue, id] } });

function renderNames() {
  const wrap = $("names");
  wrap.innerHTML = "";
  const chosen = chosenId();
  if (!state.entries.length) {
    wrap.innerHTML = '<div class="hint">Add entries in Edit wheel first.</div>';
    return;
  }

  state.entries.forEach((entry, i) => {
    const btn = document.createElement("button");
    btn.className = "name";
    if (entry.id === chosen) btn.classList.add("chosen");
    if (state.rig.blacklist.includes(entry.id)) btn.classList.add("never");

    const bar = document.createElement("span");
    bar.className = "bar";
    bar.style.background = entry.color;
    const txt = document.createElement("span");
    txt.className = "txt";
    txt.textContent = entry.label;
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.textContent = "★";
    btn.append(bar, txt, mark);

    const qPos = state.rig.queue.indexOf(entry.id);
    if (qPos > 0 || (qPos === 0 && entry.id !== chosen)) {
      const badge = document.createElement("span");
      badge.className = "qpos";
      badge.textContent = `#${qPos + 1}`;
      badge.title = "Position in the line-up";
      btn.append(badge);
    }
    btn.title = i < 9 ? `Shortcut: key ${i + 1}` : "";

    let held = false;
    let timer = null;
    btn.addEventListener("pointerdown", () => {
      held = false;
      timer = setTimeout(() => {
        held = true;
        enqueue(entry.id);
        toast(`${entry.label} added to the line-up`);
      }, 600);
    });
    const cancel = () => clearTimeout(timer);
    btn.addEventListener("pointerup", cancel);
    btn.addEventListener("pointerleave", cancel);
    btn.addEventListener("pointercancel", cancel);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
    btn.addEventListener("click", (ev) => {
      if (held) return;
      ev.shiftKey ? enqueue(entry.id) : pick(entry.id);
    });
    wrap.append(btn);
  });
}

function renderQueue() {
  const q = $("queue");
  q.innerHTML = "";
  if (!state.rig.queue.length) {
    q.innerHTML = '<span class="hint">Nothing lined up.</span>';
    return;
  }
  state.rig.queue.forEach((id, i) => {
    const chip = document.createElement("span");
    chip.className = "qchip";
    const label = document.createElement("span");
    label.textContent = `${i + 1}. ${nameOf(id)}`;
    const x = document.createElement("button");
    x.textContent = "✕";
    x.title = "Remove from line-up";
    x.onclick = () => net.send({ t: "rig:set", rig: { queue: state.rig.queue.filter((_, j) => j !== i) } });
    chip.append(label, x);
    q.append(chip);
  });
}

function renderChances() {
  const list = $("advList");
  if (list.contains(document.activeElement) && document.activeElement.matches("input")) return;
  list.innerHTML = "";
  for (const entry of state.entries) {
    const row = document.createElement("div");
    row.className = "advrow";
    const label = document.createElement("span");
    label.textContent = entry.label;

    const weight = document.createElement("input");
    weight.type = "number";
    weight.min = "0";
    weight.step = "0.5";
    weight.value = state.rig.weights?.[entry.id] ?? 1;
    weight.title = "Chance (1 = normal)";
    weight.setAttribute("aria-label", `Chance for ${entry.label}`);
    weight.onchange = () =>
      net.send({ t: "rig:set", rig: { weights: { ...state.rig.weights, [entry.id]: Number(weight.value) } } });

    const never = document.createElement("button");
    const blocked = state.rig.blacklist.includes(entry.id);
    never.className = `btn small${blocked ? " on" : ""}`;
    never.textContent = blocked ? "Can’t win" : "Can win";
    never.title = blocked ? "Click to let it win again" : "Click to stop it winning";
    never.onclick = () => {
      const bl = new Set(state.rig.blacklist);
      blocked ? bl.delete(entry.id) : bl.add(entry.id);
      net.send({ t: "rig:set", rig: { blacklist: [...bl] } });
    };
    row.append(label, weight, never);
    list.append(row);
  }
}

$("makeRandom").onclick = () => {
  net.send({ t: "rig:clear" });
  toast("Back to random: anyone can win");
};

$("alwaysOn").onchange = (e) => {
  const target = chosenId();
  if (e.target.checked && !target) {
    e.target.checked = false;
    toast("Tap an entry first, then turn this on");
    return;
  }
  net.send({ t: "rig:set", rig: { always: e.target.checked ? target : null, next: null } });
};

$("nearMiss").oninput = (e) => {
  $("nmVal").textContent = e.target.value;
  net.send({ t: "rig:set", rig: { nearMissPct: Number(e.target.value) } });
};

// ── look & sound ────────────────────────────────────────────────────────

function fillLook() {
  const s = state.settings;
  const set = (id, prop, value) => {
    if (document.activeElement !== $(id)) $(id)[prop] = value;
  };
  set("durMin", "value", s.durationMin / 1000);
  set("durMax", "value", s.durationMax / 1000);
  set("pointer", "value", s.pointer);
  set("removeWinner", "checked", s.removeWinner);
  set("confetti", "checked", s.confetti);
  set("sound", "checked", s.sound);
  set("tick", "checked", s.tick);
  set("volume", "value", s.volume);
  set("autohide", "value", s.autohideSec);
  set("popSounds", "checked", s.popSounds !== false);
  set("overlaySound", "checked", Boolean(s.overlaySound));
  $("autohideVal").textContent = s.autohideSec;
}

const sendSettings = (patch) => net.send({ t: "settings:set", settings: patch });

$("durMin").addEventListener("change", (e) => sendSettings({ durationMin: Number(e.target.value) * 1000 }));
$("durMax").addEventListener("change", (e) => sendSettings({ durationMax: Number(e.target.value) * 1000 }));
$("pointer").addEventListener("change", (e) => sendSettings({ pointer: e.target.value }));
for (const id of ["removeWinner", "confetti", "sound", "tick", "popSounds", "overlaySound"]) {
  $(id).addEventListener("change", (e) => sendSettings({ [id]: e.target.checked }));
}
$("volume").addEventListener("change", (e) => sendSettings({ volume: Number(e.target.value) }));
$("autohide").addEventListener("input", (e) => ($("autohideVal").textContent = e.target.value));
$("autohide").addEventListener("change", (e) => sendSettings({ autohideSec: Number(e.target.value) }));

// A local preview of every sound, at the current volume, without spinning the real wheel.
const preview = createSound();
const previewBubbles = createBubbles($("bubbles"), { onPop: (r) => preview.pop(r) });
$("soundTest").addEventListener("click", async () => {
  preview.setVolume(state.settings.volume);
  preview.enabled = true;
  await preview.ready();
  preview.whoosh();
  [0, 120, 260, 420, 620, 860, 1150].forEach((ms) => setTimeout(() => preview.tick(), 500 + ms));
  setTimeout(() => {
    preview.fanfare();
    previewBubbles.celebrate(90);
  }, 2000);
});

$("logoPick").addEventListener("click", () => $("logoFile").click());
$("logoFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    const dataUrl = await shrinkImage(file, 512);
    const res = await fetch("/api/logo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl }),
    });
    const out = await res.json().catch(() => ({}));
    toast(res.ok ? "Logo updated" : out.error || "Upload failed");
  } catch {
    toast("That file could not be read as an image");
  }
});
$("logoReset").addEventListener("click", async () => {
  const res = await fetch("/api/logo", { method: "DELETE" });
  toast(res.ok ? "Back to the default logo" : "Could not reset the logo");
});

/** Scale big images down so uploads stay small and the wheel stays smooth in OBS. */
function shrinkImage(file, max) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("not an image"));
    };
    img.src = url;
  });
}

// ── stream / OBS ────────────────────────────────────────────────────────

function renderOverlayUrl() {
  const params = new URLSearchParams({ key: state.overlayKey });
  if ($("idleHide").checked) params.set("idle", "hide");
  const url = `${location.origin}/overlay?${params}`;
  $("ovUrl").textContent = url;
  $("openOverlay").href = url;
}
$("idleHide").addEventListener("change", renderOverlayUrl);

$("copyUrl").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("ovUrl").textContent);
    toast("OBS link copied");
  } catch {
    prompt("Copy this link:", $("ovUrl").textContent);
  }
};

const setOverlay = (patch) => net.send({ t: "overlay:set", overlay: patch });
$("ovShow").onclick = () => setOverlay({ visible: true });
$("ovHide").onclick = () => setOverlay({ visible: false });
$("ovVisible").onchange = (e) => setOverlay({ visible: e.target.checked });
$("ovTitleOn").onchange = (e) => setOverlay({ showTitle: e.target.checked });
$("ovTest").onclick = () => {
  net.send({ t: "overlay:test", label: "TEST WINNER" });
  toast("Test popup sent to the overlay");
};

// ── history ─────────────────────────────────────────────────────────────

function renderHistory() {
  const list = $("historyList");
  list.innerHTML = "";
  if (!state.history.length) {
    list.innerHTML = '<div class="hint">Nothing spun yet.</div>';
    return;
  }
  for (const h of state.history) {
    const row = document.createElement("div");
    row.className = "item";
    const name = document.createElement("span");
    name.className = "grow";
    name.textContent = h.label;
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = h.rigged ? "picked" : "";
    const time = document.createElement("span");
    time.className = "hint";
    time.textContent = new Date(h.ts).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    row.append(name, tag, time);
    list.append(row);
  }
}

$("clearHistory").onclick = () => {
  if (confirm("Clear the list of past winners?")) net.send({ t: "history:clear" });
};

// ── spin, tabs, shortcuts ───────────────────────────────────────────────

$("spinBtn").onclick = () => net.send({ t: "spin" });
$("wheel").addEventListener("click", () => net.send({ t: "spin" }));

for (const tab of document.querySelectorAll(".dash-panel .tab")) {
  tab.addEventListener("click", () => {
    for (const t of document.querySelectorAll(".dash-panel .tab")) t.setAttribute("aria-selected", String(t === tab));
    for (const p of document.querySelectorAll(".dash-panel .tabpanel")) {
      p.classList.toggle("active", p.dataset.panel === tab.dataset.tab);
    }
  });
}

document.addEventListener("keydown", (e) => {
  // buttons too: Space on a focused button already clicks it
  if (e.target.matches("input, textarea, select, button, a")) return;
  if (e.code === "Space") {
    e.preventDefault();
    net.send({ t: "spin" });
    return;
  }
  if (e.code === "Escape") {
    net.send({ t: "rig:clear" });
    toast("Back to random: anyone can win");
    return;
  }
  const n = Number(e.key);
  if (n >= 1 && n <= 9 && state?.entries[n - 1]) pick(state.entries[n - 1].id);
});

let toastTimer = null;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}
