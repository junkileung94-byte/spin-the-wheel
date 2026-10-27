// Operator panel. The only page that ever sees who is going to win.
//
// Design rule for this page: the three things done mid-stream — see who wins, pick who wins,
// spin — are the only things above the fold, in plain words, at thumb size. Everything else
// lives behind "Grown-up settings".
import { connect } from "./net.js";

const $ = (id) => document.getElementById(id);

let state = null;
let entriesDirty = false;
let wonTimer = null;

const net = connect({
  onStatus(s) {
    $("dot").className = `dot ${s === "open" ? "on" : "off"}`;
    $("statusText").textContent = s === "open" ? "live" : "reconnecting…";
  },
});

net.on((msg) => {
  if (msg.t === "welcome" || msg.t === "state") {
    if (msg.role === "public") {
      location.href = "/login"; // cookie expired between page load and socket connect
      return;
    }
    apply(msg.state);
  } else if (msg.t === "settled" && !msg.test) {
    celebrate(msg.label);
  } else if (msg.t === "toast") {
    toast(msg.text);
  }
});

// ── the banner: who wins, in one sentence ───────────────────────────────

const nameOf = (id) => state?.entries.find((e) => e.id === id)?.label || "someone who left";

function bannerCopy() {
  const r = state.rig;
  if (r.queue.length) {
    return {
      cls: "picked",
      kicker: "Next up",
      text: `${nameOf(r.queue[0])} wins next${r.queue.length > 1 ? `, then ${r.queue.length - 1} more` : ""}`,
    };
  }
  if (r.next) return { cls: "picked", kicker: "Next spin", text: `${nameOf(r.next)} will win` };
  if (r.always) return { cls: "picked", kicker: "Locked", text: `${nameOf(r.always)} wins every spin` };
  const weighted = Object.values(r.weights || {}).some((w) => Number(w) !== 1);
  if (weighted) return { cls: "picked", kicker: "Right now", text: "Some names have better chances" };
  if (r.blacklist.length) {
    return { cls: "picked", kicker: "Right now", text: `${r.blacklist.length} name(s) can’t win` };
  }
  return { cls: "fair", kicker: "Right now", text: "Anyone can win" };
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

  paintBanner();
  $("spinBtn").disabled = state.spinning || state.entries.length < 2;
  $("spinBtn").textContent = state.spinning ? "SPINNING…" : "SPIN THE WHEEL";

  renderNames();
  renderQueue();
  renderAdvanced();
  renderHistory();

  $("alwaysOn").checked = Boolean(state.rig.always);
  $("nearMiss").value = state.rig.nearMissPct || 0;
  $("nmVal").textContent = state.rig.nearMissPct || 0;

  if (!entriesDirty && document.activeElement !== $("entries")) {
    $("entries").value = state.entries.map((e) => e.label).join("\n");
  }
  $("count").textContent = `${state.entries.length} names`;

  const c = state.clients || {};
  $("clients").textContent = `Connected: ${c.public || 0} wheel · ${c.overlay || 0} overlay · ${c.control || 0} control`;

  if (first) {
    const url = `${location.origin}/overlay?key=${encodeURIComponent(state.overlayKey)}`;
    $("ovUrl").textContent = url;
    $("openOverlay").href = url;
  }
}

// ── pick a name ─────────────────────────────────────────────────────────

/**
 * The one name that actually wins the next spin — same precedence the server uses.
 * The star and the banner both read from this, so the page can never show two answers
 * to "who wins next?".
 */
function chosenId() {
  const r = state.rig;
  return r.queue[0] ?? r.next ?? r.always ?? null;
}

