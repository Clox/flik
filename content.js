(() => {
  if (globalThis.__flikContentStarted) return;
  globalThis.__flikContentStarted = true;
  const OWN = 'data-flik-indicator';
  const staleHrefs = new Set();
  for (const old of document.querySelectorAll(`link[${OWN}]`)) {
    staleHrefs.add(old.href);
    old.remove();
  }
  let indicator = null;
  let config = null;
  let sourceKey = '';
  let renderSerial = 0;
  let cachedBrowserIcon = null;
  let cachedSourceKey = '';
  let dwellTimer;
  let lastInteraction = 0;
  let observer;

  function send(type) {
    try { chrome.runtime.sendMessage({ type, visible: document.visibilityState === 'visible' }); } catch { /* Extension reloaded. */ }
  }

  function scheduleDwell() {
    clearTimeout(dwellTimer);
    if (document.visibilityState !== 'visible') return;
    // The service worker makes the final decision using its own selection time.
    dwellTimer = setTimeout(() => send('dwell'), (config?.dwellSeconds || 10) * 1000 + 150);
  }

  function trustedInteraction(event) {
    if (!event.isTrusted || document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - lastInteraction < 4000) return;
    lastInteraction = now;
    send('interaction');
  }

  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    document.addEventListener(type, trustedInteraction, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', scheduleDwell);
  window.addEventListener('focus', scheduleDwell);
  window.addEventListener('blur', () => clearTimeout(dwellTimer));

  function siteIcons() {
    const links = [...document.querySelectorAll('head link[rel]')].filter(link => {
      if (link.hasAttribute(OWN)) return false;
      return link.rel.toLowerCase().split(/\s+/).includes('icon') && link.href;
    });
    return [...new Set([
      ...links.reverse().map(link => link.href),
      config?.faviconUrl,
      new URL('/favicon.ico', location.href).href
    ].filter(Boolean))];
  }

  function removeIndicator() {
    renderSerial++;
    for (const own of document.querySelectorAll(`link[${OWN}]`)) own.remove();
    indicator = null;
    sourceKey = '';
  }

  function draw(img, color, style, position, height) {
    const size = Math.min(128, Math.max(16, img.naturalWidth || 16));
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size);
    const unit = size / 16;
    ctx.fillStyle = color;
    if (style === 'bar') {
      const h = Math.max(1, Math.round(height * unit));
      ctx.fillRect(0, position === 'top' ? 0 : size - h, size, h);
    } else if (style === 'dot') {
      ctx.beginPath();
      ctx.arc(size - 3 * unit, size - 3 * unit, 2.5 * unit, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.lineWidth = Math.max(1, Math.round(2 * unit));
      ctx.strokeStyle = color;
      ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, size - ctx.lineWidth, size - ctx.lineWidth);
    }
    return canvas.toDataURL('image/png');
  }

  function render(force = false) {
    if (!document.head || !config) return;
    if (!config.color) { removeIndicator(); return; }
    const siteSources = siteIcons();
    const sourceFingerprint = JSON.stringify(siteSources);
    if (sourceFingerprint !== cachedSourceKey) {
      cachedSourceKey = sourceFingerprint;
      cachedBrowserIcon = null;
    }
    const sources = cachedBrowserIcon ? [cachedBrowserIcon, ...siteSources] : [...siteSources];
    const key = JSON.stringify([sources, config]);
    if (!force && key === sourceKey && indicator?.isConnected && indicator === document.head.lastElementChild) return;
    sourceKey = key;
    const serial = ++renderSerial;
    const trySource = index => {
      if (serial !== renderSerial) return;
      if (index >= sources.length) {
        if (cachedBrowserIcon) { removeIndicator(); return; }
        chrome.runtime.sendMessage({ type: 'favicon-fallback' }).then(result => {
          if (serial !== renderSerial) return;
          if (!result?.dataUrl) { removeIndicator(); return; }
          cachedBrowserIcon = result.dataUrl;
          sources.push(result.dataUrl);
          trySource(index);
        }).catch(() => { if (serial === renderSerial) removeIndicator(); });
        return;
      }
      const source = sources[index];
      const img = new Image();
      // Same-origin and data URLs remain canvas-readable. Cross-origin icons need CORS.
      try { if (new URL(source).origin !== location.origin && !source.startsWith('data:')) img.crossOrigin = 'anonymous'; }
      catch { trySource(index + 1); return; }
      img.onload = () => {
        if (serial !== renderSerial || !config?.color || !document.head) return;
        let data;
        try { data = draw(img, config.color, config.style, config.position, config.height); }
        catch { trySource(index + 1); return; }
        if (!indicator) {
          indicator = document.createElement('link');
          indicator.rel = 'icon';
          indicator.setAttribute(OWN, '');
        }
        indicator.href = data;
        document.head.appendChild(indicator);
      };
      img.onerror = () => trySource(index + 1);
      img.src = source;
    };
    trySource(0);
  }

  function startObserver() {
    if (!document.head || observer) return;
    observer = new MutationObserver(records => {
      const iconLink = node => node instanceof HTMLLinkElement && !node.hasAttribute(OWN) &&
        node.rel.toLowerCase().split(/\s+/).includes('icon');
      const changed = records.some(record => {
        if (record.target instanceof Element && record.target.hasAttribute(OWN)) return false;
        if (record.type === 'attributes') return iconLink(record.target) ||
          (record.attributeName === 'rel' && /\bicon\b/i.test(record.oldValue || ''));
        return [...record.addedNodes, ...record.removedNodes].some(node =>
          iconLink(node) || (node instanceof Element && [...node.querySelectorAll('link[rel]')].some(iconLink)));
      });
      if (changed) render(true);
    });
    observer.observe(document.head, { childList: true, attributes: true, attributeOldValue: true, subtree: true, attributeFilter: ['href', 'rel', 'type'] });
    send('ready');
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== 'indicator') return;
    const faviconUrl = message.faviconUrl === indicator?.href || staleHrefs.has(message.faviconUrl) ? config?.faviconUrl : message.faviconUrl;
    config = { color: message.color, style: message.style, position: message.position, height: message.height, dwellSeconds: message.dwellSeconds, faviconUrl };
    scheduleDwell();
    render();
  });

  if (document.head) startObserver();
  else {
    const startup = new MutationObserver(() => {
      if (!document.head) return;
      startup.disconnect();
      startObserver();
      render();
    });
    startup.observe(document.documentElement || document, { childList: true, subtree: true });
  }
  scheduleDwell();
})();
