/**
 * Ticketmaster+ Cookie Harvester v5.23.25 - Popup Controller
 */
"use strict";

const $ = (id) => document.getElementById(id);

const el = {
  start: $("start-btn"), stop: $("stop-btn"),
  copy: $("copy-btn"), exp: $("export-btn"), clear: $("clear-btn"),
  copyLog: $("copy-log-btn"), clearLog: $("clear-log-btn"),
  logBody: $("log-b"), logMeta: $("log-m"),
  bankBody: $("bank-b"), bankMeta: $("bank-m"),
  tgt: $("tgt"), toast: $("toast"),
  dot: $("dot"), pillText: $("pill-t"),
  bankC: $("bank-c"),
  rate: $("m-rate"), eta: $("m-eta"), elapsed: $("m-elapsed"), cycles: $("m-cycles"),
  pct: $("pct"), fill: $("fill"), pLeft: $("p-left"), pRight: $("p-right"),
  sOk: $("s-ok"), sDup: $("s-dup"), sFail: $("s-fail"),
};

let state = { bank: [], logs: [], running: false, startedAt: null };
let renderedLogLen = 0;
let renderedBankLen = -1;
let etTimer = null;
let pendingRaf = 0;
let lastState = null;

let toastTimer;
function toast(m, kind) {
  clearTimeout(toastTimer);
  el.toast.textContent = m;
  el.toast.className = "toast show" + (kind ? " " + kind : "");
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2400);
}

