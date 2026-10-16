// Full integration test. Run separately: node test/extension-smoke.mjs
// Requires Google Chrome and permission to run a local headless browser.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionPath = fileURLToPath(new URL('../', import.meta.url));
const png = await readFile(new URL('./fixtures/solid-blue.png', import.meta.url));
const serve = handler => new Promise(resolve => {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1', () => resolve(server));
});
const iconServer = await serve((_request, response) => {
  response.setHeader('Content-Type', 'image/png');
  response.end(png); // Deliberately no Access-Control-Allow-Origin.
});
const iconUrl = `http://127.0.0.1:${iconServer.address().port}/favicon.png`;
const pageServer = await serve((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<title>Flik integration test</title><link rel="icon" href="${iconUrl}"><p>Test</p>`);
});
const pageUrl = `http://127.0.0.1:${pageServer.address().port}/`;
const profile = await mkdtemp(join(tmpdir(), 'flik-cdp-'));
const browser = spawn(process.env.FLIK_CHROME || '/usr/bin/google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
  '--enable-unsafe-extension-debugging', '--remote-debugging-pipe',
  `--user-data-dir=${profile}`, 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });

let nextId = 0;
let buffer = '';
const pending = new Map();
browser.stdio[4].on('data', chunk => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const raw = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!raw) continue;
    const message = JSON.parse(raw);
    if (!message.id) continue;
    const task = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) task.reject(new Error(JSON.stringify(message.error)));
    else task.resolve(message.result);
  }
});
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
async function attach(targetId) {
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  return sessionId;
}
async function evaluate(sessionId, expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function eventually(fn, predicate, timeout = 7000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await fn();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for Chrome state');
}

try {
  console.log('Starting Chrome and opening initial tabs…');
  const preexisting = [];
  for (let i = 0; i < 12; i++) {
    preexisting.push((await send('Target.createTarget', { url: `${pageUrl}?tab=${i}` })).targetId);
  }
  const { id: extensionId } = await send('Extensions.loadUnpacked', { path: extensionPath });
  console.log('Extension loaded; opening remaining tabs…');
  const targetIds = [...preexisting];
  for (let i = 12; i < 20; i++) {
    targetIds.push((await send('Target.createTarget', { url: `${pageUrl}?tab=${i}` })).targetId);
  }
  const pages = await Promise.all(targetIds.map(attach));
  const page = pages[0];
  const { targetId: optionsTarget } = await send('Target.createTarget', { url: `chrome-extension://${extensionId}/options.html` });
  const options = await attach(optionsTarget);
  console.log('Options page opened; waiting for indicators…');
  await eventually(() => evaluate(options, 'document.readyState'), value => value === 'complete');
  assert.equal(await evaluate(options, 'typeof chrome.storage.local'), 'object');

  const faviconHref = session => evaluate(session, 'document.querySelector("link[data-flik-indicator][rel~=icon]")?.href');
  const pixel = (session, y) => evaluate(session, `(async()=>{const image=new Image();image.src=document.querySelector('link[data-flik-indicator][rel~=icon]').href;await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=16;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,16,16);return [...ctx.getImageData(8,${y},1,1).data].slice(0,3)})()`);

  await eventually(() => Promise.all(pages.map(faviconHref)), values => values.every(value => value?.startsWith('data:image/png')));
  // Simulate a surviving marker from an older extension context in every tab.
  await Promise.all(pages.map(session => evaluate(session, `(() => { const link = document.createElement('link'); link.rel = 'icon'; link.setAttribute('data-flik-indicator', ''); link.href = document.querySelector('link[data-flik-indicator]').href; document.head.appendChild(link); })()`)));
  await eventually(() => Promise.all(pages.map(session => evaluate(session, `[...document.querySelectorAll('link[data-flik-indicator]')].filter(link => /\\bicon\\b/i.test(link.rel)).length`))), values => values.every(value => value === 1));
  console.log('Indicators visible; running diagnostics…');
  const diagnostics = await evaluate(options, 'chrome.runtime.sendMessage({type:"diagnostics"})');
  assert.equal(diagnostics.results.filter(row => row.url.startsWith(pageUrl)).length, 20);
  assert.equal(diagnostics.results.filter(row => row.markers === 1).length, 20);
  assert.equal(diagnostics.results.filter(row => row.oldMarkers === 1).length, 20);
  console.log('Diagnostics passed; checking colors…');
  for (const session of pages) {
    assert.deepEqual(await pixel(session, 0), [51, 102, 204]);
    assert.deepEqual(await pixel(session, 15), [53, 185, 107]);
  }

  await evaluate(options, `chrome.storage.local.set({settings:{barPosition:'top',colors:['#e65454','#f5a623','#e65454','#9299a5']}})`);
  await eventually(() => Promise.all(pages.map(session => pixel(session, 0))), values => values.every(value => JSON.stringify(value) === '[230,84,84]'));
  for (const session of pages) {
    assert.deepEqual(await pixel(session, 15), [51, 102, 204]);
    assert.equal(await evaluate(session, 'document.querySelectorAll("link[data-flik-indicator][rel~=icon]").length'), 1);
  }

  await evaluate(options, `chrome.storage.local.set({settings:{exclusions:['127.0.0.1']}})`);
  await eventually(() => Promise.all(pages.map(session => evaluate(session, 'document.querySelectorAll("link[data-flik-indicator]").length'))), values => values.every(value => value === 0));
  console.log('Full Chrome extension test passed: twenty tabs, including twelve open before install; diagnostics, cross-origin favicons, position change, restoration.');
} finally {
  browser.kill('SIGINT');
  await Promise.race([new Promise(resolve => browser.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 2000))]);
  if (browser.exitCode === null) browser.kill('SIGKILL');
  pageServer.closeAllConnections();
  iconServer.closeAllConnections();
  pageServer.close();
  iconServer.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
