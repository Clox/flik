import { defaults, normalizeSettings, colorForAge, isExcluded } from './settings.js';
import { advanceClock, ageMinutes, qualifiesDwell, canCountInteraction } from './clock.js';

const STORAGE_KEY = 'flikState';
const TICK = 'flik-tick';
const MENU = 'flik-toggle-tab';
let settings = defaults;
let state = { clock: { total: 0, anchor: Date.now() }, tabs: {}, excludedTabs: [] };
let focusedWindowId = chrome.windows.WINDOW_ID_NONE;
let idleState = 'active';
let currentTabId = null;
let selectedSince = Date.now();
let lastColors = new Map();
let ready;
let queue = Promise.resolve();
let dwellCheckTimer;

function scheduleDwellCheck() {
  clearTimeout(dwellCheckTimer);
  if (currentTabId == null || !running()) return;
  const tabId = currentTabId;
  const windowId = focusedWindowId;
  const since = selectedSince;
  dwellCheckTimer = setTimeout(() => serialized(async () => {
    if (currentTabId !== tabId || focusedWindowId !== windowId || selectedSince !== since || !running()) return;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.active || tab.windowId !== windowId) return;
    settle();
    await save();
    await updateTab(tab, true);
  }), Math.max(0, settings.dwellSeconds * 1000 - (Date.now() - since)) + 100);
  dwellCheckTimer.unref?.();
}

function serialized(job) {
  queue = queue.then(async () => { await initialize(); return job(); }).catch(console.error);
  return queue;
}

async function initialize() {
  if (ready) return ready;
  ready = (async () => {
    const [saved, session] = await Promise.all([
      chrome.storage.local.get(['settings', STORAGE_KEY]),
      chrome.storage.session.get(['excludedTabs', 'selection'])
    ]);
    settings = normalizeSettings(saved.settings);
    const old = saved[STORAGE_KEY];
    if (old?.clock) state = { clock: { total: Number(old.clock.total) || 0, anchor: Date.now() }, tabs: old.tabs || {}, excludedTabs: [] };
    state.excludedTabs = Array.isArray(session.excludedTabs) ? session.excludedTabs : [];
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    const focused = windows.find(w => w.focused);
    focusedWindowId = focused?.id ?? chrome.windows.WINDOW_ID_NONE;
    currentTabId = focused?.tabs?.find(t => t.active)?.id ?? null;
    selectedSince = Date.now();
    idleState = await chrome.idle.queryState(settings.afkSeconds);
    if (idleState === 'active' && currentTabId != null &&
      session.selection?.tabId === currentTabId && session.selection?.windowId === focusedWindowId &&
      Number.isFinite(session.selection?.since)) {
      selectedSince = Math.min(Date.now(), session.selection.since);
    }

    // A restored browser session often assigns new tab IDs. Match exact URLs once.
    const live = windows.flatMap(w => w.tabs || []);
    const oldEntries = Object.entries(state.tabs);
    const used = new Set();
    const mapped = {};
    for (const tab of live) {
      let entry = state.tabs[tab.id];
      if (entry?.url !== tab.url) entry = null;
      if (entry) used.add(String(tab.id));
      if (!entry) {
        const found = oldEntries.find(([id, value]) => !used.has(id) && value.url === tab.url);
        if (found) { used.add(found[0]); entry = found[1]; }
      }
      mapped[tab.id] = { url: tab.url || '', lastUsed: entry?.lastUsed ?? state.clock.total };
    }
    state.tabs = mapped;
    state.excludedTabs = state.excludedTabs.filter(id => live.some(t => t.id === id));
    await save();
    chrome.idle.setDetectionInterval(settings.afkSeconds);
    if (!await chrome.alarms.get(TICK)) chrome.alarms.create(TICK, { periodInMinutes: 0.5 });
    await updateAll();
    scheduleDwellCheck();
  })();
  return ready;
}

function running() {
  return idleState === 'active' && (!settings.pauseWhenUnfocused || focusedWindowId !== chrome.windows.WINDOW_ID_NONE);
}

function settle(now = Date.now(), wasRunning = running()) {
  state.clock = advanceClock(state.clock, now, wasRunning);
  if (wasRunning && currentTabId != null && qualifiesDwell(selectedSince, now, settings.dwellSeconds)) {
    const entry = state.tabs[currentTabId];
    if (entry) entry.lastUsed = state.clock.total;
  }
}

async function save() {
  const { excludedTabs, ...persistent } = state;
  await Promise.all([
    chrome.storage.local.set({ [STORAGE_KEY]: persistent }),
    chrome.storage.session.set({ excludedTabs, selection: { tabId: currentTabId, windowId: focusedWindowId, since: selectedSince } })
  ]);
}

function ensureTab(tab) {
  if (!tab?.id) return;
  const entry = state.tabs[tab.id];
  if (!entry || entry.url !== (tab.url || '')) state.tabs[tab.id] = { url: tab.url || '', lastUsed: state.clock.total };
}

