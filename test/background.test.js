import test from 'node:test';
import assert from 'node:assert/strict';

test('installation injects content script into already open regular tabs', async () => {
  const listeners = {};
  const event = name => ({ addListener(fn) { listeners[name] = fn; } });
  const injected = [];
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
      sendMessage: async () => {},
      onActivated: event('activated'), onCreated: event('created'),
      onUpdated: event('updated'), onRemoved: event('removed')
    },
    scripting: { executeScript: async details => { injected.push(details); } },
    storage: {
      local: { get: async () => ({}), set: async () => {} },
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
  while (injected.length < 2 && Date.now() - start < 1000) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(injected.map(item => item.target.tabId).sort(), [1, 2]);
  assert.ok(injected.every(item => item.files?.includes('content.js')));
  delete globalThis.chrome;
});
