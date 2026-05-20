/**
 * Ticketmaster+ Cookie Harvester v5.23.25 - Popup Controller
 */
const $ = id => document.getElementById(id);

const startBtn    = $("start-btn"), stopBtn = $("stop-btn");
const copyBtn     = $("copy-btn"), exportBtn = $("export-btn"), clearBtn = $("clear-btn");
const copyLogBtn  = $("copy-log-btn"), clearLogBtn = $("clear-log-btn");
const logBody     = $("log-b"), logMeta = $("log-m");
const bankBody    = $("bank-b"), bankMeta = $("bank-m");
const tgtInput    = $("tgt"), toastEl = $("toast");
const pill        = $("pill"), dot = $("dot"), pillText = $("pill-t");
const bankC       = $("bank-c");
const mRate       = $("m-rate"), mEta = $("m-eta"), mElapsed = $("m-elapsed"), mCycles = $("m-cycles");
const pctEl       = $("pct"), fill = $("fill"), pLeft = $("p-left"), pRight = $("p-right");
const sOk         = $("s-ok"), sDup = $("s-dup"), sFail = $("s-fail");

let bank = [], logs = [], running = false, startedAt = null, etTimer = null;

let tt;
function toast(m) {
  clearTimeout(tt);
  toastEl.textContent = m;
  toastEl.classList.add("show");
  tt = setTimeout(() => toastEl.classList.remove("show"), 2500);
}

function fmt(s) {
  if (!s || s <= 0) return "—";
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60), r = s % 60;
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60}m` : r > 0 ? `${m}m${r}s` : `${m}m`;
}

function tickElapsed() {
  if (!startedAt) { mElapsed.textContent = "—"; mElapsed.className = "mv dim"; return; }
  mElapsed.textContent = fmt(Math.round((Date.now() - startedAt) / 1000));
  mElapsed.className = "mv on";
}

function render(s) {
  if (!s) return;
  running = !!s.running;
  bank = s.bank || [];
  logs = s.logs || [];
  startedAt = s.startedAt;

  bankC.textContent = bank.length;

  if (s.error) {
    pill.className = "pill error"; dot.className = "dot error";
    pillText.textContent = "Error";
  } else if (s.completed) {
    pill.className = "pill done"; dot.className = "dot done";
    pillText.textContent = `Done · ${bank.length}`;
  } else if (s.running) {
    pill.className = "pill run"; dot.className = "dot run";
    pillText.textContent = `Harvesting · ${bank.length}/${s.total}`;
  } else if (bank.length > 0) {
    pill.className = "pill banked"; dot.className = "dot banked";
    pillText.textContent = `${bank.length} banked`;
  } else {
    pill.className = "pill idle"; dot.className = "dot idle";
    pillText.textContent = "Ready";
  }

  mRate.textContent = s.rate > 0 ? s.rate : "—";
  mRate.className = s.rate > 0 ? "mv on" : "mv dim";
  mEta.textContent = s.eta > 0 ? fmt(s.eta) : "—";
  mEta.className = s.eta > 0 ? "mv" : "mv dim";
  tickElapsed();
  const cy = s.current || 0;
  mCycles.textContent = cy;
  mCycles.className = cy > 0 ? "mv on" : "mv dim";

  if (running && !etTimer) etTimer = setInterval(tickElapsed, 1000);
  else if (!running && etTimer) { clearInterval(etTimer); etTimer = null; }

  const total = s.total || 100;
  const pct = Math.min(Math.round((bank.length / total) * 100), 100);
  fill.style.width = pct + "%";
  fill.className = (s.completed && !s.error) ? "prog-f ok" : "prog-f";
  pctEl.textContent = pct + "%";
  pLeft.textContent = `${bank.length} / ${total}`;
  pRight.textContent = s.lastCookieAt
    ? `Last: ${Math.round((Date.now() - s.lastCookieAt) / 1000)}s ago`
    : "—";

  sOk.textContent = s.successCount || 0;
  sDup.textContent = s.dupCount || 0;
  sFail.textContent = s.failCount || 0;

  startBtn.classList.toggle("hidden", running);
  startBtn.disabled = false;
  stopBtn.classList.toggle("hidden", !running);
  tgtInput.disabled = running;

  renderLog(logs);
  renderBank(bank);
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
  const frag = document.createDocumentFragment();
  logBody.innerHTML = "";
  for (const e of entries.slice(-120)) {
    const d = document.createElement("div");
    d.className = "le " + classify(e);
    d.textContent = e;
    frag.appendChild(d);
  }
  logBody.appendChild(frag);
  logMeta.textContent = entries.length + " entries";
  logBody.scrollTop = logBody.scrollHeight;
}

function renderBank(cookies) {
  bankBody.innerHTML = "";
  bankMeta.textContent = cookies.length + " stored";
  if (!cookies.length) {
    bankBody.innerHTML = '<div class="bank-empty">No cookies yet</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  for (let i = cookies.length - 1; i >= 0; i--) {
    const d = document.createElement("div");
    d.className = "be";
    d.innerHTML = `<span class="idx">#${i + 1}</span><span class="val">${cookies[i].substring(0, 52)}…</span>`;
    d.title = cookies[i];
    frag.appendChild(d);
  }
  bankBody.appendChild(frag);
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

