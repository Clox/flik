import { defaults, normalizeSettings } from './settings.js';

const form = document.querySelector('#settings');
const status = document.querySelector('#status');
const field = id => document.getElementById(id);

function read() {
  return {
    thresholds: [0, 1, 2].map(i => Number(field(`threshold${i}`).value)),
    colors: [0, 1, 2, 3].map(i => field(`color${i}`).value),
    mode: field('mode').value,
    style: field('style').value,
    barPosition: field('barPosition').value,
    barHeight: Number(field('barHeight').value),
    dwellSeconds: Number(field('dwellSeconds').value),
    afkSeconds: Number(field('afkSeconds').value),
    pauseWhenUnfocused: field('pauseWhenUnfocused').checked,
    exclusions: field('exclusions').value.split('\n').map(x => x.trim()).filter(Boolean)
  };
}

function fill(s) {
  for (const name of ['mode', 'style', 'barPosition', 'barHeight', 'dwellSeconds', 'afkSeconds']) field(name).value = s[name];
  for (let i = 0; i < 3; i++) field(`threshold${i}`).value = s.thresholds[i];
  for (let i = 0; i < 4; i++) field(`color${i}`).value = s.colors[i];
  field('pauseWhenUnfocused').checked = s.pauseWhenUnfocused;
  field('exclusions').value = s.exclusions.join('\n');
  preview();
}

function preview() {
  const s = read(), ctx = field('preview').getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = '#173c58'; ctx.beginPath(); ctx.roundRect(0, 0, 64, 64, 12); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 43px system-ui'; ctx.fillText('F', 18, 48);
  ctx.fillStyle = s.colors[1];
  if (s.style === 'bar') ctx.fillRect(0, s.barPosition === 'top' ? 0 : 64 - s.barHeight * 4, 64, s.barHeight * 4);
  else if (s.style === 'dot') { ctx.beginPath(); ctx.arc(51, 51, 10, 0, Math.PI * 2); ctx.fill(); }
  else { ctx.strokeStyle = s.colors[1]; ctx.lineWidth = 8; ctx.strokeRect(4, 4, 56, 56); }
}

form.addEventListener('input', preview);
form.addEventListener('submit', async event => {
  event.preventDefault();
  const s = read();
  if (s.thresholds.some((v, i) => !Number.isInteger(v) || v < 1 || (i > 0 && v <= s.thresholds[i - 1]))) {
    status.textContent = 'Färggränserna måste vara stigande positiva heltal.'; status.className = 'error'; return;
  }
  await chrome.storage.local.set({ settings: normalizeSettings(s) });
  status.textContent = 'Sparat'; status.className = '';
  setTimeout(() => { status.textContent = ''; }, 2500);
});

const saved = await chrome.storage.local.get('settings');
fill(normalizeSettings(saved.settings || defaults));
