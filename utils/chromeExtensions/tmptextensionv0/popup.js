/**
 * Ticketmaster+ Cookie Harvester v5.23.25 - Popup Controller
 */
'use strict';

const D = {};

let bank = [];
let logs = [];
let running = false;
let startedAt = null;
let elapsedTimer = null;
let toastTimer = null;
let activePanel = 'log';

const RING_CIRCUMFERENCE = 2 * Math.PI * 36;

function initDOM() {
  const ids = [
    'statusPulse', 'statusLabel', 'statusBank',
    'ringFill', 'ringPct',
    'sRate', 'sEta', 'sElapsed', 'sCycles',
    'targetInput', 'startBtn', 'stopBtn',
    'infoLeft', 'infoRight',
    'logBadge', 'bankBadge',
    'panelLog', 'panelBank',
    'logMeta', 'logBody',
    'bankMeta', 'bankBody',
    'copyLogBtn', 'clearLogBtn',
    'copyBankBtn', 'exportBtn', 'clearBankBtn',
    'statOk', 'statDup', 'statFail',
    'toast'
  ];
  for (const id of ids) {
    D[id] = document.getElementById(id);
  }
  D.tabs = document.querySelectorAll('.feed-tab');
}

function toast(msg) {
  if (toastTimer) clearTimeout(toastTimer);
  D.toast.textContent = msg;
  D.toast.classList.add('show');
  toastTimer = setTimeout(() => D.toast.classList.remove('show'), 2200);
}

function fmtTime(sec) {
  if (!sec || sec <= 0) return '--';
  if (sec < 60) return sec + 's';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) return Math.floor(m / 60) + 'h' + (m % 60) + 'm';
  return s > 0 ? m + 'm' + s + 's' : m + 'm';
}

function updateElapsed() {
  if (!startedAt) {
    D.sElapsed.textContent = '--';
    D.sElapsed.className = 'ring-stat-val dim';
    return;
  }
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  D.sElapsed.textContent = fmtTime(elapsed);
  D.sElapsed.className = 'ring-stat-val on';
}