startBtn.addEventListener("click", async () => {
  const target = Math.max(1, Math.min(5000, parseInt(tgtInput.value) || 100));
  tgtInput.value = target;
  startBtn.disabled = true;
  const resp = await send({ type: "start", target });
  if (!resp || !resp.ok) {
    toast(resp?.error || "Failed to start");
    startBtn.disabled = false;
  }
});

stopBtn.addEventListener("click", async () => {
  stopBtn.disabled = true;
  stopBtn.textContent = "⏳ Stopping...";
  await send({ type: "stop" });
  running = false;
  startBtn.classList.remove("hidden");
  startBtn.disabled = false;
  stopBtn.classList.add("hidden");
  stopBtn.disabled = false;
  stopBtn.textContent = "■ Stop";
  tgtInput.disabled = false;
});

copyBtn.addEventListener("click", () => {
  if (!bank.length) { toast("Bank is empty"); return; }
  navigator.clipboard.writeText(JSON.stringify({
    tmpt_cookie: bank[0], tmpt_cookie_bank: bank,
    _generated: new Date().toISOString(), _count: bank.length,
    _version: "v5.23.25", _info: "Paste into config.json → auto_reserve",
  }, null, 2)).then(() => toast(`✓ ${bank.length} cookies copied`));
});

exportBtn.addEventListener("click", () => {
  if (!bank.length) { toast("Bank is empty"); return; }
  const b = new Blob([JSON.stringify({
    _info: "Ticketmaster+ tmpt bank", _version: "v5.23.25",
    _generated: new Date().toISOString(), _count: bank.length,
    tmpt_cookie: bank[0], tmpt_cookie_bank: bank,
  }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b);
  a.download = `tmpt_bank_${bank.length}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`✓ Exported ${bank.length} cookies`);
});

const injectBtn = $("inject-btn");
injectBtn.addEventListener("click", async () => {
  if (!bank.length) { toast("Bank is empty"); return; }
  try {
    const resp = await fetch("http://127.0.0.1:18731/inject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cookies: bank }),
    });
    const data = await resp.json();
    if (data.ok) {
      toast(`✓ Injected ${data.added} · bank: ${data.total_bank}`);
    } else {
      toast(data.error || "Inject failed");
    }
  } catch (e) {
    toast("Server offline — start Ticketmaster+");
  }
});

clearBtn.addEventListener("click", async () => {
  if (running) { toast("⚠ Stop harvest first"); return; }
  await send({ type: "clearBank" });
  toast("✓ Bank cleared");
});

copyLogBtn.addEventListener("click", () => {
  if (!logs.length) { toast("Log is empty"); return; }
  navigator.clipboard.writeText(logs.join("\n"))
    .then(() => toast(`✓ ${logs.length} log entries copied`));
});

clearLogBtn.addEventListener("click", async () => {
  await send({ type: "clearLogs" });
  toast("✓ Logs cleared");
});

(async () => {
  const s = await send({ type: "getState" });
  if (s) {
    render(s);
    if (s.total) tgtInput.value = s.total;
  }
})();
