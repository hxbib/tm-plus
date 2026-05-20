/**
 * Ticketmaster+ Cookie Harvester v5.23.25
 * The UI for this version of the extension was build by v0 by Vercel - I was just experimenting with its frontend skills in general with the free $5 credits
 */
'use strict';

const CONFIG = {
  AUTH_URL: 'https://auth.ticketmaster.com/as/authorization.oauth2?' +
    'client_id=8bf7204a7e97.web.ticketmaster.us&response_type=code&' +
    'scope=openid%20profile%20phone%20email%20tm&' +
    'redirect_uri=https://identity.ticketmaster.com/exchange&' +
    'visualPresets=tm&lang=en-us&placementId=mytmlogin&' +
    'hideLeftPanel=false&integratorId=prd1741.iccp&' +
    'intSiteToken=tm-us&doNotTrack=false&disableAutoOptIn=false',
  COOKIE_URL: 'https://www.ticketmaster.com',
  AUTH_COOKIE_URL: 'https://auth.ticketmaster.com',
  DEFAULT_TARGET: 100,
  POLL_ATTEMPTS: 30,
  POLL_INTERVAL: 300,
  PAGE_TIMEOUT: 20000,
  MAX_FAILS: 35,
  MAX_TIMEOUTS: 25,
  MAX_LOGS: 500,
  TRIM_LOGS: 300,
  POST_LOAD_DELAY: 1000
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const timestamp = () => new Date().toLocaleTimeString('en-US', { hour12: false });

const DEFAULT_STATE = {
  running: false,
  bank: [],
  current: 0,
  total: CONFIG.DEFAULT_TARGET,
  logs: [],
  error: null,
  completed: false,
  harvestTabId: null,
  startedAt: null,
  lastCookieAt: null,
  rate: 0,
  eta: null,
  successCount: 0,
  failCount: 0,
  dupCount: 0,
  epoch: 0
};

async function getState() {
  try {
    const { tmptState } = await chrome.storage.local.get('tmptState');
    return tmptState ? { ...DEFAULT_STATE, ...tmptState } : { ...DEFAULT_STATE };
  } catch (e) {
    return { ...DEFAULT_STATE };
  }
}

async function saveState(state) {
  try {
    const { tmptState: stored } = await chrome.storage.local.get('tmptState');
    if (state.epoch && stored?.epoch > state.epoch) {
      state.running = false;
      return false;
    }

    const { tmptStopRequested } = await chrome.storage.local.get('tmptStopRequested');
    if (tmptStopRequested) {
      state.running = false;
    }

    await chrome.storage.local.set({ tmptState: state });
    broadcastProgress(state);
    return true;
  } catch (e) {
    return false;
  }
}

function broadcastProgress(state) {
  const payload = {
    type: 'progress',
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
    harvestTabId: state.harvestTabId
  };

  chrome.runtime.sendMessage(payload).catch(() => {});
}

function log(state, msg) {
  state.logs.push('[' + timestamp() + '] ' + msg);
  if (state.logs.length > CONFIG.MAX_LOGS) {
    state.logs = state.logs.slice(-CONFIG.TRIM_LOGS);
  }
}

function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve('timeout');
    }, CONFIG.PAGE_TIMEOUT);

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

async function pollForCookie() {
  for (let i = 1; i <= CONFIG.POLL_ATTEMPTS; i++) {
    try {
      const [c1, c2] = await Promise.all([
        chrome.cookies.get({ url: CONFIG.COOKIE_URL, name: 'tmpt' }),
        chrome.cookies.get({ url: CONFIG.AUTH_COOKIE_URL, name: 'tmpt' })
      ]);

      if (c1?.value) return c1.value;
      if (c2?.value) return c2.value;
    } catch (e) {
    }

    if (i < CONFIG.POLL_ATTEMPTS) {
      await sleep(CONFIG.POLL_INTERVAL);
    }
  }
  return null;
}

