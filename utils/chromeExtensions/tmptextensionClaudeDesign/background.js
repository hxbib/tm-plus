/**
 * Ticketmaster+ Cookie Harvester v5.23.25
 * The UI for this version was made by Claude Design, the new design oriented tool Claude launched at claude.ai/design
 * This...really impressed me on its creativity. I gave it free reign, uploaded the entire original extension, and told it that it had free creative
 * reign to recreate the UI in whatever way it wanted, just that it had to be vastly different from what already existed. I was...very impressed.
 */

'use strict';

const SETTINGS = {
  AUTH_URL:
    'https://auth.ticketmaster.com/as/authorization.oauth2?' +
    'client_id=8bf7204a7e97.web.ticketmaster.us&response_type=code&' +
    'scope=openid%20profile%20phone%20email%20tm&' +
    'redirect_uri=https://identity.ticketmaster.com/exchange&' +
    'visualPresets=tm&lang=en-us&placementId=mytmlogin&' +
    'hideLeftPanel=false&integratorId=prd1741.iccp&' +
    'intSiteToken=tm-us&doNotTrack=false&disableAutoOptIn=false',
  COOKIE_URL:           'https://www.ticketmaster.com',
  AUTH_COOKIE_URL:      'https://auth.ticketmaster.com',
  COOKIE_NAME:          'tmpt',
  DEFAULT_TARGET:       100,
  COOKIE_POLL_ATTEMPTS: 30,
  COOKIE_POLL_INTERVAL: 300,
  PAGE_LOAD_TIMEOUT:    20000,
  POST_LOAD_WAIT:       1000,
  MAX_CONSECUTIVE_TIMEOUTS: 25,
  MAX_CONSECUTIVE_FAILS:    35,
  LOG_CAP:              300,
  FLUSH_EVERY_N_CYCLES: 5,
};

const COOKIE_LOOKUP_AUTH = Object.freeze({ url: SETTINGS.AUTH_COOKIE_URL, name: SETTINGS.COOKIE_NAME });
const COOKIE_LOOKUP_WWW  = Object.freeze({ url: SETTINGS.COOKIE_URL,      name: SETTINGS.COOKIE_NAME });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let _epochCounter = 0;
function nextEpoch() {
  _epochCounter = (_epochCounter + 1) % 1000;
  return Date.now() * 1000 + _epochCounter;
}

function defaultState() {
  return {
    running: false, bank: [], current: 0, total: SETTINGS.DEFAULT_TARGET,
    logs: [], error: null, completed: false, harvestTabId: null,
    startedAt: null, lastCookieAt: null, rate: 0, eta: null,
    successCount: 0, failCount: 0, dupCount: 0, epoch: 0,
    version: 6,
  };
}

function reshapeState(s) {
  const d = defaultState();
  if (!s || typeof s !== 'object') return d;
  for (const k of Object.keys(d)) {
    if (!(k in s) || s[k] === undefined) s[k] = d[k];
  }
  return s;
}

let STATE = null;
let STATE_LOADED = false;
let POPUP_PORT = null;
let DIRTY = false;
let FLUSH_TIMER = null;

async function loadStateFromStorage() {
  if (STATE_LOADED) return STATE;
  try {
    const { tmptState } = await chrome.storage.local.get('tmptState');
    STATE = reshapeState(tmptState);
  } catch (e) {
    STATE = defaultState();
  }
  STATE_LOADED = true;
  return STATE;
}

async function flushState({ force = false } = {}) {
  DIRTY = true;
  if (force) {
    if (FLUSH_TIMER) { clearTimeout(FLUSH_TIMER); FLUSH_TIMER = null; }
    return doFlush();
  }
  if (FLUSH_TIMER) return;
  FLUSH_TIMER = setTimeout(() => {
    FLUSH_TIMER = null;
    doFlush().catch(() => {});
  }, 300);
}

async function doFlush() {
  if (!DIRTY || !STATE) return;
  DIRTY = false;
  try {
    const stored = await chrome.storage.local.get('tmptState');
    const storedEpoch = stored.tmptState?.epoch || 0;
    if (STATE.epoch && storedEpoch > STATE.epoch) {
      STATE = reshapeState(stored.tmptState);
      pushPort({ type: 'full', state: snapshotForPopup() });
      return;
    }
    await chrome.storage.local.set({ tmptState: STATE });
  } catch (e) {
    DIRTY = true;
  }
}