async function updateTab(tab, force = false) {
  if (!tab?.id || !/^https?:/.test(tab.url || '')) return;
  ensureTab(tab);
  const excluded = state.excludedTabs.includes(tab.id) || isExcluded(tab.url, settings.exclusions);
  const color = excluded ? null : colorForAge(ageMinutes(state.clock.total, state.tabs[tab.id].lastUsed), settings);
  const signature = JSON.stringify([color, settings.style, settings.barPosition, settings.barHeight, tab.favIconUrl]);
  if (!force && lastColors.get(tab.id) === signature) return;
  const message = { type: 'indicator', color, style: settings.style, position: settings.barPosition,
    height: settings.barHeight, dwellSeconds: settings.dwellSeconds, faviconUrl: tab.favIconUrl };
  try { await chrome.tabs.sendMessage(tab.id, message); lastColors.set(tab.id, signature); }
  catch {
    // A restored or already-open page may have missed the content-script start.
    // Execute the idempotent script and try again while the page is loaded.
    if (tab.discarded) return;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, message);
      lastColors.set(tab.id, signature);
    } catch { lastColors.delete(tab.id); /* Protected, closing, or still loading. */ }
  }
}

async function updateAll(force = false) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(tab => updateTab(tab, force || (tab.id === currentTabId && running()))));
}

async function injectExistingTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter(tab => tab.id && !tab.discarded && /^https?:/.test(tab.url || '')).map(async tab => {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    } catch { /* Protected, closing, or no longer available. */ }
  }));
}

function select(tabId, windowId, now = Date.now()) {
  currentTabId = windowId === focusedWindowId ? tabId : null;
  selectedSince = now;
  scheduleDwellCheck();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU, title: 'Undanta den här fliken från markering', contexts: ['all'] }, () => void chrome.runtime.lastError);
  serialized(async () => { await injectExistingTabs(); await updateAll(true); });
});
chrome.runtime.onStartup.addListener(() => serialized(async () => { await injectExistingTabs(); await updateAll(true); }));
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== TICK) return;
  serialized(async () => {
    const [idle, focused] = await Promise.all([chrome.idle.queryState(settings.afkSeconds), chrome.windows.getLastFocused()]);
    const now = Date.now();
    const same = idle === idleState && (focused?.focused ? focused.id : chrome.windows.WINDOW_ID_NONE) === focusedWindowId;
    settle(now, same && running());
    idleState = idle;
    focusedWindowId = focused?.focused ? focused.id : chrome.windows.WINDOW_ID_NONE;
    if (!same) { currentTabId = focused?.focused ? (await chrome.tabs.query({ active: true, windowId: focused.id }))[0]?.id ?? null : null; selectedSince = now; scheduleDwellCheck(); }
    await save();
    await updateAll();
  });
});

chrome.idle.onStateChanged.addListener(next => serialized(async () => {
  // Do not backfill an interval when Chrome reports idle or locked.
  settle(Date.now(), next === 'active' && running());
  idleState = next;
  if (next === 'active') selectedSince = Date.now();
  scheduleDwellCheck();
  await save();
  await updateAll();
}));

chrome.windows.onFocusChanged.addListener(id => serialized(async () => {
  const now = Date.now();
  const focused = id === chrome.windows.WINDOW_ID_NONE ? null : await chrome.windows.get(id).catch(() => null);
  settle(now, Boolean(focused?.focused) && running());
  focusedWindowId = focused?.focused && focused.type === 'normal' ? id : chrome.windows.WINDOW_ID_NONE;
  currentTabId = focusedWindowId === chrome.windows.WINDOW_ID_NONE ? null : (await chrome.tabs.query({ active: true, windowId: id }))[0]?.id ?? null;
  selectedSince = now;
  scheduleDwellCheck();
  await save();
  await updateAll();
}));

chrome.tabs.onActivated.addListener(info => {
  const at = Date.now();
  serialized(async () => {
  settle(at);
  select(info.tabId, info.windowId, at);
  await save();
  const tab = await chrome.tabs.get(info.tabId).catch(() => null);
  await updateTab(tab);
  });
});

