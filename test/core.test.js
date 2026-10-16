import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceClock, ageMinutes, qualifiesDwell, canCountInteraction } from '../clock.js';
import { defaults, colorForAge, isExcluded, normalizeSettings } from '../settings.js';

test('clock pauses outside Chrome and while AFK, then resumes without backfilling', () => {
  let clock = { total: 0, anchor: 0 };
  clock = advanceClock(clock, 30_000, true);
  clock = advanceClock(clock, 7_230_000, false);
  assert.equal(clock.total, 30_000);
  clock = advanceClock(clock, 7_260_000, true);
  assert.equal(clock.total, 60_000);
});

test('sleep and dormant service worker gaps are capped', () => {
  assert.equal(advanceClock({ total: 1000, anchor: 0 }, 3_600_000, true).total, 36_000);
});

test('quick tab sweep leaves last-used values unchanged', () => {
  const settings = normalizeSettings();
  let clock = { total: 0, anchor: 0 };
  const tabs = Array.from({ length: 20 }, () => ({ lastUsed: 0 }));
  for (let i = 0; i < tabs.length; i++) {
    clock = advanceClock(clock, (i + 1) * 500, true);
    if (qualifiesDwell(i * 500, (i + 1) * 500, settings.dwellSeconds)) tabs[i].lastUsed = clock.total;
  }
  assert.ok(tabs.every(tab => tab.lastUsed === 0));
  assert.equal(clock.total, 10_000);
});

test('interaction counts only in the selected tab of the focused, active window', () => {
  const current = { tabId: 7, currentTabId: 7, windowId: 2, focusedWindowId: 2, idleState: 'active', visible: true };
  assert.ok(canCountInteraction(current));
  for (const change of [{ tabId: 8 }, { windowId: 3 }, { focusedWindowId: -1 }, { idleState: 'idle' }, { idleState: 'locked' }, { visible: false }]) {
    assert.equal(canCountInteraction({ ...current, ...change }), false);
  }
});

test('colors change at active-time boundaries', () => {
  const s = normalizeSettings();
  assert.equal(colorForAge(4.99, s), defaults.colors[0]);
  assert.equal(colorForAge(5, s), defaults.colors[1]);
  assert.equal(colorForAge(30, s), defaults.colors[2]);
  assert.equal(colorForAge(120, s), defaults.colors[3]);
  assert.equal(ageMinutes(300_000, 0), 5);
  const gradient = { ...s, mode: 'gradient' };
  assert.equal(colorForAge(0, gradient), defaults.colors[0]);
  assert.equal(colorForAge(5, gradient), defaults.colors[1]);
  assert.equal(colorForAge(30, gradient), defaults.colors[2]);
  assert.equal(colorForAge(120, gradient), defaults.colors[3]);
});

test('domain and URL exclusions', () => {
  assert.ok(isExcluded('https://mail.gmail.com/mail/u/0/', ['gmail.com']));
  assert.ok(isExcluded('https://example.com/private/a', ['https://example.com/private/*']));
  assert.ok(!isExcluded('https://otherexample.com/', ['example.com']));
});