function pushPort(msg) {
  if (!POPUP_PORT) return;
  try { POPUP_PORT.postMessage(msg); }
  catch (_) { POPUP_PORT = null; }
}

function snapshotForPopup() {
  return {
    running: STATE.running,
    current: STATE.current,
    total: STATE.total,
    bank: STATE.bank,
    completed: STATE.completed,
    error: STATE.error,
    logs: STATE.logs,
    startedAt: STATE.startedAt,
    lastCookieAt: STATE.lastCookieAt,
    rate: STATE.rate,
    eta: STATE.eta,
    successCount: STATE.successCount,
    failCount: STATE.failCount,
    dupCount: STATE.dupCount,
    harvestTabId: STATE.harvestTabId,
  };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'cookie-ledger-popup') return;
  POPUP_PORT = port;
  loadStateFromStorage().then(() => {
    pushPort({ type: 'full', state: snapshotForPopup() });
  });
  port.onDisconnect.addListener(() => {
    if (POPUP_PORT === port) POPUP_PORT = null;
  });
  port.onMessage.addListener((msg) => {
    if (msg && msg.type === 'resync') {
      pushPort({ type: 'full', state: snapshotForPopup() });
    }
  });
});

function pushLog(msg) {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  const line = `[${ts}] ${msg}`;
  STATE.logs.push(line);
  if (STATE.logs.length > SETTINGS.LOG_CAP) {
    STATE.logs.splice(0, STATE.logs.length - SETTINGS.LOG_CAP);
  }
  pushPort({ type: 'log', line });
}

async function pollForCookie() {
  for (let i = 1; i <= SETTINGS.COOKIE_POLL_ATTEMPTS; i++) {
    try {
      const c1 = await chrome.cookies.get(COOKIE_LOOKUP_AUTH);
      if (c1?.value) return c1.value;
      const c2 = await chrome.cookies.get(COOKIE_LOOKUP_WWW);
      if (c2?.value) return c2.value;
    } catch (_) {}
    if (i < SETTINGS.COOKIE_POLL_ATTEMPTS) await sleep(SETTINGS.COOKIE_POLL_INTERVAL);
  }
  return null;
}

async function deleteTmptCookie() {
  try { await chrome.cookies.remove(COOKIE_LOOKUP_WWW);  } catch (_) {}
  try { await chrome.cookies.remove(COOKIE_LOOKUP_AUTH); } catch (_) {}
}

async function isStopRequested() {
  try {
    const { tmptStopRequested } = await chrome.storage.local.get('tmptStopRequested');
    return !!tmptStopRequested;
  } catch (_) { return false; }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve('timeout');
    }, SETTINGS.PAGE_LOAD_TIMEOUT);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve('loaded');
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function closeHarvestTab(tabId) {
  if (!tabId) return;
  try { await chrome.tabs.remove(tabId); } catch (_) {}
}

async function tabExists(tabId) {
  if (!tabId) return false;
  try { await chrome.tabs.get(tabId); return true; }
  catch (_) { return false; }
}

