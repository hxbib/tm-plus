/**
 * Ticketmaster+ Cookie Harvester v5.23.25
 * The UI for this version of the extension was build by Replit - I was just experimenting with its frontend skills in general with the free plan.
 */

const AUTH_URL =
  "https://auth.ticketmaster.com/as/authorization.oauth2?" +
  "client_id=8bf7204a7e97.web.ticketmaster.us&response_type=code&" +
  "scope=openid%20profile%20phone%20email%20tm&" +
  "redirect_uri=https://identity.ticketmaster.com/exchange&" +
  "visualPresets=tm&lang=en-us&placementId=mytmlogin&" +
  "hideLeftPanel=false&integratorId=prd1741.iccp&" +
  "intSiteToken=tm-us&doNotTrack=false&disableAutoOptIn=false";

const COOKIE_URL       = "https://www.ticketmaster.com";
const AUTH_COOKIE_URL  = "https://auth.ticketmaster.com";
const DEFAULT_TARGET   = 100;
const POLL_ATTEMPTS    = 30;
const POLL_INTERVAL_MS = 300;
const PAGE_TIMEOUT_MS  = 20000;

const FAIL_HALT  = 35;
const TIMEOUT_HALT = 25;

const MIN_SAVE_INTERVAL_MS = 400;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const DEFAULT_STATE = () => ({
  running: false, bank: [], current: 0, total: DEFAULT_TARGET,
  logs: [], error: null, completed: false, harvestTabId: null,
  startedAt: null, lastCookieAt: null, rate: 0, eta: null,
  successCount: 0, failCount: 0, dupCount: 0, epoch: 0,
});

async function getState() {
  const { tmptState } = await chrome.storage.local.get("tmptState");
  return tmptState || DEFAULT_STATE();
}

async function saveState(state) {
  const { tmptState: stored } = await chrome.storage.local.get("tmptState");
  const storedEpoch = stored?.epoch || 0;
  if (state.epoch && storedEpoch > state.epoch) {
    state.running = false;
    return false;
  }

  if (await isStopRequested()) state.running = false;

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
  state.logs.push("[" + ts + "] " + msg);
  if (state.logs.length > 500) state.logs = state.logs.slice(-300);
}

