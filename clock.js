export function advanceClock(clock, now, active, maxGapMs = 35000) {
  const previous = Number.isFinite(clock.anchor) ? clock.anchor : now;
  const delta = Math.max(0, Math.min(now - previous, maxGapMs));
  return { total: Math.max(0, clock.total || 0) + (active ? delta : 0), anchor: now };
}

export function ageMinutes(total, lastUsed) {
  return Math.max(0, (total - lastUsed) / 60000);
}

export function qualifiesDwell(selectedSince, now, seconds) {
  return now - selectedSince >= seconds * 1000;
}

export function canCountInteraction({ tabId, currentTabId, windowId, focusedWindowId, idleState, visible }) {
  return tabId === currentTabId && windowId === focusedWindowId &&
    focusedWindowId >= 0 && idleState === 'active' && visible === true;
}