async function deleteTmptCookie() {
  const urls = [CONFIG.COOKIE_URL, CONFIG.AUTH_COOKIE_URL];
  await Promise.allSettled(
    urls.map(url => chrome.cookies.remove({ url, name: 'tmpt' }).catch(() => {}))
  );
}

async function isStopRequested() {
  try {
    const { tmptStopRequested } = await chrome.storage.local.get('tmptStopRequested');
    return !!tmptStopRequested;
  } catch (e) {
    return false;
  }
}

async function closeHarvestTab(tabId) {
  if (!tabId) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch (e) {
  }
}

async function tabExists(tabId) {
  if (!tabId) return false;
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch (e) {
    return false;
  }
}

async function runGeneration(targetCount) {
  await chrome.storage.local.set({ tmptStopRequested: false });

  const prev = await getState();
  const epoch = Date.now();

  const prevLogs = prev.logs?.length ? [...prev.logs] : [];
  if (prevLogs.length > 0) {
    prevLogs.push('');
    prevLogs.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    prevLogs.push('');
  }

  const state = {
    running: true,
    bank: prev.bank?.length ? [...prev.bank] : [],
    current: 0,
    total: targetCount || CONFIG.DEFAULT_TARGET,
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
    epoch
  };

  if (state.bank.length) {
    log(state, '📦 Resuming with ' + state.bank.length + ' cookies banked');
  }
  log(state, '🚀 Starting harvest - Target: ' + state.total);

  let harvestTab;
  try {
    harvestTab = await chrome.tabs.create({ url: 'about:blank', active: false });
    state.harvestTabId = harvestTab.id;
    log(state, '🔗 Harvest tab created');
  } catch (e) {
    state.error = 'Failed to create harvest tab';
    state.running = false;
    log(state, '❌ ' + e.message);
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
      log(state, '⏹ Stopped by user');
      await terminateHarvest(state, tabId);
      return;
    }

    state.current++;

    const elapsedMin = (Date.now() - t0) / 60000;
    if (elapsedMin > 0.05) {
      state.rate = Math.round((cookiesThisRun / elapsedMin) * 10) / 10;
      const remaining = state.total - state.bank.length;
      state.eta = state.rate > 0 ? Math.round((remaining / state.rate) * 60) : null;
    }

    const rateStr = state.rate > 0 ? ' | ' + state.rate + '/min' : '';
    log(state, '── Cycle ' + state.current + ' | Bank: ' + state.bank.length + '/' + state.total + rateStr + ' ──');

    if (!(await saveState(state))) {
      await closeHarvestTab(tabId);
      return;
    }

    await deleteTmptCookie();

    try {
      await chrome.tabs.update(tabId, { url: CONFIG.AUTH_URL });
    } catch (e) {
      log(state, '❌ Harvest tab closed: ' + e.message);
      state.error = 'Harvest tab was closed';
      state.running = false;
      state.harvestTabId = null;
      await saveState(state);
      return;
    }

    const loadResult = await waitForTabLoad(tabId);

    if (await isStopRequested()) {
      log(state, '⏹ Stopped by user');
      await terminateHarvest(state, tabId);
      return;
    }

    if (loadResult === 'timeout') {
      consecutiveFails++;
      state.failCount++;
      log(state, '⏱ Page timeout (' + consecutiveFails + ' consecutive)');

      if (consecutiveFails >= CONFIG.MAX_TIMEOUTS) {
        state.error = consecutiveFails + ' consecutive timeouts - halted';
        state.running = false;
        state.completed = true;
        await closeHarvestTab(tabId);
        state.harvestTabId = null;
        await saveState(state);
        return;
      }
      continue;
    }

    await sleep(CONFIG.POST_LOAD_DELAY);

    const tmpt = await pollForCookie();

    if (tmpt && !state.bank.includes(tmpt)) {
      state.bank.push(tmpt);
      state.lastCookieAt = Date.now();
      consecutiveFails = 0;
      cookiesThisRun++;
      state.successCount++;
      log(state, '🔑 #' + state.bank.length + ': ' + tmpt.substring(0, 40) + '...');
    } else if (tmpt) {
      consecutiveFails++;
      state.dupCount++;
      log(state, '♻️ Duplicate (' + consecutiveFails + ' consecutive)');
    } else {
      consecutiveFails++;
      state.failCount++;
      log(state, '⚠️ No tmpt received (' + consecutiveFails + ' consecutive)');
    }

    if (!(await saveState(state))) {
      await closeHarvestTab(tabId);
      return;
    }

    if (consecutiveFails >= CONFIG.MAX_FAILS) {
      state.error = consecutiveFails + ' consecutive failures - halted';
      state.running = false;
      state.completed = true;
      await closeHarvestTab(tabId);
      state.harvestTabId = null;
      await saveState(state);
      return;
    }

    if (await isStopRequested()) {
      log(state, '⏹ Stopped by user');
      await terminateHarvest(state, tabId);
      return;
    }
  }

  state.running = false;
  state.completed = true;
  const totalSec = Math.round((Date.now() - t0) / 1000);
  log(state, '✅ TARGET REACHED! ' + state.bank.length + '/' + state.total + ' in ' + totalSec + 's');
  log(state, '📊 ' + state.rate + '/min | ' + state.successCount + ' new, ' + state.dupCount + ' dups, ' + state.failCount + ' fails');
  await closeHarvestTab(tabId);
  state.harvestTabId = null;
  await saveState(state);
}