const LOG_PATTERNS = [
  [/🔑|#\d+/, 'found'],
  [/❌|halted|lost|closed|⏹/, 'err'],
  [/⚠️|♻️|timeout|miss|dup/i, 'fail'],
  [/🚀|📦|🔗|target|start/i, 'hl'],
  [/──/, 'cycle'],
  [/━/, 'sep']
];

function classifyLog(text) {
  for (const [rx, cls] of LOG_PATTERNS) {
    if (rx.test(text)) return cls;
  }
  return 'info';
}

function renderLog(entries) {
  const frag = document.createDocumentFragment();
  const display = entries.slice(-80);

  for (const e of display) {
    const div = document.createElement('div');
    div.className = 'log-e ' + classifyLog(e);
    div.textContent = e;
    frag.appendChild(div);
  }

  D.logBody.textContent = '';
  D.logBody.appendChild(frag);
  D.logMeta.textContent = entries.length + ' entries';
  D.logBadge.textContent = entries.length;

  requestAnimationFrame(() => {
    D.logBody.scrollTop = D.logBody.scrollHeight;
  });
}

function renderBank(cookies) {
  D.bankMeta.textContent = cookies.length + ' stored';
  D.bankBadge.textContent = cookies.length;

  if (!cookies.length) {
    D.bankBody.innerHTML = '<div class="bank-empty">No cookies harvested</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  const display = cookies.slice(-40);

  for (let i = display.length - 1; i >= 0; i--) {
    const idx = cookies.length - (display.length - 1 - i);
    const div = document.createElement('div');
    div.className = 'bank-e';
    div.innerHTML = '<span class="idx">#' + idx + '</span><span class="val">' + display[i].substring(0, 36) + '...</span>';
    div.title = display[i];
    frag.appendChild(div);
  }

  D.bankBody.textContent = '';
  D.bankBody.appendChild(frag);
}

function render(state) {
  if (!state) return;

  running = !!state.running;
  bank = state.bank || [];
  logs = state.logs || [];
  startedAt = state.startedAt;

  D.statusBank.textContent = bank.length;

  let pulseClass = 'idle';
  let labelClass = '';
  let labelText = 'Ready';

  if (state.error) {
    pulseClass = 'error';
    labelClass = 'error';
    labelText = 'Error';
  } else if (state.completed) {
    pulseClass = 'done';
    labelClass = 'done';
    labelText = 'Complete - ' + bank.length;
  } else if (running) {
    pulseClass = 'running';
    labelClass = 'running';
    labelText = 'Harvesting ' + bank.length + '/' + state.total;
  } else if (bank.length > 0) {
    labelText = bank.length + ' banked';
  }

  D.statusPulse.className = 'status-pulse ' + pulseClass;
  D.statusLabel.className = 'status-label ' + labelClass;
  D.statusLabel.textContent = labelText;

  const total = state.total || 100;
  const pct = Math.min(Math.round((bank.length / total) * 100), 100);
  const offset = RING_CIRCUMFERENCE - (pct / 100) * RING_CIRCUMFERENCE;

  D.ringFill.style.strokeDashoffset = offset;
  D.ringFill.classList.toggle('complete', state.completed && !state.error);
  D.ringPct.textContent = pct + '%';

  const rate = state.rate || 0;
  D.sRate.textContent = rate > 0 ? rate : '--';
  D.sRate.className = rate > 0 ? 'ring-stat-val on' : 'ring-stat-val dim';

  D.sEta.textContent = state.eta > 0 ? fmtTime(state.eta) : '--';
  D.sEta.className = state.eta > 0 ? 'ring-stat-val' : 'ring-stat-val dim';

  updateElapsed();

  const cycles = state.current || 0;
  D.sCycles.textContent = cycles;
  D.sCycles.className = cycles > 0 ? 'ring-stat-val on' : 'ring-stat-val dim';

  if (running && !elapsedTimer) {
    elapsedTimer = setInterval(updateElapsed, 1000);
  } else if (!running && elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }

  D.infoLeft.textContent = bank.length + ' / ' + total;
  if (state.lastCookieAt) {
    const ago = Math.round((Date.now() - state.lastCookieAt) / 1000);
    D.infoRight.textContent = 'Last: ' + ago + 's ago';
  } else {
    D.infoRight.textContent = '--';
  }

  D.statOk.textContent = state.successCount || 0;
  D.statDup.textContent = state.dupCount || 0;
  D.statFail.textContent = state.failCount || 0;

  D.startBtn.classList.toggle('hidden', running);
  D.startBtn.disabled = false;
  D.stopBtn.classList.toggle('hidden', !running);
  D.targetInput.disabled = running;

  renderLog(logs);
  renderBank(bank);
}

function send(msg) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(msg, resp => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(resp);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function setupEvents() {
  D.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const panel = tab.dataset.panel;
      if (panel === activePanel) return;

      activePanel = panel;
      D.tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      D.panelLog.classList.toggle('active', panel === 'log');
      D.panelBank.classList.toggle('active', panel === 'bank');
    });
  });

  D.startBtn.addEventListener('click', async () => {
    const target = Math.max(1, Math.min(5000, parseInt(D.targetInput.value, 10) || 100));
    D.targetInput.value = target;
    D.startBtn.disabled = true;

    const resp = await send({ type: 'start', target });
    if (!resp?.ok) {
      toast(resp?.error || 'Failed to start');
      D.startBtn.disabled = false;
    }
  });

  D.stopBtn.addEventListener('click', async () => {
    D.stopBtn.disabled = true;
    D.stopBtn.textContent = 'Stopping...';

    await send({ type: 'stop' });

    running = false;
    D.startBtn.classList.remove('hidden');
    D.startBtn.disabled = false;
    D.stopBtn.classList.add('hidden');
    D.stopBtn.disabled = false;
    D.stopBtn.textContent = 'Stop';
    D.targetInput.disabled = false;
  });

  D.copyBankBtn.addEventListener('click', async () => {
    if (!bank.length) {
      toast('Bank is empty');
      return;
    }

    const data = {
      tmpt_cookie: bank[0],
      tmpt_cookie_bank: bank,
      _generated: new Date().toISOString(),
      _count: bank.length,
      _version: 'v5.23.25',
      _info: 'Paste into config.json'
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      toast(bank.length + ' cookies copied');
    } catch (e) {
      toast('Copy failed');
    }
  });

  D.exportBtn.addEventListener('click', () => {
    if (!bank.length) {
      toast('Bank is empty');
      return;
    }

    const data = {
      _info: 'TM+ tmpt bank',
      _version: 'v5.23.25',
      _generated: new Date().toISOString(),
      _count: bank.length,
      tmpt_cookie: bank[0],
      tmpt_cookie_bank: bank
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tmpt_bank_' + bank.length + '_' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);

    toast(bank.length + ' exported');
  });

  D.injectBtn = document.getElementById('injectBtn');
  D.injectBtn.addEventListener('click', async () => {
    if (!bank.length) {
      toast('Bank is empty');
      return;
    }
    try {
      const resp = await fetch('http://127.0.0.1:18731/inject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: bank }),
      });
      const data = await resp.json();
      if (data.ok) {
        toast(data.added + ' injected · bank: ' + data.total_bank);
      } else {
        toast(data.error || 'Inject failed');
      }
    } catch (e) {
      toast('Server offline — start TM+');
    }
  });

  D.clearBankBtn.addEventListener('click', async () => {
    if (running) {
      toast('Stop harvest first');
      return;
    }
    await send({ type: 'clearBank' });
    toast('Bank cleared');
  });

  D.copyLogBtn.addEventListener('click', async () => {
    if (!logs.length) {
      toast('Log is empty');
      return;
    }
    try {
      await navigator.clipboard.writeText(logs.join('\n'));
      toast(logs.length + ' entries copied');
    } catch (e) {
      toast('Copy failed');
    }
  });

  D.clearLogBtn.addEventListener('click', async () => {
    await send({ type: 'clearLogs' });
    toast('Logs cleared');
  });
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'progress') {
    render(msg);
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  initDOM();
  setupEvents();

  const state = await send({ type: 'getState' });
  if (state) {
    render(state);
    if (state.total) D.targetInput.value = state.total;
  }
});

window.addEventListener('unload', () => {
  if (elapsedTimer) clearInterval(elapsedTimer);
  if (toastTimer) clearTimeout(toastTimer);
});