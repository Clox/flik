import { defaults, normalizeSettings } from './settings.js';

const form = document.querySelector('#settings');
const status = document.querySelector('#status');
const field = id => document.getElementById(id);

function read() {
  const rows = [...field('colorRows').rows];
  return {
    thresholds: rows.slice(1).map(row => Number(row.querySelector('input[type=number]').value)),
    colors: rows.map(row => row.querySelector('input[type=color]').value),
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
  field('colorRows').replaceChildren();
  s.colors.forEach((color, index) => addColorRow(index ? s.thresholds[index - 1] : 0, color));
  field('pauseWhenUnfocused').checked = s.pauseWhenUnfocused;
  field('exclusions').value = s.exclusions.join('\n');
  preview();
}

function addColorRow(minute, color) {
  const body = field('colorRows');
  if (body.rows.length >= 12) return;
  const row = body.insertRow();
  const time = document.createElement('input');
  time.type = 'number'; time.min = body.rows.length === 1 ? '0' : '1';
  time.step = '1'; time.value = minute;
  time.required = true;
  time.setAttribute('aria-label', `Starttid för färg ${body.rows.length}`);
  if (body.rows.length === 1) { time.readOnly = true; time.title = 'Första färgen börjar vid 0 minuter'; }
  row.insertCell().appendChild(time);
  const picker = document.createElement('input');
  picker.type = 'color'; picker.value = color;
  picker.setAttribute('aria-label', `Färg ${body.rows.length}`);
  row.insertCell().appendChild(picker);
  const remove = document.createElement('button');
  remove.type = 'button'; remove.className = 'row-remove'; remove.textContent = 'Ta bort';
  remove.setAttribute('aria-label', `Ta bort färg ${body.rows.length}`);
  remove.disabled = body.rows.length === 1;
  remove.addEventListener('click', () => { row.remove(); field('addColorRow').disabled = false; preview(); });
  row.insertCell().appendChild(remove);
  field('addColorRow').disabled = body.rows.length >= 12;
}

field('addColorRow').addEventListener('click', () => {
  const starts = read().thresholds;
  addColorRow((starts.at(-1) || 0) + (starts.length ? 30 : 5), defaults.colors[Math.min(starts.length + 1, 3)]);
  preview();
});

function showStyleControls() { field('barControls').hidden = field('style').value !== 'bar'; }
field('style').addEventListener('change', showStyleControls);

function preview() {
  const s = read(), ctx = field('preview').getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = '#173c58'; ctx.beginPath(); ctx.roundRect(0, 0, 64, 64, 12); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 43px system-ui'; ctx.fillText('F', 18, 48);
  showStyleControls();
  ctx.fillStyle = s.colors[Math.min(1, s.colors.length - 1)];
  if (s.style === 'bar') ctx.fillRect(0, s.barPosition === 'top' ? 0 : 64 - s.barHeight * 4, 64, s.barHeight * 4);
  else if (s.style === 'dot') { ctx.beginPath(); ctx.arc(51, 51, 10, 0, Math.PI * 2); ctx.fill(); }
  else { ctx.strokeStyle = s.colors[Math.min(1, s.colors.length - 1)]; ctx.lineWidth = 8; ctx.strokeRect(4, 4, 56, 56); }
}

form.addEventListener('input', preview);
form.addEventListener('submit', async event => {
  event.preventDefault();
  const s = read();
  if (s.thresholds.some((v, i) => !Number.isInteger(v) || v < 1 || (i > 0 && v <= s.thresholds[i - 1]))) {
    status.textContent = 'Starttiderna måste vara stigande heltal över 0.'; status.className = 'error'; return;
  }
  await chrome.storage.local.set({ settings: normalizeSettings(s) });
  status.textContent = 'Sparat'; status.className = '';
  setTimeout(() => { status.textContent = ''; }, 2500);
});

const saved = await chrome.storage.local.get('settings');
fill(normalizeSettings(saved.settings || defaults));
let diagnosticText = '';
field('copyDiagnostics').addEventListener('click', async () => {
  await navigator.clipboard.writeText(diagnosticText);
  field('copyDiagnostics').textContent = 'Kopierat';
  setTimeout(() => { field('copyDiagnostics').textContent = 'Kopiera resultat'; }, 2000);
});

field('runDiagnostics').addEventListener('click', async () => {
  const button = field('runDiagnostics');
  const summary = field('diagnosticSummary');
  const container = field('diagnosticResults');
  button.disabled = true;
  field('copyDiagnostics').hidden = true;
  summary.textContent = 'Kontrollerar öppna flikar…';
  container.replaceChildren();
  try {
    const result = await chrome.runtime.sendMessage({ type: 'diagnostics' });
    if (result?.error) throw new Error(result.error);
    const rows = result?.results || [];
    const marked = rows.filter(row => row.markers === 1 && row.soleIcon).length;
    const regular = rows.filter(row => /^https?:/.test(row.url)).length;
    summary.textContent = `${marked} av ${regular} vanliga webbsidor har Fliks ikon som enda favicon-kandidat.`;
    const list = document.createElement('ul');
    const lines = [`Flik ${chrome.runtime.getManifest().version}: ${summary.textContent}`];
    for (const row of rows) {
      const item = document.createElement('li');
      let label;
      try { const url = new URL(row.url); label = `${url.hostname}${url.pathname}`; }
      catch { label = row.url || `Flik ${row.id}`; }
      const count = Number.isInteger(row.markers) ? `, aktiva markörer: ${row.markers}, äldre/inaktiva: ${row.oldMarkers || 0}` : '';
      const icons = row.iconSizes?.length ? `, sidans ikonstorlekar: ${row.iconSizes.join('/')}` : '';
      item.textContent = `${label}: ${row.excluded ? 'undantagen' : row.status}${count}${row.cspBlocked ? ', data-bild blockerad av CSP' : ''}${icons}${Number.isInteger(row.markers) ? `, Fliks ikon ensam: ${row.soleIcon ? 'ja' : 'nej'}, ålder: ${row.ageMinutes} aktiva minuter, väntad färg: ${row.expectedColor || 'ingen'}, skickad: ${row.requestedColor || 'ingen'}, ritad: ${row.renderedColor || 'ingen'}, ikonkälla: ${row.baseSource}${row.selected ? `, vald flik, Chrome: ${row.idleState}` : ''}` : ''}${row.error ? ` (${row.error})` : ''}`;
      lines.push(item.textContent);
      list.appendChild(item);
    }
    container.appendChild(list);
    diagnosticText = lines.join('\n');
    field('copyDiagnostics').hidden = false;
  } catch (error) {
    summary.textContent = `Diagnosen misslyckades: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});
