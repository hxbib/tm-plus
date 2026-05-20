/**
 * Ticketmaster+ Cookie Harvester v5.23.25 - Popup Controller
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root = document) => root.querySelectorAll(sel);

  const inExtension = !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);

  const JAR_VB_W = 280, JAR_VB_H = 360;
  const JAR_X = 30, JAR_Y = 70, JAR_W = 220, JAR_H = 220;
  const COOKIE_W = 56, COOKIE_H = 20;
  const MAX_VISIBLE = 24;
  const LOG_VISIBLE_CAP = 50;

  const pct = (v, t) => (v / t) * 100 + '%';

  function cookieVariant(i) {
    const seed = (i * 9301 + 49297) % 233280;
    const r  = seed / 233280;
    const r2 = ((i * 7919) % 1000) / 1000;
    const r3 = ((i * 6151) % 1000) / 1000;
    return {
      rotation: -14 + r * 28,
      xJitter:  -3 + r2 * 6,
      yJitter:  -1.5 + r3 * 3,
      chips: 3 + Math.floor(r * 3),
      drop: 540 + r3 * 240,
    };
  }
  function cookieRestPos(index) {
    const perRow = 3;
    const row = Math.floor(index / perRow);
    const col = index % perRow;
    const stagger = row % 2 === 0 ? 0 : COOKIE_W * 0.30;
    const totalWidth = perRow * (COOKIE_W + 6);
    const startX = (JAR_W - totalWidth) / 2 + 4 + stagger;
    const x = startX + col * (COOKIE_W + 6);
    const y = JAR_H - 28 - row * 22;
    return { x: x + COOKIE_W / 2, y: y + COOKIE_H / 2 };
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';

  const COOKIE_SVG_TEMPLATE = (() => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 36');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const e = (tag, attrs) => {
      const el = document.createElementNS(SVG_NS, tag);
      for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
      return el;
    };
    svg.appendChild(e('ellipse', { cx: 50, cy: 32, rx: 42, ry: 3, fill: 'rgba(0,0,0,.22)' }));
    svg.appendChild(e('ellipse', { cx: 50, cy: 20, rx: 48, ry: 14, fill: 'var(--cookie)' }));
    svg.appendChild(e('ellipse', { cx: 50, cy: 18, rx: 46, ry: 12, fill: 'var(--cookie-deep)' }));
    svg.appendChild(e('ellipse', { cx: 38, cy: 13, rx: 20, ry: 3.5, fill: 'var(--cookie)', opacity: .55 }));
    return svg;
  })();

  function buildCookieSvg(index) {
    const svg = COOKIE_SVG_TEMPLATE.cloneNode(true);
    const variant = cookieVariant(index);
    for (let i = 0; i < variant.chips; i++) {
      const s = (index * 31 + i * 17) % 1000;
      const cx = 50 + (-30 + (s % 60));
      const cy = 35 + (-12 + ((s / 7) % 22));
      const chip = document.createElementNS(SVG_NS, 'ellipse');
      chip.setAttribute('cx', cx);
      chip.setAttribute('cy', cy);
      chip.setAttribute('rx', '3.6');
      chip.setAttribute('ry', '3');
      chip.setAttribute('fill', 'var(--chip)');
      svg.appendChild(chip);
    }
    return svg;
  }

  function fmtDur(sec) {
    if (sec == null || sec <= 0) return ['—', ''];
    if (sec < 60) return [String(sec), 's'];
    const m = Math.floor(sec / 60), r = sec % 60;
    if (m < 60) return [`${m}:${String(r).padStart(2, '0')}`, ''];
    const h = Math.floor(m / 60);
    return [`${h}:${String(m % 60).padStart(2, '0')}`, 'h'];
  }
  function fmtAgo(ms) {
    if (!ms || ms <= 0) return '—';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s ago`;
  }

  const ICON = {
    copy: '<svg viewBox="0 0 16 16"><rect x="5" y="5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3 11 V3 a1 1 0 0 1 1-1 h7" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
    download: '<svg viewBox="0 0 16 16"><path d="M8 2 V11 M4 8 L8 12 L12 8 M3 14 H13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    trash: '<svg viewBox="0 0 16 16"><path d="M3 4 H13 M6 4 V3 a1 1 0 0 1 1-1 h2 a1 1 0 0 1 1 1 V4 M4 4 L5 14 a1 1 0 0 0 1 1 h4 a1 1 0 0 0 1-1 L12 4 M7 7 V12 M9 7 V12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  const MARKS = { found: '●', dup: '○', fail: '×', info: '·' };

  function classifyLogEntry(text) {
    if (/🔑|#\d+/.test(text)) return 'found';
    if (/❌|halted|lost|closed|⏹/.test(text)) return 'fail';
    if (/⚠️|♻️|timeout|miss|dup/i.test(text)) return 'dup';
    return 'info';
  }
  function splitTs(line) {
    const m = /^\[([^\]]+)\]\s*/.exec(line);
    if (m) return { ts: m[1], txt: line.slice(m[0].length) };
    return { ts: '', txt: line };
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let PORT = null;
  function openPort() {
    if (!inExtension) return;
    try {
      PORT = chrome.runtime.connect({ name: 'cookie-ledger-popup' });
      PORT.onMessage.addListener(onPortMessage);
      PORT.onDisconnect.addListener(() => { PORT = null; });
    } catch (_) { PORT = null; }
  }
  function send(msg) {
    if (!inExtension) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(resp);
        });
      } catch (_) { resolve(null); }
    });
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    if (!t) return;
    clearTimeout(toastTimer);
    t.textContent = msg;
    t.classList.add('show');
    toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
  }

  const STATE = {
    running: false, completed: false, error: null,
    bank: [], logs: [],
    current: 0, total: 100,
    rate: 0, eta: 0,
    startedAt: null, lastCookieAt: null,
    successCount: 0, dupCount: 0, failCount: 0,
  };

  const PREV = {
    count: -1, target: -1, running: null, completed: null, error: null,
    bankLen: -1, logsLen: -1,
    rate: -1, eta: -1, elapsedDisplay: '', lastAgoDisplay: '',
    cycles: -1, success: -1, dup: -1, fail: -1,
    tab: 'feed',
  };

  let rafPending = false;
  function scheduleRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      render();
    });
  }

  const REF = {};
  function cacheRefs() {
    [
      'meta-status', 'hero-count', 'hero-target', 'hero-cap',
      'prog-fill', 'prog-pct', 'prog-last',
      'stat-rate', 'stat-elapsed', 'stat-eta', 'stat-cycles',
      'target-input', 'bake-btn', 'jar-lid', 'jar-stamp', 'jar-overflow',
      'jar-cookies', 'stamp-target', 'needle-group', 'needle-label',
      'panel-body', 'tab-act', 'toast',
      'foot-found', 'foot-dup', 'foot-fail',
      'tab-c-feed', 'tab-c-bank', 'tab-c-log',
      'jar-ticks',
    ].forEach((id) => { REF[id] = $(id); });
    REF.jarSlots = [];
    REF.cookieHost = REF['jar-cookies'];
  }

  function initSvgTicks() {

    const dial = $('dial-ticks');
    if (dial && dial.childElementCount === 0) {
      for (let i = 0; i < 11; i++) {
        const x = 60 + i * 16.4;
        const tall = i % 5 === 0;
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', x); line.setAttribute('y1', '312');
        line.setAttribute('x2', x); line.setAttribute('y2', tall ? '320' : '318');
        line.setAttribute('stroke', 'var(--ink-soft)');
        line.setAttribute('stroke-width', tall ? '1.2' : '.8');
        dial.appendChild(line);
      }
    }
    refreshJarTicks(STATE.total);
  }
  function refreshJarTicks(target) {
    const g = REF['jar-ticks'];
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    for (const t of [0.25, 0.5, 0.75, 1]) {
      const ty = JAR_Y + JAR_H - (JAR_H - 24) * t;
      const ln = document.createElementNS(SVG_NS, 'line');
      ln.setAttribute('x1', JAR_X + JAR_W - 6); ln.setAttribute('y1', ty);
      ln.setAttribute('x2', JAR_X + JAR_W - 1); ln.setAttribute('y2', ty);
      ln.setAttribute('stroke', 'var(--ink-mute)');
      ln.setAttribute('stroke-width', '.9');
      ln.setAttribute('opacity', '.55');
      g.appendChild(ln);
      const tx = document.createElementNS(SVG_NS, 'text');
      tx.setAttribute('x', JAR_X + JAR_W - 10);
      tx.setAttribute('y', ty + 2.5);
      tx.setAttribute('text-anchor', 'end');
      tx.setAttribute('font-family', 'ui-monospace, monospace');
      tx.setAttribute('font-size', '6');
      tx.setAttribute('fill', 'var(--ink-mute)');
      tx.setAttribute('opacity', '.7');
      tx.textContent = Math.round(target * t);
      g.appendChild(tx);
    }
  }
  function initJarCookies() {
    const host = REF.cookieHost;
    host.style.left = pct(JAR_X, JAR_VB_W);
    host.style.top = pct(JAR_Y, JAR_VB_H);
    host.style.width = pct(JAR_W, JAR_VB_W);
    host.style.height = pct(JAR_H, JAR_VB_H);

    const frag = document.createDocumentFragment();
    for (let i = 0; i < MAX_VISIBLE; i++) {
      const v = cookieVariant(i);
      const p = cookieRestPos(i);
      const wrap = document.createElement('div');
      wrap.className = 'jar-cookie';
      wrap.style.left = pct(p.x, JAR_W);
      wrap.style.top = pct(p.y, JAR_H);
      wrap.style.width = (COOKIE_W / JAR_W) * 100 + '%';
      wrap.style.setProperty('--rot', `${v.rotation}deg`);
      wrap.style.setProperty('--xj', `${v.xJitter}px`);
      wrap.style.setProperty('--yj', `${v.yJitter}px`);
      wrap.style.setProperty('--dur', `${v.drop}ms`);
      wrap.style.setProperty('--delay', `${(i % 3) * 40}ms`);
      wrap.appendChild(buildCookieSvg(i));
      frag.appendChild(wrap);
      REF.jarSlots.push(wrap);
    }
    host.appendChild(frag);
  }
  function initJarLid() {
    const lid = REF['jar-lid'];
    lid.style.left = pct(JAR_X - 6, JAR_VB_W);
    lid.style.top = pct(JAR_Y - 22, JAR_VB_H);
    lid.style.width = pct(JAR_W + 12, JAR_VB_W);
  }

  function onPortMessage(msg) {
    if (!msg) return;
    switch (msg.type) {
      case 'full': {

        const s = msg.state;
        STATE.running = !!s.running;
        STATE.completed = !!s.completed;
        STATE.error = s.error || null;
        STATE.bank.length = 0;
        if (s.bank) for (const c of s.bank) STATE.bank.push(c);
        STATE.logs.length = 0;
        if (s.logs) for (const l of s.logs) STATE.logs.push(l);
        STATE.current = s.current || 0;
        STATE.total = s.total || 100;
        STATE.rate = s.rate || 0;
        STATE.eta = s.eta || 0;
        STATE.startedAt = s.startedAt || null;
        STATE.lastCookieAt = s.lastCookieAt || null;
        STATE.successCount = s.successCount || 0;
        STATE.dupCount = s.dupCount || 0;
        STATE.failCount = s.failCount || 0;

        if (PREV.bankLen > STATE.bank.length) bankRenderCount = 0;
        scheduleRender();
        break;
      }
      case 'cookie': {
        STATE.bank.push(msg.cookie);
        STATE.lastCookieAt = msg.lastCookieAt;
        STATE.successCount = msg.successCount;
        scheduleRender();
        break;
      }
      case 'log': {
        STATE.logs.push(msg.line);
        if (STATE.logs.length > 300) STATE.logs.splice(0, STATE.logs.length - 300);
        scheduleRender();
        break;
      }
      case 'tick': {
        STATE.current = msg.current;
        STATE.rate = msg.rate;
        STATE.eta = msg.eta;
        scheduleRender();
        break;
      }
      case 'stats': {
        STATE.successCount = msg.successCount;
        STATE.dupCount = msg.dupCount;
        STATE.failCount = msg.failCount;
        scheduleRender();
        break;
      }
    }
  }

  let activeTab = 'feed';
  let bankRenderCount = 0;

  function setText(el, s) { if (el && el.textContent !== s) el.textContent = s; }
  function setHtml(el, s) { if (el && el.innerHTML !== s) el.innerHTML = s; }

  function render() {
    if (!REF.cookieHost) return;
    const s = STATE;
    const count = s.bank.length;

    if (count !== PREV.count) {
      setText(REF['hero-count'], String(count).padStart(2, '0'));
    }
    if (s.total !== PREV.target) {
      setText(REF['hero-target'], String(s.total));
      setText(REF['stamp-target'], String(s.total));
      refreshJarTicks(s.total);
    }

    const wasState = `${s.running}|${s.completed}|${s.error}|${count}|${s.total}`;
    if (wasState !== PREV._metaSig) {
      PREV._metaSig = wasState;
      const status = REF['meta-status'];
      status.className = '';
      if (s.error) {
        status.classList.add('done-mark'); status.textContent = 'error';
      } else if (s.completed) {
        status.classList.add('done-mark'); status.textContent = `order filled — ${count}`;
      } else if (s.running) {
        status.classList.add('live'); status.textContent = `harvesting · ${count}/${s.total}`;
      } else if (count > 0) {
        status.textContent = `${count} banked`;
      } else {
        status.textContent = 'open for orders';
      }
    }

    const capSig = `${count}|${s.completed}|${s.running}|${s.total}`;
    if (capSig !== PREV._capSig) {
      PREV._capSig = capSig;
      const cap = REF['hero-cap'];
      if (count === 0) {
        cap.innerHTML = 'The jar is empty. <b>Begin a fresh batch.</b>';
      } else if (s.completed) {
        cap.innerHTML = `The order is filled — <b>${count} cookies banked.</b>`;
      } else if (s.running) {
        cap.innerHTML = `Baking now — <b>${Math.max(s.total - count, 0)}</b> to fill the order.`;
      } else {
        cap.innerHTML = `Paused with <b>${count}</b>. Resume to keep baking.`;
      }
    }

    const pctVal = Math.min(Math.round((count / s.total) * 100), 100);
    if (pctVal !== PREV._pct) {
      PREV._pct = pctVal;
      REF['prog-fill'].style.width = pctVal + '%';
      setText(REF['prog-pct'], pctVal + '%');
    }

    if (s.rate !== PREV.rate) {
      PREV.rate = s.rate;
      const e = REF['stat-rate'];
      if (s.rate > 0) {
        e.classList.remove('dim');
        e.innerHTML = `${s.rate}<span class="stat-u">/min</span>`;
      } else {
        e.classList.add('dim');
        e.textContent = '—';
      }
    }
    if (s.eta !== PREV.eta) {
      PREV.eta = s.eta;
      const e = REF['stat-eta'];
      if (s.eta > 0) {
        e.classList.remove('dim');
        const [v, u] = fmtDur(s.eta);
        e.innerHTML = u ? `${v}<span class="stat-u">${u}</span>` : v;
      } else {
        e.classList.add('dim');
        e.textContent = '—';
      }
    }
    if (s.current !== PREV.cycles) {
      PREV.cycles = s.current;
      const e = REF['stat-cycles'];
      e.classList.toggle('dim', s.current === 0);
      e.textContent = s.current > 0 ? String(s.current) : '—';
    }
    if (s.successCount !== PREV.success) { PREV.success = s.successCount; setText(REF['foot-found'], String(s.successCount)); }
    if (s.dupCount !== PREV.dup)         { PREV.dup     = s.dupCount;     setText(REF['foot-dup'],   String(s.dupCount));     }
    if (s.failCount !== PREV.fail)       { PREV.fail    = s.failCount;    setText(REF['foot-fail'],  String(s.failCount));    }

    if (count !== PREV.count) {
      const visible = Math.min(count, MAX_VISIBLE);
      const slots = REF.jarSlots;

      const prevVisible = Math.min(Math.max(PREV.count, 0), MAX_VISIBLE);

      for (let i = prevVisible; i < visible; i++) slots[i].classList.add('in');

      for (let i = visible; i < prevVisible; i++) slots[i].classList.remove('in');

      const overflow = count - MAX_VISIBLE;
      const of = REF['jar-overflow'];
      if (overflow > 0) {
        of.hidden = false;
        of.textContent = '+' + overflow;
        of.style.left = pct(JAR_X + JAR_W / 2, JAR_VB_W);
        of.style.top  = pct(JAR_Y + 18, JAR_VB_H);
      } else {
        of.hidden = true;
      }

      const fillRatio = Math.min(count / s.total, 1);
      const angle = -110 + fillRatio * 220;
      REF['needle-group'].setAttribute('transform', `translate(140 326) rotate(${angle})`);
      REF['needle-label'].textContent = `${count}/${s.total}`;
    }

    const lidOpen = s.running && !s.completed;
    if (lidOpen !== PREV.lidOpen) {
      PREV.lidOpen = lidOpen;
      REF['jar-lid'].classList.toggle('open', lidOpen);
    }

    if (s.completed !== PREV.completed) {
      PREV.completed = s.completed;
      REF['jar-stamp'].classList.toggle('show', !!s.completed);
    }

    if (s.total !== PREV._tgtForm) {
      PREV._tgtForm = s.total;
      const tgt = REF['target-input'];
      if (document.activeElement !== tgt) tgt.value = String(s.total);
      for (const b of $$('#stepper button')) {
        b.classList.toggle('on', Number(b.dataset.step) === s.total);
      }
    }
    if (s.running !== PREV.running || s.completed !== PREV._compForm || count !== PREV._countForm) {
      PREV.running = s.running;
      PREV._compForm = s.completed;
      PREV._countForm = count;
      const tgt = REF['target-input'];
      tgt.disabled = s.running;
      for (const b of $$('#stepper button')) b.disabled = s.running;
      const bake = REF['bake-btn'];
      if (s.running) {
        bake.textContent = 'Halt'; bake.className = 'bake stop'; bake.disabled = false;
      } else {
        bake.textContent = count === 0 ? 'Bake' : s.completed ? 'Done' : 'Resume';
        bake.className = 'bake';
        bake.disabled = s.completed && count >= s.total;
      }
    }

    if (s.logs.length !== PREV.logsLen) {
      setText(REF['tab-c-feed'], String(s.logs.length));
      setText(REF['tab-c-log'],  String(s.logs.length));
    }
    if (count !== PREV.bankLen) {
      setText(REF['tab-c-bank'], String(count));
    }

    if (activeTab === 'feed' && s.logs.length !== PREV.logsLen) {
      renderFeed();
    }
    if (activeTab === 'log' && s.logs.length !== PREV.logsLen) {
      renderLog();
    }
    if (activeTab === 'bank' && count !== PREV.bankLen) {
      renderBankIncremental();
    }

    PREV.count = count;
    PREV.target = s.total;
    PREV.logsLen = s.logs.length;
    PREV.bankLen = count;
  }

  function renderFeed() {
    const body = REF['panel-body'];
    if (!STATE.logs.length) {
      body.innerHTML = '<div class="feed-empty">No cookies in the jar yet. Click <b>Bake</b> to begin.</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    const list = document.createElement('div');
    list.className = 'feed-list';
    const lines = STATE.logs.slice(-8).reverse();
    let foundIx = STATE.bank.length;
    for (const line of lines) {
      const { ts, txt } = splitTs(line);
      const kind = classifyLogEntry(line);
      const row = document.createElement('div');
      row.className = 'feed-row ' + kind;
      row.innerHTML =
        `<span class="ts">${ts || ''}</span>` +
        `<span class="mk">${MARKS[kind] || '·'}</span>` +
        `<span class="txt">${escapeHtml(txt)}</span>` +
        `<span class="ix">${kind === 'found' ? '№' + foundIx : ''}</span>`;
      if (kind === 'found') foundIx--;
      list.appendChild(row);
    }
    frag.appendChild(list);
    body.replaceChildren(frag);
  }

  function renderLog() {
    const body = REF['panel-body'];
    if (!STATE.logs.length) {
      body.innerHTML = '<div class="log-empty">No log entries yet.</div>';
      return;
    }

    const list = document.createElement('div');
    list.className = 'log-list';
    const start = Math.max(0, STATE.logs.length - LOG_VISIBLE_CAP);
    for (let i = start; i < STATE.logs.length; i++) {
      const line = STATE.logs[i];
      const { ts, txt } = splitTs(line);
      const kind = classifyLogEntry(line);
      const row = document.createElement('div');
      row.className = 'log-row ' + kind;
      row.innerHTML =
        `<span class="ts">${ts || ''}</span>` +
        `<span class="mk">${MARKS[kind] || '·'}</span>` +
        `<span class="txt">${escapeHtml(txt)}</span>` +
        `<span class="ix"></span>`;
      list.appendChild(row);
    }
    body.replaceChildren(list);
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  }

  function renderBankFull() {
    const body = REF['panel-body'];
    if (!STATE.bank.length) {
      body.innerHTML = '<div class="rack-empty">The cooling rack is empty.</div>';
      bankRenderCount = 0;
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'rack';
    const grid = document.createElement('div');
    grid.className = 'rack-grid';
    grid.id = 'rack-grid';
    wrap.appendChild(grid);
    body.replaceChildren(wrap);
    bankRenderCount = 0;
    renderBankIncremental();
  }
  function renderBankIncremental() {
    const grid = document.getElementById('rack-grid');
    if (!grid) { renderBankFull(); return; }
    if (STATE.bank.length < bankRenderCount) {

      renderBankFull();
      return;
    }

    const frag = document.createDocumentFragment();
    for (let i = bankRenderCount; i < STATE.bank.length; i++) {
      const b = document.createElement('button');
      b.className = 'rack-cookie';
      b.title = `№${i + 1}\n${STATE.bank[i]}\n\nClick to copy`;
      b.style.animationDelay = `${(i % 12) * 25}ms`;
      b.appendChild(buildCookieSvg(i));
      const lbl = document.createElement('span');
      lbl.className = 'rack-ix';
      lbl.textContent = i + 1;
      b.appendChild(lbl);
      const idx = i;
      b.addEventListener('click', () => {
        copyToClipboard(STATE.bank[idx]).then(() => toast(`№${idx + 1} copied`));
      });
      frag.appendChild(b);
    }
    grid.appendChild(frag);
    bankRenderCount = STATE.bank.length;
  }

  function renderTabActs() {
    const host = REF['tab-act'];
    host.innerHTML = '';
    if (activeTab === 'feed' || activeTab === 'log') {
      host.appendChild(actBtn(ICON.copy,  'Copy log',  copyLog));
      host.appendChild(actBtn(ICON.trash, 'Clear log', clearLog, false));
    } else if (activeTab === 'bank') {
      host.appendChild(actBtn(ICON.copy,     'Copy bank as JSON', copyBank));
      host.appendChild(actBtn(ICON.download, 'Export bank .json', exportBank));
      host.appendChild(actBtn(ICON.trash,    'Empty jar',         clearBank, STATE.running));
    }
  }
  function actBtn(icon, title, fn, disabled = false) {
    const b = document.createElement('button');
    b.className = 'iconbtn';
    b.title = title;
    b.innerHTML = icon;
    b.disabled = !!disabled;
    b.addEventListener('click', fn);
    return b;
  }

  function switchTab(tab) {
    activeTab = tab;
    for (const t of $$('.tab')) t.classList.toggle('on', t.dataset.tab === tab);
    if (tab === 'feed') renderFeed();
    else if (tab === 'log') renderLog();
    else if (tab === 'bank') renderBankFull();
    renderTabActs();
  }

  function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); resolve(); }
      catch (e) { reject(e); }
      finally { ta.remove(); }
    });
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  async function startHarvest() {
    const tgt = clamp(parseInt(REF['target-input'].value, 10) || 100, 1, 5000);
    REF['target-input'].value = String(tgt);
    const resp = await send({ type: 'start', target: tgt });
    if (!resp || !resp.ok) toast(resp?.error || 'Failed to start');
  }
  async function stopHarvest() {
    REF['bake-btn'].disabled = true;
    await send({ type: 'stop' });
  }
  async function clearBank() {
    if (STATE.running) { toast('Stop harvest first'); return; }
    await send({ type: 'clearBank' });
    toast('Jar emptied');
  }
  async function clearLog() {
    await send({ type: 'clearLogs' });
    toast('Log cleared');
  }
  function copyBank() {
    if (!STATE.bank.length) { toast('Jar is empty'); return; }
    const payload = {
      tmpt_cookie: STATE.bank[0],
      tmpt_cookie_bank: STATE.bank,
      _generated: new Date().toISOString(),
      _count: STATE.bank.length,
      _version: 'v6.1.0',
    };
    copyToClipboard(JSON.stringify(payload, null, 2))
      .then(() => toast(`${STATE.bank.length} cookies copied`));
  }
  function copyLog() {
    if (!STATE.logs.length) { toast('Log is empty'); return; }
    copyToClipboard(STATE.logs.join('\n'))
      .then(() => toast(`${STATE.logs.length} entries copied`));
  }
  function exportBank() {
    if (!STATE.bank.length) { toast('Jar is empty'); return; }
    const blob = new Blob([JSON.stringify({
      _info: 'Cookie Ledger — bank export',
      _version: 'v6.1.0',
      _generated: new Date().toISOString(),
      _count: STATE.bank.length,
      tmpt_cookie: STATE.bank[0],
      tmpt_cookie_bank: STATE.bank,
    }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bank_${STATE.bank.length}_${Date.now()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
    toast(`Exported ${STATE.bank.length} cookies`);
  }

  let lastTickerSec = -1;
  function tick(now) {
    const sec = Math.floor(now / 1000);
    if (sec !== lastTickerSec) {
      lastTickerSec = sec;
      if (STATE.startedAt && STATE.running) {
        const elapsedSec = Math.max(0, Math.floor((Date.now() - STATE.startedAt) / 1000));
        const [v, u] = fmtDur(elapsedSec);
        const display = elapsedSec > 0 ? `${v}${u ? `<span class="stat-u">${u}</span>` : ''}` : '—';
        if (display !== PREV.elapsedDisplay) {
          PREV.elapsedDisplay = display;
          REF['stat-elapsed'].innerHTML = display;
          REF['stat-elapsed'].classList.toggle('dim', elapsedSec === 0);
        }
      }
      if (STATE.lastCookieAt) {
        const ago = 'last cookie · ' + fmtAgo(Date.now() - STATE.lastCookieAt);
        if (ago !== PREV.lastAgoDisplay) {
          PREV.lastAgoDisplay = ago;
          setText(REF['prog-last'], ago);
        }
      } else if (PREV.lastAgoDisplay !== 'last cookie · —') {
        PREV.lastAgoDisplay = 'last cookie · —';
        setText(REF['prog-last'], 'last cookie · —');
      }
    }
    requestAnimationFrame(tick);
  }

  async function loadColorway() {
    if (!inExtension) return localStorage.getItem('cookieLedger.colorway') || 'cream';
    try {
      const { cookieLedgerColorway } = await chrome.storage.local.get('cookieLedgerColorway');
      return cookieLedgerColorway || 'cream';
    } catch (_) { return 'cream'; }
  }
  function setColorway(cw) {
    document.documentElement.dataset.colorway = cw;
    for (const b of $$('.colorway-pick button')) {
      b.classList.toggle('on', b.dataset.cw === cw);
    }
    if (inExtension) {
      try { chrome.storage.local.set({ cookieLedgerColorway: cw }); } catch (_) {}
    } else {
      try { localStorage.setItem('cookieLedger.colorway', cw); } catch (_) {}
    }
  }

  async function init() {
    cacheRefs();
    initSvgTicks();
    initJarCookies();
    initJarLid();

    REF['bake-btn'].addEventListener('click', () => {
      if (STATE.running) stopHarvest();
      else if (!STATE.completed || STATE.bank.length < STATE.total) startHarvest();
    });
    REF['target-input'].addEventListener('change', (e) => {
      const v = clamp(parseInt(e.target.value, 10) || 100, 1, 5000);
      e.target.value = String(v);
      STATE.total = v;
      scheduleRender();
    });
    for (const b of $$('#stepper button')) {
      b.addEventListener('click', () => {
        const v = Number(b.dataset.step);
        REF['target-input'].value = String(v);
        STATE.total = v;
        scheduleRender();
      });
    }
    for (const t of $$('.tab')) {
      t.addEventListener('click', () => switchTab(t.dataset.tab));
    }
    for (const b of $$('.colorway-pick button')) {
      b.addEventListener('click', () => setColorway(b.dataset.cw));
    }
    $('inject-btn').addEventListener('click', async () => {
      if (!STATE.bank.length) { toast('Jar is empty'); return; }
      try {
        const resp = await fetch('http://127.0.0.1:18731/inject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookies: STATE.bank }),
        });
        const data = await resp.json();
        if (data.ok) {
          toast(`${data.added} injected · bank: ${data.total_bank}`);
        } else {
          toast(data.error || 'Inject failed');
        }
      } catch (_) {
        toast('Server offline — start TM+');
      }
    });
    $('pull-btn').addEventListener('click', () => copyBank());

    setColorway(await loadColorway());

    if (inExtension) {
      openPort();

    } else {

      scheduleRender();
    }

    renderTabActs();
    requestAnimationFrame(tick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
