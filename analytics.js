(function () {
  const cfg = window.JIBEK_CONFIG || {};
  const ATTR_KEY = 'jibek_attr';
  const ATTR_DAYS = 30;

  function parseParams() {
    const p = new URLSearchParams(location.search);
    return {
      ref: (p.get('ref') || p.get('promo') || '').toUpperCase().trim(),
      utm_source: p.get('utm_source') || '',
      utm_medium: p.get('utm_medium') || '',
      utm_campaign: p.get('utm_campaign') || '',
      utm_content: p.get('utm_content') || '',
      utm_term: p.get('utm_term') || ''
    };
  }

  function saveAttr(data) {
    const payload = { ...data, savedAt: Date.now() };
    try { localStorage.setItem(ATTR_KEY, JSON.stringify(payload)); } catch (e) {}
    return payload;
  }

  function loadAttr() {
    try {
      const raw = localStorage.getItem(ATTR_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (Date.now() - (data.savedAt || 0) > ATTR_DAYS * 864e5) {
        localStorage.removeItem(ATTR_KEY);
        return null;
      }
      return data;
    } catch (e) { return null; }
  }

  const incoming = parseParams();
  let attr = loadAttr();
  if (incoming.ref || incoming.utm_source || incoming.utm_campaign) {
    attr = saveAttr({
      ref: incoming.ref || (attr && attr.ref) || '',
      utm_source: incoming.utm_source || (attr && attr.utm_source) || '',
      utm_medium: incoming.utm_medium || (attr && attr.utm_medium) || '',
      utm_campaign: incoming.utm_campaign || (attr && attr.utm_campaign) || '',
      utm_content: incoming.utm_content || (attr && attr.utm_content) || '',
      utm_term: incoming.utm_term || (attr && attr.utm_term) || ''
    });
  }
  window.JIBEK_ATTR = attr || { ref: '', utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '' };

  if (cfg.GA4_ID && cfg.GA4_ID.indexOf('XXXX') === -1) {
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + cfg.GA4_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', cfg.GA4_ID, { send_page_view: true });
  } else {
    window.gtag = window.gtag || function () {};
  }

  if (cfg.YANDEX_ID && cfg.YANDEX_ID !== '00000000') {
    (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
      m[i].l = 1 * new Date();
      for (var j = 0; j < document.scripts.length; j++) { if (document.scripts[j].src === r) return; }
      k = e.createElement(t); a = e.getElementsByTagName(t)[0];
      k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
    ym(Number(cfg.YANDEX_ID), 'init', {
      clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: true, ecommerce: 'dataLayer'
    });
  } else {
    window.ym = window.ym || function () {};
  }

  window.jibekTrack = function (name, params) {
    params = params || {};
    const payload = Object.assign({}, params, {
      ref: window.JIBEK_ATTR.ref || undefined,
      utm_source: window.JIBEK_ATTR.utm_source || undefined
    });
    try { if (typeof gtag === 'function') gtag('event', name, payload); } catch (e) {}
    try {
      if (cfg.YANDEX_ID && typeof ym === 'function') ym(Number(cfg.YANDEX_ID), 'reachGoal', name, payload);
    } catch (e) {}
  };

  window.jibekTrack('page_view', { page: location.pathname });

  const VID_KEY = 'jibek_vid';
  function visitorId() {
    try {
      let id = localStorage.getItem(VID_KEY);
      if (!id) {
        id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
        localStorage.setItem(VID_KEY, id);
      }
      return id;
    } catch (e) {
      return 'v' + Date.now().toString(36);
    }
  }
  function partnerCode(explicit) {
    const fromArg = explicit || (window.jibekPromoCode && window.jibekPromoCode()) || (window.JIBEK_ATTR && window.JIBEK_ATTR.ref) || '';
    return String(fromArg).toUpperCase().trim();
  }
  window.jibekEvent = function (type, extra) {
    extra = extra || {};
    const code = partnerCode(extra.code);
    if (!code) return;
    const payload = {
      type: type,
      code: code,
      visitorId: visitorId(),
      firstName: extra.firstName || '',
      city: extra.city || '',
      order: extra.order || null
    };
    const body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
      }
    } catch (e) {}
  };
  document.addEventListener('click', function (event) {
    const link = event.target && event.target.closest && event.target.closest('a[href*="wa.me"]');
    if (!link) return;
    window.jibekEvent('whatsapp_click');
  });
  const landing = new URLSearchParams(location.search);
  const landingRef = (landing.get('ref') || landing.get('promo') || '').toUpperCase().trim();
  if (landingRef) window.jibekEvent('visit', { code: landingRef });
})();
