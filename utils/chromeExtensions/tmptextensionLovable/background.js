/**
 * Ticketmaster+ Cookie Harvester v5.23.25
 * The UI for this version of the extension was build by Lovable - Wanted to give it a shot, I had yet to use "full stack app builders" like Lovable and Bolt yet.
 */

"use strict";

const AUTH_URL =
  "https://auth.ticketmaster.com/as/authorization.oauth2?" +
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
const POST_LOAD_WAIT_MS = 1000;
const MAX_LOGS = 300;
const STORAGE_WRITE_THROTTLE_MS = 200;
const BROADCAST_THROTTLE_MS = 80;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function defaultState() {
  return {
    running: false, bank: [], current: 0, total: DEFAULT_TARGET,
    logs: [], error: null, completed: false, harvestTabId: null,
    startedAt: null, lastCookieAt: null, rate: 0, eta: null,
    successCount: 0, failCount: 0, dupCount: 0, epoch: 0,
  };
}

let mem = null;
let stopRequested = false;
let storageTimer = null;
let broadcastTimer = null;
let lastBroadcastAt = 0;

async function loadState() {
  if (mem) return mem;
  try {
    const r = await chrome.storage.local.get(["tmptState", "tmptStopRequested"]);
    mem = Object.assign(defaultState(), r.tmptState || {});
    stopRequested = !!r.tmptStopRequested;
  } catch (_) {
    mem = defaultState();
  }
  return mem;
}

function scheduleStorageWrite() {
  if (storageTimer) return;
  storageTimer = setTimeout(async () => {
    storageTimer = null;
    try { await chrome.storage.local.set({ tmptState: mem }); } catch (_) {}
  }, STORAGE_WRITE_THROTTLE_MS);
}

async function flushStorage() {
  if (storageTimer) { clearTimeout(storageTimer); storageTimer = null; }
  try { await chrome.storage.local.set({ tmptState: mem }); } catch (_) {}
}

function scheduleBroadcast() {
  const now = Date.now();
  const since = now - lastBroadcastAt;
  if (since >= BROADCAST_THROTTLE_MS) {
    doBroadcast();
  } else if (!broadcastTimer) {
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      doBroadcast();
    }, BROADCAST_THROTTLE_MS - since);
  }
}

function doBroadcast() {
  if (!mem) return;
  lastBroadcastAt = Date.now();
  try {
    chrome.runtime.sendMessage({
      type: "progress",
      running: mem.running,
      current: mem.current,
      total: mem.total,
      found: mem.bank.length,
      bank: mem.bank,
      logs: mem.logs.slice(-150),
      completed: mem.completed,
      error: mem.error,
      startedAt: mem.startedAt,
      lastCookieAt: mem.lastCookieAt,
      rate: mem.rate,
      eta: mem.eta,
      successCount: mem.successCount,
      failCount: mem.failCount,
      dupCount: mem.dupCount,
      harvestTabId: mem.harvestTabId,
    }).catch(() => {});
  } catch (_) {}
}

async function commit(epoch) {
  if (epoch !== undefined && mem.epoch !== epoch) {
    return false;
  }
  if (stopRequested) mem.running = false;
  scheduleStorageWrite();
  scheduleBroadcast();
  return true;
}

function pushLog(msg) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  mem.logs.push(`[${ts}] ${msg}`);
  if (mem.logs.length > MAX_LOGS) mem.logs = mem.logs.slice(-MAX_LOGS);
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (r) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { chrome.tabs.onUpdated.removeListener(listener); } catch (_) {}
      try { chrome.tabs.onRemoved.removeListener(removed); } catch (_) {}
      resolve(r);
    };
    const timer = setTimeout(() => finish("timeout"), PAGE_LOAD_TIMEOUT_MS);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") finish("loaded");
    }
    function removed(id) {
      if (id === tabId) finish("closed");
    }
    try {
      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.onRemoved.addListener(removed);
    } catch (_) { finish("error"); }
  });
}

async function pollForCookie() {
  for (let i = 1; i <= COOKIE_POLL_ATTEMPTS; i++) {
    try {
      const c1 = await chrome.cookies.get({ url: COOKIE_URL, name: "tmpt" });
      if (c1?.value) return c1.value;
      const c2 = await chrome.cookies.get({ url: AUTH_COOKIE_URL, name: "tmpt" });
      if (c2?.value) return c2.value;
    } catch (_) {}
    if (i < COOKIE_POLL_ATTEMPTS) await sleep(COOKIE_POLL_INTERVAL_MS);
  }
  return null;
}

async function deleteTmptCookie() {
  try { await chrome.cookies.remove({ url: COOKIE_URL, name: "tmpt" }); } catch (_) {}
  try { await chrome.cookies.remove({ url: AUTH_COOKIE_URL, name: "tmpt" }); } catch (_) {}
}

