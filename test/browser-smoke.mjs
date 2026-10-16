// Browser-level test for the content script, independent of extension loading.
// Start Chrome with --remote-debugging-port=9228, then run this file.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';

const port = Number(process.env.FLIK_CDP_PORT || 9228);
const contentScript = await readFile(new URL('../content.js', import.meta.url), 'utf8');
const icon = color => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="${color}"/></svg>`)}`;
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(req.url.includes('noicon=1') ? '<title>Flik test</title><p>Test</p>' :
    `<title>Flik test</title><link rel="icon" href="${icon('#3366cc')}"><link rel="icon" data-flik-indicator href="${icon('#ff0000')}"><p>Test</p>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const siteUrl = `http://127.0.0.1:${server.address().port}/`;
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const task = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) task.reject(new Error(JSON.stringify(message.error)));
  else task.resolve(message.result);
};
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(sessionId, expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}
async function eventually(fn, expected, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await fn();
    if (expected(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for expected browser state');
}

const { targetId } = await send('Target.createTarget', { url: siteUrl });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
try {
  await eventually(() => evaluate(sessionId, 'document.readyState'), value => value === 'complete');
  await evaluate(sessionId, `globalThis.chrome = {runtime:{sendMessage(message){(globalThis.__flikMessages ||= []).push(message);if(message.type==='favicon-fallback')return Promise.resolve({dataUrl:${JSON.stringify(icon('#0088aa'))}})},onMessage:{addListener(fn){globalThis.__flikOnMessage = fn},removeListener(){}}}}; ${contentScript}`);
  await evaluate(sessionId, contentScript);
  const config = { type: 'indicator', color: '#35b96b', style: 'bar', position: 'bottom', height: 3, dwellSeconds: 10 };
  await evaluate(sessionId, `globalThis.__flikOnMessage(${JSON.stringify(config)})`);
  const first = await eventually(() => evaluate(sessionId, 'document.querySelector("[data-flik-v2-indicator]")?.href'), value => value?.startsWith('data:image/png'));
  assert.equal(await evaluate(sessionId, 'document.querySelectorAll("link[rel=icon]").length'), 1);
  const pixel = async y => evaluate(sessionId, `(async()=>{const img=new Image();img.src=document.querySelector('[data-flik-v2-indicator]').href;await img.decode();const c=document.createElement('canvas');c.width=c.height=16;const x=c.getContext('2d');x.drawImage(img,0,0);return [...x.getImageData(8,${y},1,1).data].slice(0,3)})()`);
  assert.deepEqual(await pixel(0), [51, 102, 204]);
  assert.deepEqual(await pixel(15), [53, 185, 107]);
  await evaluate(sessionId, `globalThis.__flikOnMessage(${JSON.stringify({ ...config, color: '#e65454', position: 'top' })})`);
  await eventually(() => evaluate(sessionId, 'document.querySelector("[data-flik-v2-indicator]")?.href'), value => value?.startsWith('data:image/png') && value !== first);
  assert.deepEqual(await pixel(0), [230, 84, 84]);
  assert.deepEqual(await pixel(15), [51, 102, 204]);
  await evaluate(sessionId, `globalThis.__flikOnMessage(${JSON.stringify(config)})`);
  await eventually(() => pixel(0), value => JSON.stringify(value) === '[51,102,204]');
  assert.deepEqual(await pixel(15), [53, 185, 107]);
  await evaluate(sessionId, `(() => { const link = document.createElement('link'); link.rel = 'icon'; link.href = ${JSON.stringify(icon('#cc6633'))}; window.__newIcon = link; document.head.appendChild(link); })()`);
  const second = await eventually(() => evaluate(sessionId, 'document.querySelector("[data-flik-v2-indicator]")?.href'), value => value?.startsWith('data:image/png') && value !== first);
  assert.notEqual(second, first);
  assert.equal(await evaluate(sessionId, 'document.querySelectorAll("link[rel=icon]").length'), 1);
  await evaluate(sessionId, `window.__newIcon.href = ${JSON.stringify(icon('#aa33cc'))}`);
  await eventually(() => evaluate(sessionId, 'document.querySelector("[data-flik-v2-indicator]")?.href'), value => value?.startsWith('data:image/png') && value !== second);
  await evaluate(sessionId, `globalThis.__flikOnMessage(${JSON.stringify({ ...config, color: null })})`);
  await eventually(() => evaluate(sessionId, 'document.querySelector("[data-flik-v2-indicator]")'), value => value === null);
  assert.equal(await evaluate(sessionId, 'document.querySelectorAll("link[rel=icon]").length'), 2);
  await send('Page.navigate', { url: `${siteUrl}?noicon=1` }, sessionId);
  await eventually(() => evaluate(sessionId, 'document.readyState'), value => value === 'complete');
  await evaluate(sessionId, `globalThis.__fallback = ${JSON.stringify(icon('#3366cc'))}; globalThis.chrome = {runtime:{sendMessage(message){return Promise.resolve({dataUrl:globalThis.__fallback})},onMessage:{addListener(fn){globalThis.__flikOnMessage=fn},removeListener(){}}}}; ${contentScript}`);
  await evaluate(sessionId, `globalThis.__flikOnMessage(${JSON.stringify(config)})`);
  await eventually(() => evaluate(sessionId, 'document.querySelector("[data-flik-v2-indicator]")?.href'), value => value?.startsWith('data:image/png'));
  await eventually(() => pixel(15), value => JSON.stringify(value) === '[53,185,107]');
  await evaluate(sessionId, `globalThis.__fallback = document.querySelector('[data-flik-v2-indicator]').href; globalThis.__flikOnMessage(${JSON.stringify({ ...config, color: '#e65454', position: 'top', faviconUrl: `${siteUrl}bad.png` })})`);
  await eventually(() => pixel(0), value => JSON.stringify(value) === '[230,84,84]');
  assert.deepEqual(await pixel(15), [51, 102, 204]);
  console.log('Chrome content test passed: stale-marker cleanup, position changes without stacked bars, dynamic favicon and restoration.');
} finally {
  await send('Target.closeTarget', { targetId });
  socket.close();
  server.closeAllConnections();
  server.close();
}