function pick(id) {
  const r = state.rig;

  // tapping the currently-chosen name always means "undo"
  if (chosenId() === id) {
    net.send({ t: "rig:set", rig: { next: null, always: null, queue: r.queue.filter((q) => q !== id) } });
    return;
  }

  // a queued order would outrank this tap and the star would lie about it, so the tap wins
  if (r.queue.length) toast("Order cleared — this name wins next");

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

    // names waiting further back in the order get a position number, not a star —
    // only one name at a time may look like "this one wins next"
    const qPos = state.rig.queue.indexOf(entry.id);
    if (qPos > 0 || (qPos === 0 && entry.id !== chosen)) {
      const badge = document.createElement("span");
      badge.className = "qpos";
      badge.textContent = `#${qPos + 1}`;
      badge.title = "Position in the order";
      btn.append(badge);
    }
    btn.title = i < 9 ? `Key ${i + 1}` : "";

    // tap = pick · shift-click or long-press = add to the queue
    let held = false;
    let timer = null;
    btn.addEventListener("pointerdown", () => {
      held = false;
      timer = setTimeout(() => {
        held = true;
        enqueue(entry.id);
        toast(`${entry.label} added to the order`);
      }, 600);
    });
    const cancel = () => clearTimeout(timer);
    btn.addEventListener("pointerup", cancel);
    btn.addEventListener("pointerleave", cancel);
    btn.addEventListener("pointercancel", cancel);
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
    q.innerHTML = '<span class="hint">Empty — spins are honest unless a name is picked above.</span>';
    return;
  }
  state.rig.queue.forEach((id, i) => {
    const chip = document.createElement("span");
    chip.className = "qchip";
    const label = document.createElement("span");
    label.textContent = `${i + 1}. ${nameOf(id)}`;
    const x = document.createElement("button");
    x.textContent = "✕";
    x.title = "Remove";
    x.onclick = () => net.send({ t: "rig:set", rig: { queue: state.rig.queue.filter((_, j) => j !== i) } });
    chip.append(label, x);
    q.append(chip);
  });
}

// ── advanced: chances + never-win ───────────────────────────────────────

function renderAdvanced() {
  const list = $("advList");
  if (!$("adv").open && list.childElementCount) return; // don't churn while collapsed
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
    weight.onchange = () =>
      net.send({ t: "rig:set", rig: { weights: { ...state.rig.weights, [entry.id]: Number(weight.value) } } });

    const never = document.createElement("button");
    const blocked = state.rig.blacklist.includes(entry.id);
    never.className = "btn small";
    never.textContent = blocked ? "can win" : "never wins";
    never.onclick = () => {
      const bl = new Set(state.rig.blacklist);
      blocked ? bl.delete(entry.id) : bl.add(entry.id);
      net.send({ t: "rig:set", rig: { blacklist: [...bl] } });
    };

    row.append(label, weight, never);
    list.append(row);
  }
}

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
    time.textContent = new Date(h.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    row.append(name, tag, time);
    list.append(row);
  }
}

// ── buttons ─────────────────────────────────────────────────────────────

$("spinBtn").onclick = () => net.send({ t: "spin" });

$("makeRandom").onclick = () => {
  net.send({ t: "rig:clear" });
  toast("Back to honest — anyone can win");
};

$("ovShow").onclick = () => net.send({ t: "overlay:set", overlay: { visible: true } });
$("ovHide").onclick = () => net.send({ t: "overlay:set", overlay: { visible: false } });
$("ovTitleToggle").onclick = () =>
  net.send({ t: "overlay:set", overlay: { showTitle: !(state.overlay.showTitle !== false) } });
$("ovTest").onclick = () => net.send({ t: "overlay:test", label: "TEST WINNER" });

$("alwaysOn").onchange = (e) => {
  const target = state.rig.next || state.rig.always || state.entries[0]?.id || null;
  net.send({ t: "rig:set", rig: { always: e.target.checked ? target : null, next: null } });
};

$("nearMiss").oninput = (e) => {
  $("nmVal").textContent = e.target.value;
  net.send({ t: "rig:set", rig: { nearMissPct: Number(e.target.value) } });
};

$("copyUrl").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("ovUrl").textContent);
    toast("Overlay URL copied");
  } catch {
    prompt("Copy this URL:", $("ovUrl").textContent);
  }
};

$("clearHistory").onclick = () => net.send({ t: "history:clear" });
$("adv").addEventListener("toggle", () => $("adv").open && renderAdvanced());

$("entries").addEventListener("input", () => {
  entriesDirty = true;
  $("count").textContent = `${$("entries").value.split("\n").filter((s) => s.trim()).length} names`;
});

$("pushEntries").onclick = () => {
  const labels = $("entries").value.split("\n").map((s) => s.trim()).filter(Boolean);
  const byLabel = new Map(state.entries.map((e) => [e.label, e]));
  net.send({
    t: "entries:set",
    entries: labels.map((label) => {
      const prev = byLabel.get(label);
      return prev ? { id: prev.id, label, color: prev.color } : { label };
    }),
  });
  entriesDirty = false;
  toast("Names saved");
};

// ── hotkeys ─────────────────────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea")) return;
  if (e.code === "Space") {
    e.preventDefault();
    net.send({ t: "spin" });
    return;
  }
  if (e.code === "Escape" || e.key.toLowerCase() === "p") {
    net.send({ t: "rig:clear" });
    toast("Back to honest — anyone can win");
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