function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve("timeout");
    }, PAGE_TIMEOUT_MS);

    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve("loaded");
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function pollForCookie() {
  for (let i = 1; i <= POLL_ATTEMPTS; i++) {
    const [c1, c2] = await Promise.all([
      chrome.cookies.get({ url: COOKIE_URL, name: "tmpt" }),
      chrome.cookies.get({ url: AUTH_COOKIE_URL, name: "tmpt" }),
    ]);
    if (c1?.value) return c1.value;
    if (c2?.value) return c2.value;
    if (i < POLL_ATTEMPTS) await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

async function deleteTmptCookie() {
  await Promise.allSettled([
    chrome.cookies.remove({ url: COOKIE_URL, name: "tmpt" }),
    chrome.cookies.remove({ url: AUTH_COOKIE_URL, name: "tmpt" }),
  ]);
}

async function isStopRequested() {
  const { tmptStopRequested } = await chrome.storage.local.get("tmptStopRequested");
  return !!tmptStopRequested;
}

async function closeHarvestTab(tabId) {
  if (!tabId) return;
  try { await chrome.tabs.remove(tabId); } catch (_) {}
}

async function tabExists(tabId) {
  if (!tabId) return false;
  try { await chrome.tabs.get(tabId); return true; } catch (_) { return false; }
}

let _pendingSave = null;
let _lastSaveAt  = 0;

async function throttledSave(state) {
  const now = Date.now();
  const delta = now - _lastSaveAt;

  if (delta >= MIN_SAVE_INTERVAL_MS) {
    _lastSaveAt = now;
    return saveState(state);
  }

  if (_pendingSave) clearTimeout(_pendingSave);
  return new Promise(resolve => {
    _pendingSave = setTimeout(async () => {
      _pendingSave = null;
      _lastSaveAt = Date.now();
      resolve(await saveState(state));
    }, MIN_SAVE_INTERVAL_MS - delta);
  });
}

async function runGeneration(targetCount) {
  await chrome.storage.local.set({ tmptStopRequested: false });

  const prev = await getState();
  const prevLogs = prev.logs?.length ? [...prev.logs] : [];
  if (prevLogs.length > 0) {
    prevLogs.push("", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", "");
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

  if (state.bank.length) log(state, "📦 Resuming with " + state.bank.length + " cookies already banked");
  log(state, "🚀 Starting harvest — Target: " + state.total + " cookies");

  let harvestTab;
  try {
    harvestTab = await chrome.tabs.create({ url: "about:blank", active: false });
    state.harvestTabId = harvestTab.id;
    log(state, "🔗 Harvest tab created in background");
  } catch (e) {
    state.error = "Failed to create harvest tab";
    state.running = false;
    log(state, "❌ " + e.message);
    await saveState(state);
    return;
  }

  if (!(await saveState(state))) return;

  const tabId = harvestTab.id;
  let consecutiveFails = 0;
  let cookiesThisRun   = 0;
  const t0             = Date.now();

  const bankSet = new Set(state.bank);

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
    if (elapsedMin > 0.05 && cookiesThisRun > 0) {
      state.rate = Math.round((cookiesThisRun / elapsedMin) * 10) / 10;
      const remaining = state.total - state.bank.length;
      state.eta = state.rate > 0 ? Math.round((remaining / state.rate) * 60) : null;
    }

    const rateStr = state.rate > 0 ? " │ " + state.rate + "/min" : "";
    log(state, "── Cycle " + state.current + " │ Bank: " + state.bank.length + "/" + state.total + rateStr + " ──");

    if (!(await throttledSave(state))) {
      await closeHarvestTab(tabId);
      return;
    }

    await deleteTmptCookie();

    try {
      await chrome.tabs.update(tabId, { url: AUTH_URL });
    } catch (e) {
      log(state, "❌ Harvest tab closed: " + e.message);
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
      log(state, "⏱ Page load timeout (" + consecutiveFails + " consecutive)");

      if (consecutiveFails >= TIMEOUT_HALT) {
        state.error = consecutiveFails + " consecutive timeouts — halted";
        state.running = false;
        state.completed = true;
        await closeHarvestTab(tabId);
        state.harvestTabId = null;
        await saveState(state);
        return;
      }

      const backoff = Math.min(500 * Math.pow(1.5, consecutiveFails - 1), 8000);
      await sleep(backoff);
      continue;
    }

    await sleep(1000);

    const tmpt = await pollForCookie();

    if (tmpt && !bankSet.has(tmpt)) {
      state.bank.push(tmpt);
      bankSet.add(tmpt);
      state.lastCookieAt = Date.now();
      consecutiveFails   = 0;
      cookiesThisRun++;
      state.successCount++;
      log(state, "🔑 #" + state.bank.length + ": " + tmpt.substring(0, 40) + "...");
    } else if (tmpt) {
      consecutiveFails++;
      state.dupCount++;
      log(state, "♻️ Duplicate (" + consecutiveFails + " consecutive)");
    } else {
      consecutiveFails++;
      state.failCount++;
      log(state, "⚠️ No tmpt received (" + consecutiveFails + " consecutive)");
    }

    if (!(await throttledSave(state))) {
      await closeHarvestTab(tabId);
      return;
    }

    if (consecutiveFails >= FAIL_HALT) {
      state.error = consecutiveFails + " consecutive failures — halted";
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

  state.running   = false;
  state.completed = true;
  const totalSec  = Math.round((Date.now() - t0) / 1000);
  log(state, "✅ TARGET REACHED! " + state.bank.length + "/" + state.total + " in " + totalSec + "s");
  log(state, "📊 " + state.rate + "/min │ " + state.successCount + " new, " + state.dupCount + " dups, " + state.failCount + " fails");
  await closeHarvestTab(tabId);
  state.harvestTabId = null;
  await saveState(state);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  if (msg.type === "start") {
    (async () => {
      const s = await getState();
      if (s.running) { sendResponse({ ok: false, error: "Already running" }); return; }
      s.completed = false;
      s.error     = null;
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
      s.running    = false;
      s.completed  = false;
      s.error      = null;
      s.epoch      = Date.now();
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
          s.running      = false;
          s.harvestTabId = null;
          s.error        = null;
          s.completed    = false;
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

      s.bank          = [];
      s.current       = 0;
      s.completed     = false;
      s.error         = null;
      s.running       = false;
      s.rate          = 0;
      s.eta           = null;
      s.startedAt     = null;
      s.lastCookieAt  = null;
      s.harvestTabId  = null;
      s.successCount  = 0;
      s.failCount     = 0;
      s.dupCount      = 0;
      s.epoch         = Date.now();

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
    s.running      = false;
    await chrome.storage.local.set({ tmptState: s });
  }
});