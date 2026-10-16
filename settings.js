export const defaults = Object.freeze({
  thresholds: [5, 30, 120],
  colors: ["#35b96b", "#f5a623", "#e65454", "#9299a5"],
  mode: "steps",
  style: "bar",
  barPosition: "bottom",
  barHeight: 3,
  dwellSeconds: 10,
  afkSeconds: 60,
  pauseWhenUnfocused: true,
  exclusions: []
});

export function normalizeSettings(value = {}) {
  const s = { ...defaults, ...value };
  s.thresholds = Array.isArray(s.thresholds) && s.thresholds.length === 3
    ? s.thresholds.map(Number) : [...defaults.thresholds];
  if (s.thresholds.some((n, i) => !Number.isFinite(n) || n <= 0 || (i && n <= s.thresholds[i - 1]))) s.thresholds = [...defaults.thresholds];
  s.colors = Array.isArray(s.colors) && s.colors.length === 4 && s.colors.every(c => /^#[0-9a-f]{6}$/i.test(c))
    ? s.colors : [...defaults.colors];
  if (!['steps', 'gradient'].includes(s.mode)) s.mode = defaults.mode;
  if (!['bar', 'dot', 'border'].includes(s.style)) s.style = defaults.style;
  if (!['top', 'bottom'].includes(s.barPosition)) s.barPosition = defaults.barPosition;
  s.barHeight = Math.min(6, Math.max(1, Math.round(Number(s.barHeight) || 3)));
  s.dwellSeconds = Math.min(120, Math.max(1, Math.round(Number(s.dwellSeconds) || 10)));
  s.afkSeconds = Math.min(3600, Math.max(15, Math.round(Number(s.afkSeconds) || 60)));
  s.pauseWhenUnfocused = Boolean(s.pauseWhenUnfocused);
  s.exclusions = Array.isArray(s.exclusions) ? s.exclusions.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean).slice(0, 200) : [];
  return s;
}

export function colorForAge(minutes, settings) {
  const t = settings.thresholds, c = settings.colors;
  if (settings.mode === 'steps') return c[minutes < t[0] ? 0 : minutes < t[1] ? 1 : minutes < t[2] ? 2 : 3];
  if (minutes <= 0) return c[0];
  if (minutes >= t[2]) return c[3];
  const points = [0, ...t];
  const left = minutes < t[0] ? 0 : minutes < t[1] ? 1 : 2;
  const fraction = (minutes - points[left]) / (points[left + 1] - points[left]);
  const a = c[left].match(/\w\w/g).map(x => parseInt(x, 16));
  const b = c[left + 1].match(/\w\w/g).map(x => parseInt(x, 16));
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * fraction).toString(16).padStart(2, '0')).join('');
}

export function isExcluded(url, patterns) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  return patterns.some(raw => {
    const p = raw.trim().toLowerCase();
    if (!p) return false;
    if (!p.includes('://') && !p.includes('/')) {
      const host = p.replace(/^\*\./, '');
      return parsed.hostname.toLowerCase() === host || parsed.hostname.toLowerCase().endsWith('.' + host);
    }
    const regex = '^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
    try { return new RegExp(regex, 'i').test(url); } catch { return false; }
  });
}
