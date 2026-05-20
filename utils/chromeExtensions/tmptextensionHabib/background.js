/**
 * Ticketmaster+ Cookie Harvester v5.23.25
 */

const AUTH_URL = "https://auth.ticketmaster.com/as/authorization.oauth2?" +
  "client_id=8bf7204a7e97.web.ticketmaster.us&response_type=code&" +
  "scope=openid%20profile%20phone%20email%20tm&" +
  "redirect_uri=https://identity.ticketmaster.com/exchange&" +
  "visualPresets=tm&lang=en-us&placementId=mytmlogin&" +
  "hideLeftPanel=false&integratorId=prd1741.iccp&" +
  "intSiteToken=tm-us&doNotTrack=false&disableAutoOptIn=false";

const COOKIE_URL = "https://www.ticketmaster.com";
const AUTH_COOKIE_URL = "https://auth.ticketmaster.com";
const DEFAULT_TARGET = 100;
const COOKIE_POLL_ATTEMPTS = 30;
const COOKIE_POLL_INTERVAL_MS = 300;
const PAGE_LOAD_TIMEOUT_MS = 20000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getState() {
  const result = await chrome.storage.local.get("tmptState");
  return result.tmptState || {
    running: false, bank: [], current: 0, total: DEFAULT_TARGET,
    logs: [], error: null, completed: false, harvestTabId: null,
    startedAt: null, lastCookieAt: null, rate: 0, eta: null,
    successCount: 0, failCount: 0, dupCount: 0, epoch: 0,
  };
}

async function saveState(state) {
  const stored = await chrome.storage.local.get("tmptState");
  const storedEpoch = stored.tmptState?.epoch || 0;
  if (state.epoch && storedEpoch > state.epoch) {
    state.running = false;
    return false;
  }

  if (await isStopRequested()) {
    state.running = false;
  }

  await chrome.storage.local.set({ tmptState: state });
  broadcastProgress(state);
  return true;
}

function broadcastProgress(state) {
  chrome.runtime.sendMessage({
    type: "progress",
    running: state.running,
    current: state.current,
    total: state.total,
    found: state.bank.length,
    completed: state.completed,
    error: state.error,
    logs: state.logs.slice(-150),
    bank: state.bank,
    startedAt: state.startedAt,
    lastCookieAt: state.lastCookieAt,
    rate: state.rate,
    eta: state.eta,
    successCount: state.successCount || 0,
    failCount: state.failCount || 0,
    dupCount: state.dupCount || 0,
    harvestTabId: state.harvestTabId,
  }).catch(() => {});
}

function log(state, msg) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  state.logs.push(`[${ts}] ${msg}`);
  if (state.logs.length > 500) state.logs = state.logs.slice(-300);
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve("timeout");
    }, PAGE_LOAD_TIMEOUT_MS);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve("loaded");
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function pollForCookie() {
  for (let i = 1; i <= COOKIE_POLL_ATTEMPTS; i++) {
    const c1 = await chrome.cookies.get({ url: COOKIE_URL, name: "tmpt" });
    if (c1?.value) return c1.value;
    const c2 = await chrome.cookies.get({ url: AUTH_COOKIE_URL, name: "tmpt" });
    if (c2?.value) return c2.value;
    if (i < COOKIE_POLL_ATTEMPTS) await sleep(COOKIE_POLL_INTERVAL_MS);
  }
  return null;
}

async function deleteTmptCookie() {
  try { await chrome.cookies.remove({ url: COOKIE_URL, name: "tmpt" }); } catch (_) {}
  try { await chrome.cookies.remove({ url: AUTH_COOKIE_URL, name: "tmpt" }); } catch (_) {}
}

async function isStopRequested() {
  return !!(await chrome.storage.local.get("tmptStopRequested")).tmptStopRequested;
}

async function closeHarvestTab(tabId) {
  if (!tabId) return;
  try { await chrome.tabs.remove(tabId); } catch (_) {}
}

async function tabExists(tabId) {
  if (!tabId) return false;
  try { await chrome.tabs.get(tabId); return true; } catch (_) { return false; }
}