function fmt(s) {
  if (!s || s <= 0) return "—";
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60), r = s % 60;
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60}m` : r > 0 ? `${m}m${r}s` : `${m}m`;
}

function tickElapsed() {
  if (!state.startedAt) {
    el.elapsed.textContent = "—";
    el.elapsed.className = "mv dim";
    return;
  }
  el.elapsed.textContent = fmt(Math.round((Date.now() - state.startedAt) / 1000));
  el.elapsed.className = "mv";
}

function classify(t) {
  if (t.indexOf("🔑") !== -1) return "found";
  if (/❌|halted|lost|closed|⏹/.test(t)) return "err";
  if (/⚠️|♻️|timeout/i.test(t)) return "fail";
  if (/🚀|📦|🔗|✅|target|start/i.test(t)) return "hl";
  if (t.indexOf("──") !== -1) return "cycle";
  if (t.indexOf("━") !== -1) return "sep";
  return "info";
}

function renderLog(entries) {
  const total = entries.length;
  el.logMeta.textContent = total;

  const window = entries.slice(-120);
  const windowStart = total - window.length;

  if (total < renderedLogLen || windowStart > renderedLogLen) {
    el.logBody.textContent = "";
    renderedLogLen = windowStart;
  }

  while (el.logBody.children.length > window.length) {
    el.logBody.removeChild(el.logBody.firstChild);
  }

  const firstNew = Math.max(renderedLogLen, windowStart);
  if (firstNew < total) {
    const frag = document.createDocumentFragment();
    for (let i = firstNew; i < total; i++) {
      const txt = entries[i];
      const d = document.createElement("div");
      d.className = "le " + classify(txt);
      d.textContent = txt;
      frag.appendChild(d);
    }
    el.logBody.appendChild(frag);
  }
  renderedLogLen = total;
  el.logBody.scrollTop = el.logBody.scrollHeight;
}

function renderBank(cookies) {
  const n = cookies.length;
  el.bankMeta.textContent = n + " stored";
  if (n === renderedBankLen) return;

  if (!n) {
    el.bankBody.textContent = "";
    const d = document.createElement("div");
    d.className = "empty";
    d.textContent = "// no cookies yet";
    el.bankBody.appendChild(d);
    renderedBankLen = 0;
    return;
  }

  el.bankBody.textContent = "";
  const frag = document.createDocumentFragment();
  const limit = Math.min(n, 60);
  for (let i = 0; i < limit; i++) {
    const idx = n - i;
    const c = cookies[n - 1 - i];
    const d = document.createElement("div");
    d.className = "be";
    d.title = c;
    const ix = document.createElement("span");
    ix.className = "idx";
    ix.textContent = "#" + idx;
    const vl = document.createElement("span");
    vl.className = "val";
    vl.textContent = c.length > 52 ? c.substring(0, 52) + "…" : c;
    d.appendChild(ix);
    d.appendChild(vl);
    frag.appendChild(d);
  }
  el.bankBody.appendChild(frag);
  renderedBankLen = n;
}

function setPill(s) {
  let cls, label;
  if (s.error) { cls = "error"; label = "Error"; }
  else if (s.completed) { cls = "done"; label = `Done · ${s.bank.length}`; }
  else if (s.running) { cls = "run"; label = `Harvesting · ${s.bank.length}/${s.total}`; }
  else if (s.bank.length > 0) { cls = "banked"; label = `${s.bank.length} banked`; }
  else { cls = "idle"; label = "Ready"; }
  el.dot.className = "dot " + cls;
  el.pillText.textContent = label;
}

function render(s) {
  lastState = s;
  if (pendingRaf) return;
  pendingRaf = requestAnimationFrame(flush);
}

function flush() {
  pendingRaf = 0;
  const s = lastState;
  if (!s) return;

  state.running = !!s.running;
  state.bank = s.bank || [];
  state.logs = s.logs || [];
  state.startedAt = s.startedAt || null;
  state.total = s.total || 100;

  el.bankC.textContent = state.bank.length;
  setPill(s);

  const r = s.rate || 0;
  el.rate.textContent = r > 0 ? r : "—";
  el.rate.className = r > 0 ? "mv" : "mv dim";
  const eta = s.eta || 0;
  el.eta.textContent = eta > 0 ? fmt(eta) : "—";
  el.eta.className = eta > 0 ? "mv" : "mv dim";
  tickElapsed();
  const cy = s.current || 0;
  el.cycles.textContent = cy;
  el.cycles.className = cy > 0 ? "mv" : "mv dim";

  if (state.running && !etTimer) etTimer = setInterval(tickElapsed, 1000);
  else if (!state.running && etTimer) { clearInterval(etTimer); etTimer = null; }

  const total = state.total;
  const pct = Math.min(100, Math.round((state.bank.length / total) * 100));
  el.fill.style.width = pct + "%";
  el.fill.className = (s.completed && !s.error) ? "pg-f ok" : "pg-f";
  el.pct.textContent = pct + "%";
  el.pLeft.textContent = `${state.bank.length} / ${total}`;
  el.pRight.textContent = s.lastCookieAt
    ? `Last: ${Math.round((Date.now() - s.lastCookieAt) / 1000)}s ago`
    : "—";

  el.sOk.textContent = s.successCount || 0;
  el.sDup.textContent = s.dupCount || 0;
  el.sFail.textContent = s.failCount || 0;

  el.start.classList.toggle("hidden", state.running);
  el.start.disabled = false;
  el.stop.classList.toggle("hidden", !state.running);
  el.tgt.disabled = state.running;

  renderLog(state.logs);
  renderBank(state.bank);
}

function send(msg, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeoutMs);
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(resp);
      });
    } catch (_) { clearTimeout(t); resolve(null); }
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "progress") render(msg);
});

el.start.addEventListener("click", async () => {
  const raw = parseInt(el.tgt.value, 10);
  const target = Math.max(1, Math.min(5000, Number.isFinite(raw) ? raw : 100));
  el.tgt.value = target;
  el.start.disabled = true;
  const resp = await send({ type: "start", target });
  if (!resp || !resp.ok) {
    toast(resp?.error || "Failed to start", "err");
    el.start.disabled = false;
  }
});

el.stop.addEventListener("click", async () => {
  el.stop.disabled = true;
  el.stop.textContent = "⏳ Stopping…";
  await send({ type: "stop" });
  el.stop.disabled = false;
  el.stop.textContent = "■ Stop Harvest";
});

function bankPayload() {
  return {
    tmpt_cookie: state.bank[0],
    tmpt_cookie_bank: state.bank,
    _generated: new Date().toISOString(),
    _count: state.bank.length,
    _version: "v6.0.0",
    _info: "Paste into config.json → auto_reserve",
  };
}

el.copy.addEventListener("click", async () => {
  if (!state.bank.length) { toast("Bank is empty", "err"); return; }
  try {
    await navigator.clipboard.writeText(JSON.stringify(bankPayload(), null, 2));
    toast(`✓ ${state.bank.length} cookies copied`, "ok");
  } catch (_) { toast("Copy failed", "err"); }
});

el.exp.addEventListener("click", () => {
  if (!state.bank.length) { toast("Bank is empty", "err"); return; }
  try {
    const blob = new Blob([JSON.stringify(bankPayload(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tmpt_bank_${state.bank.length}_${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`✓ Exported ${state.bank.length}`, "ok");
  } catch (_) { toast("Export failed", "err"); }
});

const injectBtn = $("inject-btn");
injectBtn.addEventListener("click", async () => {
  if (!state.bank.length) { toast("Bank is empty", "err"); return; }
  try {
    const resp = await fetch("http://127.0.0.1:18731/inject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cookies: state.bank }),
    });
    const data = await resp.json();
    if (data.ok) {
      toast(`✓ Injected ${data.added} · bank: ${data.total_bank}`, "ok");
    } else {
      toast(data.error || "Inject failed", "err");
    }
  } catch (_) {
    toast("Server offline — start TM+", "err");
  }
});

el.clear.addEventListener("click", async () => {
  await send({ type: "clearBank" });
  toast("✓ Bank cleared", "ok");
});

el.copyLog.addEventListener("click", async () => {
  if (!state.logs.length) { toast("Log is empty", "err"); return; }
  try {
    await navigator.clipboard.writeText(state.logs.join("\n"));
    toast(`✓ ${state.logs.length} entries copied`, "ok");
  } catch (_) { toast("Copy failed", "err"); }
});

el.clearLog.addEventListener("click", async () => {
  await send({ type: "clearLogs" });
  toast("✓ Logs cleared", "ok");
});

el.tgt.addEventListener("blur", () => {
  const raw = parseInt(el.tgt.value, 10);
  el.tgt.value = Math.max(1, Math.min(5000, Number.isFinite(raw) ? raw : 100));
});

(async () => {
  const s = await send({ type: "getState" });
  if (s) {
    render(s);
    if (s.total) el.tgt.value = s.total;
  }
})();

window.addEventListener("unload", () => {
  if (etTimer) clearInterval(etTimer);
  if (pendingRaf) cancelAnimationFrame(pendingRaf);
});