async function runGeneration(targetCount) {
  await chrome.storage.local.set({ tmptStopRequested: false });
  await loadStateFromStorage();

  const prevLogs = STATE.logs.length ? STATE.logs : [];
  if (prevLogs.length > 0) {
    STATE.logs.push('', '━'.repeat(55), '');
  }

  STATE.running = true;
  STATE.current = 0;
  STATE.total = targetCount || SETTINGS.DEFAULT_TARGET;
  STATE.error = null;
  STATE.completed = false;
  STATE.startedAt = Date.now();
  STATE.rate = 0;
  STATE.eta = null;
  STATE.successCount = 0;
  STATE.failCount = 0;
  STATE.dupCount = 0;
  STATE.epoch = nextEpoch();
  STATE.harvestTabId = null;

  if (STATE.bank.length) pushLog(`📦 Resuming with ${STATE.bank.length} cookies already banked`);
  pushLog(`🚀 Starting harvest — Target: ${STATE.total} cookies`);

  let harvestTab;
  try {
    harvestTab = await chrome.tabs.create({ url: 'about:blank', active: false });
    STATE.harvestTabId = harvestTab.id;
    pushLog('🔗 Harvest tab created in background');
  } catch (e) {
    STATE.error = 'Failed to create harvest tab';
    STATE.running = false;
    pushLog(`❌ ${e.message}`);
    await flushState({ force: true });
    pushPort({ type: 'full', state: snapshotForPopup() });
    return;
  }

  pushPort({ type: 'full', state: snapshotForPopup() });
  await flushState({ force: true });

  const tabId = harvestTab.id;
  let consecutiveFails = 0;
  let cookiesThisRun = 0;
  const t0 = STATE.startedAt;
  let cyclesSinceFlush = 0;

  async function bailStopped() {
    pushLog('⏹ Harvest stopped by user');
    STATE.running = false;
    await chrome.storage.local.set({ tmptStopRequested: false });
    await closeHarvestTab(tabId);
    STATE.harvestTabId = null;
    await flushState({ force: true });
    pushPort({ type: 'full', state: snapshotForPopup() });
  }

  while (STATE.bank.length < STATE.total) {
    if (await isStopRequested()) { await bailStopped(); return; }

    STATE.current++;
    cyclesSinceFlush++;

    const elapsedMin = (Date.now() - t0) / 60000;
    if (elapsedMin > 0.05) {
      STATE.rate = Math.round((cookiesThisRun / elapsedMin) * 10) / 10;
      const remaining = STATE.total - STATE.bank.length;
      STATE.eta = STATE.rate > 0 ? Math.round((remaining / STATE.rate) * 60) : null;
    }

    const rateStr = STATE.rate > 0 ? ` │ ${STATE.rate}/min` : '';
    pushLog(`── Cycle ${STATE.current} │ Bank: ${STATE.bank.length}/${STATE.total}${rateStr} ──`);
    pushPort({
      type: 'tick',
      current: STATE.current,
      rate: STATE.rate,
      eta: STATE.eta,
    });

    await deleteTmptCookie();

    try {
      await chrome.tabs.update(tabId, { url: SETTINGS.AUTH_URL });
    } catch (e) {
      pushLog(`❌ Harvest tab closed: ${e.message}`);
      STATE.error = 'Harvest tab was closed';
      STATE.running = false;
      STATE.harvestTabId = null;
      await flushState({ force: true });
      pushPort({ type: 'full', state: snapshotForPopup() });
      return;
    }

    const loadResult = await waitForTabLoad(tabId);
    if (await isStopRequested()) { await bailStopped(); return; }

    if (loadResult === 'timeout') {
      consecutiveFails++;
      STATE.failCount++;
      pushLog(`⏱ Page load timeout (${consecutiveFails} consecutive)`);
      pushPort({
        type: 'stats',
        successCount: STATE.successCount,
        failCount: STATE.failCount,
        dupCount: STATE.dupCount,
      });
      if (consecutiveFails >= SETTINGS.MAX_CONSECUTIVE_TIMEOUTS) {
        STATE.error = `${consecutiveFails} consecutive timeouts — halted`;
        STATE.running = false;
        STATE.completed = true;
        await closeHarvestTab(tabId);
        STATE.harvestTabId = null;
        await flushState({ force: true });
        pushPort({ type: 'full', state: snapshotForPopup() });
        return;
      }
      continue;
    }

    await sleep(SETTINGS.POST_LOAD_WAIT);
    const tmpt = await pollForCookie();

    if (tmpt && !STATE.bank.includes(tmpt)) {
      STATE.bank.push(tmpt);
      STATE.lastCookieAt = Date.now();
      consecutiveFails = 0;
      cookiesThisRun++;
      STATE.successCount++;
      pushLog(`🔑 #${STATE.bank.length}: ${tmpt.substring(0, 40)}...`);
      pushPort({
        type: 'cookie',
        cookie: tmpt,
        ix: STATE.bank.length,
        lastCookieAt: STATE.lastCookieAt,
        successCount: STATE.successCount,
      });
      await flushState({ force: true });
      cyclesSinceFlush = 0;
    } else if (tmpt) {
      consecutiveFails++;
      STATE.dupCount++;
      pushLog(`♻️ Duplicate (${consecutiveFails} consecutive)`);
      pushPort({
        type: 'stats',
        successCount: STATE.successCount,
        failCount: STATE.failCount,
        dupCount: STATE.dupCount,
      });
    } else {
      consecutiveFails++;
      STATE.failCount++;
      pushLog(`⚠️ No tmpt received (${consecutiveFails} consecutive)`);
      pushPort({
        type: 'stats',
        successCount: STATE.successCount,
        failCount: STATE.failCount,
        dupCount: STATE.dupCount,
      });
    }

    if (cyclesSinceFlush >= SETTINGS.FLUSH_EVERY_N_CYCLES) {
      cyclesSinceFlush = 0;
      flushState();
    }

    if (consecutiveFails >= SETTINGS.MAX_CONSECUTIVE_FAILS) {
      STATE.error = `${consecutiveFails} consecutive failures — halted`;
      STATE.running = false;
      STATE.completed = true;
      await closeHarvestTab(tabId);
      STATE.harvestTabId = null;
      await flushState({ force: true });
      pushPort({ type: 'full', state: snapshotForPopup() });
      return;
    }

    if (await isStopRequested()) { await bailStopped(); return; }
  }

  STATE.running = false;
  STATE.completed = true;
  const totalSec = Math.round((Date.now() - t0) / 1000);
  pushLog(`✅ TARGET REACHED! ${STATE.bank.length}/${STATE.total} in ${totalSec}s`);
  pushLog(`📊 ${STATE.rate}/min │ ${STATE.successCount} new, ${STATE.dupCount} dups, ${STATE.failCount} fails`);
  await closeHarvestTab(tabId);
  STATE.harvestTabId = null;
  await flushState({ force: true });
  pushPort({ type: 'full', state: snapshotForPopup() });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'start') {
    (async () => {
      await loadStateFromStorage();
      if (STATE.running) { sendResponse({ ok: false, error: 'Already running' }); return; }
      STATE.completed = false;
      STATE.error = null;
      await chrome.storage.local.set({ tmptStopRequested: false });
      sendResponse({ ok: true });
      runGeneration(msg.target);
    })();
    return true;
  }

  if (msg.type === 'stop') {
    (async () => {
      await loadStateFromStorage();
      await chrome.storage.local.set({ tmptStopRequested: true });
      pushLog('⏹ Stop signal sent');
      STATE.running = false;
      STATE.completed = false;
      STATE.error = null;
      STATE.epoch = nextEpoch();
      if (STATE.harvestTabId) {
        await closeHarvestTab(STATE.harvestTabId);
        STATE.harvestTabId = null;
      }
      await flushState({ force: true });
      pushPort({ type: 'full', state: snapshotForPopup() });
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === 'getState') {
    (async () => {
      await loadStateFromStorage();
      if (STATE.running) {
        if (!STATE.harvestTabId || !(await tabExists(STATE.harvestTabId))) {
          STATE.running = false;
          STATE.harvestTabId = null;
          STATE.error = null;
          STATE.completed = false;
          await flushState({ force: true });
        }
      }
      sendResponse(snapshotForPopup());
    })();
    return true;
  }

  if (msg.type === 'clearBank') {
    (async () => {
      await loadStateFromStorage();
      await chrome.storage.local.set({ tmptStopRequested: true });
      if (STATE.harvestTabId) await closeHarvestTab(STATE.harvestTabId);
      STATE.bank.length = 0;
      STATE.current = 0;
      STATE.completed = false;
      STATE.error = null;
      STATE.running = false;
      STATE.rate = 0;
      STATE.eta = null;
      STATE.startedAt = null;
      STATE.lastCookieAt = null;
      STATE.harvestTabId = null;
      STATE.successCount = 0;
      STATE.failCount = 0;
      STATE.dupCount = 0;
      STATE.epoch = nextEpoch();
      await chrome.storage.local.set({ tmptStopRequested: false });
      await flushState({ force: true });
      pushPort({ type: 'full', state: snapshotForPopup() });
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === 'clearLogs') {
    (async () => {
      await loadStateFromStorage();
      STATE.logs.length = 0;
      await flushState({ force: true });
      pushPort({ type: 'full', state: snapshotForPopup() });
      sendResponse({ ok: true });
    })();
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Cookie Ledger] installed/reloaded — version 5.23.25');
  await loadStateFromStorage();
  if (STATE.harvestTabId) {
    await closeHarvestTab(STATE.harvestTabId);
    STATE.harvestTabId = null;
    STATE.running = false;
    await flushState({ force: true });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await loadStateFromStorage();
});
