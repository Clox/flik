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
  res.end(`<title>Flik test</title><link rel="icon" href="${icon('#3366cc')}"><p>Test</p>`);
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
  await evaluate(sessionId, `globalThis.chrome = {runtime:{sendMessage(message){(globalThis.__flikMessages ||= []).push(message)},onMessage:{addListener(fn){globalThis.__flikOnMessage = fn}}}}; ${contentScript}`);
  await evaluate(sessionId, contentScript);
  const config = { type: 'indicator', color: '#35b96b', style: 'bar', position: 'bottom', height: 3, dwellSeconds: 10 };
  await evaluate(sessionId, `globalThis.__flikOnMessage(${JSON.stringify(config)})`);
  const first = await eventually(() => evaluate(sessionId, 'document.querySelector("[data-flik-indicator]")?.href'), value => value?.startsWith('data:image/png'));
  assert.equal(await evaluate(sessionId, 'document.querySelectorAll("link[rel=icon]").length'), 2);
  await evaluate(sessionId, `document.querySelector('link[rel=icon]:not([data-flik-indicator])').href = ${JSON.stringify(icon('#cc6633'))}`);
  const second = await eventually(() => evaluate(sessionId, 'document.querySelector("[data-flik-indicator]")?.href'), value => value?.startsWith('data:image/png') && value !== first);
  assert.notEqual(second, first);
  await evaluate(sessionId, 'document.querySelector("link[rel=icon]:not([data-flik-indicator])").remove()');
  await evaluate(sessionId, `globalThis.__flikOnMessage(${JSON.stringify({ ...config, faviconUrl: icon('#0088aa') })})`);
  await eventually(() => evaluate(sessionId, 'document.querySelector("[data-flik-indicator]")?.href'), value => value?.startsWith('data:image/png') && value !== second);
  await evaluate(sessionId, `globalThis.__flikOnMessage(${JSON.stringify({ ...config, color: null })})`);
  await eventually(() => evaluate(sessionId, 'document.querySelector("[data-flik-indicator]")'), value => value === null);
  assert.equal(await evaluate(sessionId, 'document.querySelectorAll("link[rel=icon]").length'), 0);
  console.log('Chrome content test passed: overlay, dynamic favicon, fallback and restoration.');
} finally {
  await send('Target.closeTarget', { targetId });
  socket.close();
  server.closeAllConnections();
  server.close();
}