async function closeTab(tabId) {
  if (!tabId) return;
  try { await chrome.tabs.remove(tabId); } catch (_) {}
}

async function tabExists(tabId) {
  if (!tabId) return false;
  try { await chrome.tabs.get(tabId); return true; } catch (_) { return false; }
}

async function setupKeepalive(on) {
  try {
    if (on) await chrome.alarms.create("tmpt-keepalive", { periodInMinutes: 0.4 });
    else await chrome.alarms.clear("tmpt-keepalive");
  } catch (_) {}
}

chrome.alarms?.onAlarm.addListener(() => {});

let runActive = false;

async function runGeneration(targetCount) {
  if (runActive) return;
  runActive = true;

  await loadState();
  stopRequested = false;
  try { await chrome.storage.local.set({ tmptStopRequested: false }); } catch (_) {}

  const prevLogs = mem.logs?.length ? [...mem.logs] : [];
  if (prevLogs.length) {
    prevLogs.push("", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", "");
  }

  const epoch = Date.now();
  const prevBank = mem.bank?.length ? [...mem.bank] : [];

  mem = Object.assign(defaultState(), {
    running: true,
    bank: prevBank,
    total: targetCount || DEFAULT_TARGET,
    logs: prevLogs,
    startedAt: Date.now(),
    lastCookieAt: mem.lastCookieAt || null,
    epoch,
  });

  if (prevBank.length) pushLog(`📦 Resuming with ${prevBank.length} cookies already banked`);
  pushLog(`🚀 Starting harvest — Target: ${mem.total} cookies`);

  await setupKeepalive(true);

  let tabId;
  try {
    const tab = await chrome.tabs.create({ url: "about:blank", active: false });
    tabId = tab.id;
    mem.harvestTabId = tabId;
    pushLog(`🔗 Harvest tab created in background`);
  } catch (e) {
    mem.error = "Failed to create harvest tab";
    mem.running = false;
    pushLog(`❌ ${e?.message || e}`);
    await commit(epoch);
    await flushStorage();
    await setupKeepalive(false);
    runActive = false;
    return;
  }

  if (!(await commit(epoch))) {
    await closeTab(tabId);
    await setupKeepalive(false);
    runActive = false;
    return;
  }

  let consecutiveFails = 0;
  let cookiesThisRun = 0;
  const t0 = Date.now();

  const teardown = async (errMsg) => {
    if (errMsg) { mem.error = errMsg; mem.completed = true; }
    mem.running = false;
    mem.harvestTabId = null;
    await closeTab(tabId);
    await setupKeepalive(false);
    await commit(epoch);
    await flushStorage();
    runActive = false;
  };

  const checkStop = async () => {
    if (stopRequested) {
      pushLog("⏹ Harvest stopped by user");
      try { await chrome.storage.local.set({ tmptStopRequested: false }); } catch (_) {}
      stopRequested = false;
      await teardown(null);
      return true;
    }
    return false;
  };

  while (mem.bank.length < mem.total) {
    if (mem.epoch !== epoch) { runActive = false; return; }
    if (await checkStop()) return;

    mem.current++;

    const elapsedMin = (Date.now() - t0) / 60000;
    if (elapsedMin > 0.05) {
      mem.rate = Math.round((cookiesThisRun / elapsedMin) * 10) / 10;
      const remaining = mem.total - mem.bank.length;
      mem.eta = mem.rate > 0 ? Math.round((remaining / mem.rate) * 60) : null;
    }

    const rateStr = mem.rate > 0 ? ` │ ${mem.rate}/min` : "";
    pushLog(`── Cycle ${mem.current} │ Bank: ${mem.bank.length}/${mem.total}${rateStr} ──`);
    if (!(await commit(epoch))) { await closeTab(tabId); runActive = false; return; }

    await deleteTmptCookie();

    try {
      await chrome.tabs.update(tabId, { url: AUTH_URL });
    } catch (e) {
      pushLog(`❌ Harvest tab closed: ${e?.message || e}`);
      await teardown("Harvest tab was closed");
      return;
    }

    const loadResult = await waitForTabLoad(tabId);

    if (await checkStop()) return;

    if (loadResult === "closed") {
      pushLog("❌ Harvest tab was closed externally");
      await teardown("Harvest tab was closed");
      return;
    }

    if (loadResult === "timeout") {
      consecutiveFails++;
      mem.failCount++;
      pushLog(`⏱ Page load timeout (${consecutiveFails} consecutive)`);
      if (consecutiveFails >= 25) {
        await teardown(`${consecutiveFails} consecutive timeouts — halted`);
        return;
      }
      if (!(await commit(epoch))) { await closeTab(tabId); runActive = false; return; }
      continue;
    }

    await sleep(POST_LOAD_WAIT_MS);

    const tmpt = await pollForCookie();

    if (tmpt && !mem.bank.includes(tmpt)) {
      mem.bank.push(tmpt);
      mem.lastCookieAt = Date.now();
      consecutiveFails = 0;
      cookiesThisRun++;
      mem.successCount++;
      pushLog(`🔑 #${mem.bank.length}: ${tmpt.substring(0, 40)}...`);
    } else if (tmpt) {
      consecutiveFails++;
      mem.dupCount++;
      pushLog(`♻️ Duplicate (${consecutiveFails} consecutive)`);
    } else {
      consecutiveFails++;
      mem.failCount++;
      pushLog(`⚠️ No tmpt received (${consecutiveFails} consecutive)`);
    }

    if (!(await commit(epoch))) { await closeTab(tabId); runActive = false; return; }

    if (consecutiveFails >= 35) {
      await teardown(`${consecutiveFails} consecutive failures — halted`);
      return;
    }

    if (await checkStop()) return;
  }

  mem.running = false;
  mem.completed = true;
  mem.harvestTabId = null;
  const totalSec = Math.round((Date.now() - t0) / 1000);
  pushLog(`✅ TARGET REACHED! ${mem.bank.length}/${mem.total} in ${totalSec}s`);
  pushLog(`📊 ${mem.rate}/min │ ${mem.successCount} new, ${mem.dupCount} dups, ${mem.failCount} fails`);
  await closeTab(tabId);
  await setupKeepalive(false);
  await commit(epoch);
  await flushStorage();
  runActive = false;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return;

  if (msg.type === "start") {
    (async () => {
      await loadState();
      if (mem.running || runActive) { sendResponse({ ok: false, error: "Already running" }); return; }
      const t = parseInt(msg.target, 10);
      const target = Math.max(1, Math.min(5000, Number.isFinite(t) ? t : DEFAULT_TARGET));
      mem.completed = false;
      mem.error = null;
      stopRequested = false;
      try { await chrome.storage.local.set({ tmptStopRequested: false }); } catch (_) {}
      sendResponse({ ok: true });
      runGeneration(target);
    })();
    return true;
  }

  if (msg.type === "stop") {
    (async () => {
      await loadState();
      stopRequested = true;
      try { await chrome.storage.local.set({ tmptStopRequested: true }); } catch (_) {}
      pushLog("⏹ Stop signal sent");
      mem.epoch = Date.now();
      mem.running = false;
      mem.completed = false;
      mem.error = null;
      if (mem.harvestTabId) { await closeTab(mem.harvestTabId); mem.harvestTabId = null; }
      await flushStorage();
      doBroadcast();
      await setupKeepalive(false);
      runActive = false;
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === "getState") {
    (async () => {
      await loadState();
      if (mem.running) {
        if (!mem.harvestTabId || !(await tabExists(mem.harvestTabId))) {
          mem.running = false;
          mem.harvestTabId = null;
          mem.error = null;
          mem.completed = false;
          await flushStorage();
        }
      }
      doBroadcast();
      sendResponse({
        running: mem.running, bank: mem.bank, current: mem.current, total: mem.total,
        logs: mem.logs, error: mem.error, completed: mem.completed, startedAt: mem.startedAt,
        lastCookieAt: mem.lastCookieAt, rate: mem.rate, eta: mem.eta,
        successCount: mem.successCount, failCount: mem.failCount, dupCount: mem.dupCount,
        harvestTabId: mem.harvestTabId,
      });
    })();
    return true;
  }

  if (msg.type === "clearBank") {
    (async () => {
      await loadState();
      stopRequested = true;
      try { await chrome.storage.local.set({ tmptStopRequested: true }); } catch (_) {}
      if (mem.harvestTabId) await closeTab(mem.harvestTabId);
      const prevLogs = mem.logs;
      mem = Object.assign(defaultState(), { logs: prevLogs, epoch: Date.now() });
      stopRequested = false;
      try { await chrome.storage.local.set({ tmptStopRequested: false }); } catch (_) {}
      await flushStorage();
      doBroadcast();
      await setupKeepalive(false);
      runActive = false;
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === "clearLogs") {
    (async () => {
      await loadState();
      mem.logs = [];
      await flushStorage();
      doBroadcast();
      sendResponse({ ok: true });
    })();
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await loadState();
  if (mem.harvestTabId) {
    await closeTab(mem.harvestTabId);
    mem.harvestTabId = null;
  }
  mem.running = false;
  mem.completed = false;
  mem.error = null;
  await flushStorage();
  await setupKeepalive(false);
});

chrome.runtime.onStartup.addListener(async () => {
  await loadState();
  if (mem.harvestTabId) {
    if (!(await tabExists(mem.harvestTabId))) {
      mem.harvestTabId = null;
      mem.running = false;
      await flushStorage();
    }
  }
});
