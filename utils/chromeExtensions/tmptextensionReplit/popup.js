/**
 * Ticketmaster+ Cookie Harvester v5.23.25 - Popup Controller
 */

const D = {
  startBtn:    document.getElementById("start-btn"),
  stopBtn:     document.getElementById("stop-btn"),
  copyBtn:     document.getElementById("copy-btn"),
  exportBtn:   document.getElementById("export-btn"),
  clearBtn:    document.getElementById("clear-btn"),
  copyLogBtn:  document.getElementById("copy-log-btn"),
  clearLogBtn: document.getElementById("clear-log-btn"),
  logBody:     document.getElementById("log-b"),
  logMeta:     document.getElementById("log-m"),
  bankBody:    document.getElementById("bank-b"),
  bankMeta:    document.getElementById("bank-m"),
  tgtInput:    document.getElementById("tgt"),
  toastEl:     document.getElementById("toast"),
  statusBar:   document.getElementById("status-bar"),
  pillText:    document.getElementById("pill-t"),
  bankC:       document.getElementById("bank-c"),
  mRate:       document.getElementById("m-rate"),
  mEta:        document.getElementById("m-eta"),
  mElapsed:    document.getElementById("m-elapsed"),
  mCycles:     document.getElementById("m-cycles"),
  iconRate:    document.getElementById("icon-rate"),
  iconEta:     document.getElementById("icon-eta"),
  iconElapsed: document.getElementById("icon-elapsed"),
  iconCycles:  document.getElementById("icon-cycles"),
  pctEl:       document.getElementById("pct"),
  fill:        document.getElementById("fill"),
  pLeft:       document.getElementById("p-left"),
  pRight:      document.getElementById("p-right"),
  sOk:         document.getElementById("s-ok"),
  sDup:        document.getElementById("s-dup"),
  sFail:       document.getElementById("s-fail"),
};

let bank = [], logs = [], running = false, startedAt = null;
let rafId = null;

let toastTimer;
function toast(msg, type = "") {
  clearTimeout(toastTimer);
  const el = D.toastEl;
  el.textContent = msg;
  el.className = "toast show" + (type ? " " + type : "");
  toastTimer = setTimeout(() => { el.className = "toast"; }, 2600);
}

function fmt(s) {
  if (!s || s <= 0) return "—";
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60), r = s % 60;
  if (m >= 60) return Math.floor(m / 60) + "h" + (m % 60) + "m";
  return r > 0 ? m + "m" + r + "s" : m + "m";
}

function tickElapsed() {
  if (!startedAt) {
    D.mElapsed.textContent = "—";
    D.mElapsed.className = "mv";
    D.iconElapsed.className = "mc-icon";
    if (running) rafId = requestAnimationFrame(tickElapsed);
    return;
  }
  D.mElapsed.textContent = fmt(Math.round((Date.now() - startedAt) / 1000));
  D.mElapsed.className = "mv lit";
  D.iconElapsed.className = "mc-icon active";
  if (running) rafId = requestAnimationFrame(tickElapsed);
}

function startElapsedRaf() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tickElapsed);
}

function stopElapsedRaf() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  tickElapsed();
}

const STATUS_CLASSES = ["st-idle", "st-run", "st-done", "st-banked", "st-error"];
function setStatus(cls, label) {
  const bar = D.statusBar;
  STATUS_CLASSES.forEach(c => bar.classList.remove(c));
  bar.classList.add(cls);
  D.pillText.textContent = label;
}

function classify(t) {
  if (/🔑|#\d+/.test(t)) return "found";
  if (/❌|halted|lost|closed|⏹/.test(t)) return "err";
  if (/⚠️|♻️|timeout|miss|dup/i.test(t)) return "fail";
  if (/🚀|📦|🔗|target|start/i.test(t)) return "hl";
  if (/──/.test(t)) return "cycle";
  if (/━/.test(t)) return "sep";
  return "info";
}

function renderLog(entries) {
  const slice = entries.slice(-120);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < slice.length; i++) {
    const d = document.createElement("div");
    d.className = "le " + classify(slice[i]);
    d.textContent = slice[i];
    frag.appendChild(d);
  }
  D.logBody.replaceChildren(frag);
  D.logMeta.textContent = entries.length + " entries";
  D.logBody.scrollTop = D.logBody.scrollHeight;
}

function renderBank(cookies) {
  D.bankMeta.textContent = cookies.length + " stored";
  if (!cookies.length) {
    D.bankBody.innerHTML = '<div class="bank-empty">No cookies yet</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  for (let i = cookies.length - 1; i >= 0; i--) {
    const d = document.createElement("div");
    d.className = "be";
    d.title = cookies[i];
    const idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = "#" + (i + 1);
    const val = document.createElement("span");
    val.className = "val";
    val.textContent = cookies[i].substring(0, 54) + "…";
    d.appendChild(idx);
    d.appendChild(val);
    frag.appendChild(d);
  }
  D.bankBody.replaceChildren(frag);
}