async function runGeneration(targetCount) {
  await chrome.storage.local.set({ tmptStopRequested: false });

  const prev = await getState();

  const prevLogs = prev.logs?.length ? [...prev.logs] : [];
  if (prevLogs.length > 0) {
    prevLogs.push("");
    prevLogs.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    prevLogs.push("");
  }

  const epoch = Date.now();

  let state = {
    running: true,
    bank: prev.bank?.length ? [...prev.bank] : [],
    current: 0,
    total: targetCount || DEFAULT_TARGET,
    logs: prevLogs,
    error: null,
    completed: false,
    harvestTabId: null,
    startedAt: Date.now(),
    lastCookieAt: prev.lastCookieAt || null,
    rate: 0,
    eta: null,
    successCount: 0,
    failCount: 0,
    dupCount: 0,
    epoch,
  };

  if (state.bank.length) log(state, `📦 Resuming with ${state.bank.length} cookies already banked`);
  log(state, `🚀 Starting harvest — Target: ${state.total} cookies`);

  let harvestTab;
  try {
    harvestTab = await chrome.tabs.create({ url: "about:blank", active: false });
    state.harvestTabId = harvestTab.id;
    log(state, `🔗 Harvest tab created in background`);
  } catch (e) {
    state.error = "Failed to create harvest tab";
    state.running = false;
    log(state, `❌ ${e.message}`);
    await saveState(state);
    return;
  }

  if (!(await saveState(state))) return;

  const tabId = harvestTab.id;
  let consecutiveFails = 0;
  let cookiesThisRun = 0;
  const t0 = Date.now();

  while (state.bank.length < state.total) {
    if (await isStopRequested()) {
      log(state, "⏹ Harvest stopped by user");
      state.running = false;
      await chrome.storage.local.set({ tmptStopRequested: false });
      await closeHarvestTab(tabId);
      state.harvestTabId = null;
      await saveState(state);
      return;
    }

    state.current++;

    const elapsedMin = (Date.now() - t0) / 60000;
    if (elapsedMin > 0.05) {
      state.rate = Math.round(cookiesThisRun / elapsedMin * 10) / 10;
      const remaining = state.total - state.bank.length;
      state.eta = state.rate > 0 ? Math.round(remaining / state.rate * 60) : null;
    }

    const rateStr = state.rate > 0 ? ` │ ${state.rate}/min` : '';
    log(state, `── Cycle ${state.current} │ Bank: ${state.bank.length}/${state.total}${rateStr} ──`);
    if (!(await saveState(state))) {
      await closeHarvestTab(tabId);
      return;
    }

    await deleteTmptCookie();

    try {
      await chrome.tabs.update(tabId, { url: AUTH_URL });
    } catch (e) {
      log(state, `❌ Harvest tab closed: ${e.message}`);
      state.error = "Harvest tab was closed";
      state.running = false;
      state.harvestTabId = null;
      await saveState(state);
      return;
    }

    const loadResult = await waitForTabLoad(tabId);

    if (await isStopRequested()) {
      log(state, "⏹ Harvest stopped by user");
      state.running = false;
      await chrome.storage.local.set({ tmptStopRequested: false });
      await closeHarvestTab(tabId);
      state.harvestTabId = null;
      await saveState(state);
      return;
    }

    if (loadResult === "timeout") {
      consecutiveFails++;
      state.failCount++;
      log(state, `⏱ Page load timeout (${consecutiveFails} consecutive)`);
      if (consecutiveFails >= 25) {
        state.error = `${consecutiveFails} consecutive timeouts — halted`;
        state.running = false;
        state.completed = true;
        await closeHarvestTab(tabId);
        state.harvestTabId = null;
        await saveState(state);
        return;
      }
      continue;
    }

    await sleep(1000);

    const tmpt = await pollForCookie();

    if (tmpt && !state.bank.includes(tmpt)) {
      state.bank.push(tmpt);
      state.lastCookieAt = Date.now();
      consecutiveFails = 0;
      cookiesThisRun++;
      state.successCount++;
      log(state, `🔑 #${state.bank.length}: ${tmpt.substring(0, 40)}...`);
    } else if (tmpt) {
      consecutiveFails++;
      state.dupCount++;
      log(state, `♻️ Duplicate (${consecutiveFails} consecutive)`);
    } else {
      consecutiveFails++;
      state.failCount++;
      log(state, `⚠️ No tmpt received (${consecutiveFails} consecutive)`);
    }

    if (!(await saveState(state))) {
      await closeHarvestTab(tabId);
      return;
    }

    if (consecutiveFails >= 35) {
      state.error = `${consecutiveFails} consecutive failures — halted`;
      state.running = false;
      state.completed = true;
      await closeHarvestTab(tabId);
      state.harvestTabId = null;
      await saveState(state);
      return;
    }

    if (await isStopRequested()) {
      log(state, "⏹ Harvest stopped by user");
      state.running = false;
      await chrome.storage.local.set({ tmptStopRequested: false });
      await closeHarvestTab(tabId);
      state.harvestTabId = null;
      await saveState(state);
      return;
    }
  }

  state.running = false;
  state.completed = true;
  const totalSec = Math.round((Date.now() - t0) / 1000);
  log(state, `✅ TARGET REACHED! ${state.bank.length}/${state.total} in ${totalSec}s`);
  log(state, `📊 ${state.rate}/min │ ${state.successCount} new, ${state.dupCount} dups, ${state.failCount} fails`);
  await closeHarvestTab(tabId);
  state.harvestTabId = null;
  await saveState(state);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "start") {
    (async () => {
      const s = await getState();
      if (s.running) { sendResponse({ ok: false, error: "Already running" }); return; }
      s.completed = false;
      s.error = null;
      await chrome.storage.local.set({ tmptState: s, tmptStopRequested: false });
      sendResponse({ ok: true });
      runGeneration(msg.target);
    })();
    return true;
  }

  if (msg.type === "stop") {
    (async () => {
      await chrome.storage.local.set({ tmptStopRequested: true });
      const s = await getState();
      log(s, "⏹ Stop signal sent");
      s.running = false;
      s.completed = false;
      s.error = null;
      s.epoch = Date.now();
      if (s.harvestTabId) {
        await closeHarvestTab(s.harvestTabId);
        s.harvestTabId = null;
      }
      await chrome.storage.local.set({ tmptState: s });
      broadcastProgress(s);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === "getState") {
    (async () => {
      const s = await getState();
      if (s.running) {
        if (!s.harvestTabId || !(await tabExists(s.harvestTabId))) {
          s.running = false;
          s.harvestTabId = null;
          s.error = null;
          s.completed = false;
          await chrome.storage.local.set({ tmptState: s });
        }
      }
      broadcastProgress(s);
      sendResponse(s);
    })();
    return true;
  }

  if (msg.type === "clearBank") {
    (async () => {
      const s = await getState();
      await chrome.storage.local.set({ tmptStopRequested: true });
      if (s.harvestTabId) await closeHarvestTab(s.harvestTabId);
      s.bank = [];
      s.current = 0;
      s.completed = false;
      s.error = null;
      s.running = false;
      s.rate = 0;
      s.eta = null;
      s.startedAt = null;
      s.lastCookieAt = null;
      s.harvestTabId = null;
      s.successCount = 0;
      s.failCount = 0;
      s.dupCount = 0;
      s.epoch = Date.now();
      await chrome.storage.local.set({ tmptState: s, tmptStopRequested: false });
      broadcastProgress(s);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === "clearLogs") {
    (async () => {
      const s = await getState();
      s.logs = [];
      await chrome.storage.local.set({ tmptState: s });
      broadcastProgress(s);
      sendResponse({ ok: true });
    })();
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const s = await getState();
  if (s.harvestTabId) {
    await closeHarvestTab(s.harvestTabId);
    s.harvestTabId = null;
    s.running = false;
    await chrome.storage.local.set({ tmptState: s });
  }
});
