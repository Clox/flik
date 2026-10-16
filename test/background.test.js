import test from 'node:test';
import assert from 'node:assert/strict';

test('installation injects content script into already open regular tabs', async () => {
  const listeners = {};
  const event = name => ({ addListener(fn) { listeners[name] = fn; } });
  const injected = [];
  const sent = [];
  let missed = true;
  const tabs = [
    { id: 1, url: 'https://example.com/', windowId: 10, active: true },
    { id: 2, url: 'http://example.org/', windowId: 10, active: false },
    { id: 3, url: 'chrome://settings/', windowId: 10, active: false },
    { id: 4, url: 'https://sleeping.example/', windowId: 10, active: false, discarded: true }
  ];
  globalThis.chrome = {
    windows: { WINDOW_ID_NONE: -1, getAll: async () => [{ id: 10, focused: true, tabs }], onFocusChanged: event('focus') },
    tabs: {
      query: async () => tabs,
      sendMessage: async (id, message) => { sent.push({ id, message }); if (id === 2 && missed) { missed = false; throw new Error('Receiving end does not exist'); } },
      get: async id => tabs.find(tab => tab.id === id),
      onActivated: event('activated'), onCreated: event('created'),
      onUpdated: event('updated'), onRemoved: event('removed')
    },
    scripting: { executeScript: async details => { injected.push(details); } },
    storage: {
      local: { get: async () => ({ settings: { dwellSeconds: 1 }, flikState: { clock: { total: 600000 }, tabs: { 1: { url: tabs[0].url, lastUsed: 0 }, 2: { url: tabs[1].url, lastUsed: 0 } } } }), set: async () => {} },
      session: { get: async () => ({}), set: async () => {} },
      onChanged: event('storage')
    },
    idle: { queryState: async () => 'active', setDetectionInterval() {}, onStateChanged: event('idle') },
    alarms: { get: async () => undefined, create() {}, onAlarm: event('alarm') },
    contextMenus: { create(_details, callback) { callback(); }, onClicked: event('menu') },
    runtime: { onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message'), openOptionsPage() {}, lastError: null },
    action: { onClicked: event('action') }
  };
  await import('../background.js');
  listeners.installed();
  const start = Date.now();
  while (injected.length < 3 && Date.now() - start < 1000) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(injected.map(item => item.target.tabId).sort(), [1, 2, 2]);
  assert.ok(injected.every(item => item.files?.includes('content.js')));
  tabs[0].active = false;
  tabs[1].active = true;
  listeners.activated({ tabId: 2, windowId: 10 });
  const deadline = Date.now() + 2500;
  while (!sent.some(item => item.id === 2 && item.message?.color === '#35b96b') && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(sent.some(item => item.id === 2 && item.message?.color === '#35b96b'), 'selected tab becomes fresh after dwell without content-script message');
  delete globalThis.chrome;
});