function render(s) {
  if (!s) return;

  running = !!s.running;
  bank    = s.bank || [];
  logs    = s.logs || [];
  startedAt = s.startedAt || null;

  D.bankC.textContent = bank.length;

  if (s.error) {
    setStatus("st-error", "ERROR");
  } else if (s.completed) {
    setStatus("st-done", "DONE · " + bank.length);
  } else if (s.running) {
    setStatus("st-run", "HARVESTING · " + bank.length + "/" + s.total);
  } else if (bank.length > 0) {
    setStatus("st-banked", bank.length + " BANKED");
  } else {
    setStatus("st-idle", "READY");
  }

  const hasRate = s.rate > 0;
  D.mRate.textContent = hasRate ? s.rate : "—";
  D.mRate.className = hasRate ? "mv grn" : "mv";
  D.iconRate.className = "mc-icon" + (hasRate ? " active" : "");

  const hasEta = s.eta > 0;
  D.mEta.textContent = hasEta ? fmt(s.eta) : "—";
  D.mEta.className = hasEta ? "mv lit" : "mv";
  D.iconEta.className = "mc-icon" + (hasEta ? " active" : "");

  const cy = s.current || 0;
  D.mCycles.textContent = cy;
  D.mCycles.className = cy > 0 ? "mv cyn" : "mv";
  D.iconCycles.className = "mc-icon" + (cy > 0 ? " active" : "");

  if (running) {
    startElapsedRaf();
  } else {
    stopElapsedRaf();
  }

  const total = s.total || 100;
  const pct = Math.min(Math.round((bank.length / total) * 100), 100);
  D.fill.style.width = pct + "%";
  D.fill.className = "prog-fill" + (s.completed && !s.error ? " done" : "");
  D.pctEl.textContent = pct + "%";
  D.pLeft.textContent = bank.length + " / " + total;
  D.pRight.textContent = s.lastCookieAt
    ? "Last: " + Math.round((Date.now() - s.lastCookieAt) / 1000) + "s ago"
    : "—";

  D.sOk.textContent   = s.successCount || 0;
  D.sDup.textContent  = s.dupCount || 0;
  D.sFail.textContent = s.failCount || 0;

  D.startBtn.classList.toggle("hidden", running);
  D.startBtn.disabled = false;
  D.stopBtn.classList.toggle("hidden", !running);
  D.tgtInput.disabled = running;

  renderLog(logs);
  renderBank(bank);
}

function send(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, resp => {
      if (chrome.runtime.lastError) { resolve(null); return; }
      resolve(resp);
    });
  });
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === "progress") render(msg);
});

D.startBtn.addEventListener("click", async () => {
  const target = Math.max(1, Math.min(5000, parseInt(D.tgtInput.value, 10) || 100));
  D.tgtInput.value = target;
  D.startBtn.disabled = true;
  const resp = await send({ type: "start", target });
  if (!resp || !resp.ok) {
    toast(resp?.error || "Failed to start", "err");
    D.startBtn.disabled = false;
  }
});

D.stopBtn.addEventListener("click", async () => {
  D.stopBtn.disabled = true;
  D.stopBtn.textContent = "⏳ STOPPING…";
  await send({ type: "stop" });
  running = false;
  D.startBtn.classList.remove("hidden");
  D.startBtn.disabled = false;
  D.stopBtn.classList.add("hidden");
  D.stopBtn.disabled = false;
  D.stopBtn.textContent = "■ STOP";
  D.tgtInput.disabled = false;
  stopElapsedRaf();
});

D.copyBtn.addEventListener("click", () => {
  if (!bank.length) { toast("Bank is empty", "warn"); return; }
  navigator.clipboard.writeText(JSON.stringify({
    tmpt_cookie: bank[0],
    tmpt_cookie_bank: bank,
    _generated: new Date().toISOString(),
    _count: bank.length,
    _version: "v5.23.25",
    _info: "Paste into config.json → auto_reserve",
  }, null, 2)).then(() => toast("✓ " + bank.length + " cookies copied"));
});

D.exportBtn.addEventListener("click", () => {
  if (!bank.length) { toast("Bank is empty", "warn"); return; }
  const payload = JSON.stringify({
    _info: "Ticketmaster+ tmpt bank",
    _version: "v5.23.25",
    _generated: new Date().toISOString(),
    _count: bank.length,
    tmpt_cookie: bank[0],
    tmpt_cookie_bank: bank,
  }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "tmpt_bank_" + bank.length + "_" + Date.now() + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("✓ Exported " + bank.length + " cookies");
});

const injectBtn = document.getElementById("inject-btn");
injectBtn.addEventListener("click", async () => {
  if (!bank.length) { toast("Bank is empty", "warn"); return; }
  try {
    const resp = await fetch("http://127.0.0.1:18731/inject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cookies: bank }),
    });
    const data = await resp.json();
    if (data.ok) {
      toast("✓ Injected " + data.added + " · bank: " + data.total_bank);
    } else {
      toast(data.error || "Inject failed", "err");
    }
  } catch (e) {
    toast("Server offline — start TM+", "err");
  }
});

D.clearBtn.addEventListener("click", async () => {
  if (running) { toast("⚠ Stop harvest first", "warn"); return; }
  await send({ type: "clearBank" });
  toast("✓ Bank cleared");
});

D.copyLogBtn.addEventListener("click", () => {
  if (!logs.length) { toast("Log is empty", "warn"); return; }
  navigator.clipboard.writeText(logs.join("\n"))
    .then(() => toast("✓ " + logs.length + " log entries copied"));
});

D.clearLogBtn.addEventListener("click", async () => {
  await send({ type: "clearLogs" });
  toast("✓ Logs cleared");
});

(async () => {
  const s = await send({ type: "getState" });
  if (s) {
    render(s);
    if (s.total) D.tgtInput.value = s.total;
  }
})();