(() => {
  const previous = globalThis.__flikContentStarted;
  if (previous?.version === '0.1.6') return;
  previous?.dispose?.();
  const instance = { version: '0.1.6' };
  globalThis.__flikContentStarted = instance;
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
  let renderStatus = 'väntar';
  let lastRenderAt = 0;
  let cspBlocked = false;
  let dwellTimer;
  let lastInteraction = 0;
  let observer;
  let startup;

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
  const onCspViolation = event => {
    if (Date.now() - lastRenderAt < 2000 &&
      ['img-src', 'default-src'].includes(event.effectiveDirective) &&
      String(event.blockedURI).startsWith('data')) cspBlocked = true;
  };
  document.addEventListener('securitypolicyviolation', onCspViolation);
  window.addEventListener('focus', scheduleDwell);
  const onBlur = () => clearTimeout(dwellTimer);
  window.addEventListener('blur', onBlur);

  function siteIcons() {
    const links = [...document.querySelectorAll('head link[rel]')].filter(link => {
      if (link.hasAttribute(OWN)) return false;
      return link.rel.toLowerCase().split(/\s+/).includes('icon') && link.href;
    });
    // Chrome may report our generated favicon back as tab.favIconUrl, sometimes
    // after re-encoding it. Never treat a browser-reported data URL as original.
    const browserIcon = config?.faviconUrl && !config.faviconUrl.startsWith('data:') &&
      !staleHrefs.has(config.faviconUrl) ? config.faviconUrl : null;
    return [...new Set([
      ...links.reverse().map(link => link.href),
      browserIcon,
      new URL('/favicon.ico', location.href).href
    ].filter(Boolean))];
  }

  function removeOtherIndicators() {
    for (const link of document.querySelectorAll(`link[${OWN}]`)) {
      if (link !== indicator) link.remove();
    }
  }

  function removeIndicator() {
    renderSerial++;
    for (const own of document.querySelectorAll(`link[${OWN}]`)) own.remove();
    indicator = null;
    sourceKey = '';
    renderStatus = 'ingen markering';
  }

  function draw(img, color, style, position, height) {
    // The tab strip requests a 16 px favicon. A declared 16x16 candidate
    // wins over many sites' larger icon links while keeping the icon full size.
    const size = 16;
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
    removeOtherIndicators();
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
    renderStatus = 'ritar';
    const serial = ++renderSerial;
    const trySource = index => {
      if (serial !== renderSerial) return;
      if (index >= sources.length) {
        if (cachedBrowserIcon) { removeIndicator(); renderStatus = 'favicon kunde inte ritas'; return; }
        chrome.runtime.sendMessage({ type: 'favicon-fallback' }).then(result => {
          if (serial !== renderSerial) return;
          if (!result?.dataUrl) { removeIndicator(); renderStatus = 'ingen läsbar favicon'; return; }
          cachedBrowserIcon = result.dataUrl;
          sources.push(result.dataUrl);
          trySource(index);
        }).catch(() => { if (serial === renderSerial) { removeIndicator(); renderStatus = 'favicon-API svarade inte'; } });
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
          indicator.type = 'image/png';
          indicator.setAttribute('sizes', '16x16');
          indicator.setAttribute(OWN, '');
        }
        indicator.href = data;
        lastRenderAt = Date.now();
        document.head.appendChild(indicator);
        removeOtherIndicators();
        renderStatus = 'visas';
      };
      img.onerror = () => trySource(index + 1);
      img.src = source;
    };
    trySource(0);
  }

  function startObserver() {
    if (!document.head || observer) return;
    observer = new MutationObserver(records => {
      removeOtherIndicators();
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

  const onMessage = (message, _sender, respond) => {
    if (message?.type === 'diagnostic') {
      respond({
        status: renderStatus,
        markers: [...document.querySelectorAll(`link[${OWN}]`)].filter(link => /\bicon\b/i.test(link.rel)).length,
        oldMarkers: [...document.querySelectorAll(`link[${OWN}]`)].filter(link => link !== indicator).length,
        cspBlocked,
        iconSizes: [...document.querySelectorAll('head link[rel~="icon"]:not([data-flik-indicator])')].map(link => link.getAttribute('sizes') || 'okänd').slice(0, 8),
        markerLast: indicator === [...document.querySelectorAll('head link[rel~="icon"]')].at(-1),
        configured: Boolean(config),
        sourceCount: siteIcons().length
      });
      return;
    }
    if (message?.type !== 'indicator') return;
    const faviconUrl = message.faviconUrl === indicator?.href || staleHrefs.has(message.faviconUrl) ? config?.faviconUrl : message.faviconUrl;
    config = { color: message.color, style: message.style, position: message.position, height: message.height, dwellSeconds: message.dwellSeconds, faviconUrl };
    scheduleDwell();
    render();
  };
  chrome.runtime.onMessage.addListener(onMessage);

  if (document.head) startObserver();
  else {
    startup = new MutationObserver(() => {
      if (!document.head) return;
      startup.disconnect();
      startObserver();
      render();
    });
    startup.observe(document.documentElement || document, { childList: true, subtree: true });
  }
  scheduleDwell();
  instance.dispose = () => {
    clearTimeout(dwellTimer);
    observer?.disconnect();
    startup?.disconnect();
    for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
      document.removeEventListener(type, trustedInteraction, true);
    }
    document.removeEventListener('visibilitychange', scheduleDwell);
    document.removeEventListener('securitypolicyviolation', onCspViolation);
    window.removeEventListener('focus', scheduleDwell);
    window.removeEventListener('blur', onBlur);
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch { /* Old extension context. */ }
    removeIndicator();
  };
})();