async function terminateHarvest(state, tabId) {
  state.running = false;
  await chrome.storage.local.set({ tmptStopRequested: false });
  await closeHarvestTab(tabId);
  state.harvestTabId = null;
  await saveState(state);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handlers = {
    async start() {
      const s = await getState();
      if (s.running) {
        return { ok: false, error: 'Already running' };
      }

      s.completed = false;
      s.error = null;
      await chrome.storage.local.set({ tmptState: s, tmptStopRequested: false });

      runGeneration(msg.target);
      return { ok: true };
    },

    async stop() {
      await chrome.storage.local.set({ tmptStopRequested: true });
      const s = await getState();
      log(s, '⏹ Stop signal sent');
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
      return { ok: true };
    },

    async getState() {
      const s = await getState();

      if (s.running && (!s.harvestTabId || !(await tabExists(s.harvestTabId)))) {
        s.running = false;
        s.harvestTabId = null;
        s.error = null;
        s.completed = false;
        await chrome.storage.local.set({ tmptState: s });
      }

      broadcastProgress(s);
      return s;
    },

    async clearBank() {
      await chrome.storage.local.set({ tmptStopRequested: true });
      const s = await getState();

      if (s.harvestTabId) {
        await closeHarvestTab(s.harvestTabId);
      }

      Object.assign(s, {
        bank: [],
        current: 0,
        completed: false,
        error: null,
        running: false,
        rate: 0,
        eta: null,
        startedAt: null,
        lastCookieAt: null,
        harvestTabId: null,
        successCount: 0,
        failCount: 0,
        dupCount: 0,
        epoch: Date.now()
      });

      await chrome.storage.local.set({ tmptState: s, tmptStopRequested: false });
      broadcastProgress(s);
      return { ok: true };
    },

    async clearLogs() {
      const s = await getState();
      s.logs = [];
      await chrome.storage.local.set({ tmptState: s });
      broadcastProgress(s);
      return { ok: true };
    }
  };

  const handler = handlers[msg.type];
  if (handler) {
    handler().then(sendResponse).catch(e => {
      sendResponse({ ok: false, error: e.message });
    });
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

chrome.runtime.onStartup.addListener(async () => {
  const s = await getState();
  if (s.running) {
    s.running = false;
    s.harvestTabId = null;
    await chrome.storage.local.set({ tmptState: s });
  }
});