chrome.tabs.onCreated.addListener(tab => serialized(async () => { ensureTab(tab); await save(); await updateTab(tab); }));
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (!('url' in change) && !('favIconUrl' in change) && change.status !== 'complete') return;
  serialized(async () => { ensureTab(tab); await save(); await updateTab(tab, true); });
});
chrome.tabs.onRemoved.addListener(tabId => serialized(async () => {
  delete state.tabs[tabId];
  state.excludedTabs = state.excludedTabs.filter(id => id !== tabId);
  lastColors.delete(tabId);
  if (currentTabId === tabId) currentTabId = null;
  await save();
}));

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'diagnostics' && sender.url?.startsWith(chrome.runtime.getURL(''))) {
    (async () => {
      await initialize();
      const tabs = await chrome.tabs.query({});
      const results = await Promise.all(tabs.map(async tab => {
        const row = { id: tab.id, url: tab.url || '', discarded: Boolean(tab.discarded) };
        if (!/^https?:/.test(row.url)) return { ...row, status: 'skyddad eller annan sidtyp' };
        if (tab.discarded) return { ...row, status: 'vilande flik – laddas när den öppnas' };
        let detail;
        try { detail = await chrome.tabs.sendMessage(tab.id, { type: 'diagnostic-v2' }); }
        catch {
          try {
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
            await updateTab(tab, true);
            detail = await chrome.tabs.sendMessage(tab.id, { type: 'diagnostic-v2' });
          } catch (error) { return { ...row, status: 'skriptet kunde inte starta', error: String(error?.message || error) }; }
        }
        if (!detail?.configured) {
          await updateTab(tab, true);
          detail = await chrome.tabs.sendMessage(tab.id, { type: 'diagnostic-v2' }).catch(() => detail);
        }
        return { ...row, status: detail?.status || 'okänt', markers: detail?.markers ?? 0,
          oldMarkers: detail?.oldMarkers ?? 0, sourceCount: detail?.sourceCount ?? 0,
          cspBlocked: Boolean(detail?.cspBlocked),
          iconSizes: detail?.iconSizes || [], markerLast: Boolean(detail?.markerLast),
          soleIcon: Boolean(detail?.soleIcon),
          ageMinutes: Math.round(ageMinutes(state.clock.total, state.tabs[tab.id]?.lastUsed ?? state.clock.total) * 10) / 10,
          selected: tab.id === currentTabId && tab.windowId === focusedWindowId,
          idleState,
          expectedColor: state.excludedTabs.includes(tab.id) || isExcluded(row.url, settings.exclusions) ? null :
            colorForAge(ageMinutes(state.clock.total, state.tabs[tab.id]?.lastUsed ?? state.clock.total), settings),
          requestedColor: detail?.requestedColor ?? null,
          renderedColor: detail?.renderedColor ?? null,
          baseSource: detail?.baseSource || 'okänd',
          excluded: state.excludedTabs.includes(tab.id) || isExcluded(row.url, settings.exclusions) };
      }));
      respond({ results });
    })().catch(error => respond({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'favicon-source') {
    if (!sender.tab?.id || sender.frameId !== 0 || !/^https?:/.test(sender.tab.url || '')) return false;
    (async () => {
      const source = new URL(message.url);
      if (!['http:', 'https:'].includes(source.protocol)) throw new Error('Invalid favicon URL');
      const response = await fetch(source.href, { credentials: 'omit', signal: AbortSignal.timeout(5000) });
      if (!response.ok || !response.body) throw new Error('Favicon unavailable');
      const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      if (!mime?.startsWith('image/') || Number(response.headers.get('content-length') || 0) > 262144)
        throw new Error('Invalid favicon response');
      const reader = response.body.getReader();
      const chunks = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 262144) { await reader.cancel(); throw new Error('Favicon too large'); }
        chunks.push(value);
      }
      if (!length) throw new Error('Empty favicon');
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      respond({ dataUrl: `data:${mime};base64,` + btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')) });
    })().catch(() => respond({}));
    return true;
  }
  if (message?.type === 'favicon-fallback') {
    if (!sender.tab?.id || sender.frameId !== 0 || !/^https?:/.test(sender.tab.url || '')) return false;
    (async () => {
      // Chrome's favicon cache avoids cross-origin Canvas restrictions. The
      // page URL comes from Chrome, never from the requesting page.
      const url = new URL(chrome.runtime.getURL('/_favicon/'));
      url.searchParams.set('pageUrl', sender.tab.url);
      url.searchParams.set('size', '32');
      const response = await fetch(url);
      if (!response.ok) throw new Error('Favicon unavailable');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 65536) throw new Error('Invalid favicon size');
      const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      if (!png) throw new Error('Unsupported favicon format');
      respond({ dataUrl: 'data:image/png;base64,' + btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')) });
    })().catch(() => respond({}));
    return true;
  }
  const tab = sender.tab;
  if (!tab || sender.frameId !== 0 || !['interaction', 'dwell', 'ready'].includes(message?.type)) return false;
  serialized(async () => {
    ensureTab(tab);
    const now = Date.now();
    if (message.type === 'ready') { await updateTab(tab, true); return; }
    if (!canCountInteraction({ tabId: tab.id, currentTabId, windowId: tab.windowId, focusedWindowId, idleState, visible: message.visible })) return;
    if (message.type === 'dwell' && !qualifiesDwell(selectedSince, now, settings.dwellSeconds)) return;
    settle(now);
    state.tabs[tab.id].lastUsed = state.clock.total;
    await save();
    await updateTab(tab);
  }).then(() => respond({ ok: true }));
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  serialized(async () => {
    settle();
    settings = normalizeSettings(changes.settings.newValue);
    chrome.idle.setDetectionInterval(settings.afkSeconds);
    idleState = await chrome.idle.queryState(settings.afkSeconds);
    selectedSince = Date.now();
    scheduleDwellCheck();
    lastColors.clear();
    await save();
    await updateAll(true);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU || !tab?.id) return;
  serialized(async () => {
    const index = state.excludedTabs.indexOf(tab.id);
    if (index < 0) state.excludedTabs.push(tab.id); else state.excludedTabs.splice(index, 1);
    await save();
    await updateTab(tab, true);
  });
});
