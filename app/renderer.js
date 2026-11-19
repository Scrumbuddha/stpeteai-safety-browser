/* Iron Road Browser — chrome UI logic */
(() => {
  const api = window.ironroad;
  const HOME = api.homeUrl;
  const SEARCH = 'https://duckduckgo.com/?q=';
  const $ = (s) => document.querySelector(s);

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  let favorites = store.get('favorites', [
    { title: 'Wikipedia', url: 'https://www.wikipedia.org/' },
    { title: 'Weather', url: 'https://weather.gov/' },
    { title: 'DuckDuckGo', url: 'https://duckduckgo.com/' },
  ]);
  let history = store.get('history', []);

  const tabs = [];
  let active = null;
  let nextId = 1;

  // ---------------------------------------------------------------- helpers
  function toUrl(input) {
    const s = input.trim();
    if (!s) return HOME;
    if (/^(https?|file|about|data):/i.test(s)) return s;
    if (/^localhost(:\d+)?(\/|$)/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s)) return 'http://' + s;
    if (!/\s/.test(s) && /^[^/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s)) return 'https://' + s;
    return SEARCH + encodeURIComponent(s);
  }
  const isHome = (u) => !u || u.startsWith(HOME.split('#')[0]);
  const shownUrl = (u) => (isHome(u) ? '' : u);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hostOf = (u) => { try { return new URL(u).hostname; } catch { return u; } };

  function setStatus(text) { $('#status-text').textContent = text || 'Ready'; }

  // ---------------------------------------------------------------- tabs
  function createTab(url = HOME, focus = true) {
    const id = nextId++;
    const wv = document.createElement('webview');
    wv.setAttribute('partition', 'persist:ironroad');
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('preload', api.guardPreload);

    const el = document.createElement('div');
    el.className = 'tab';
    el.innerHTML = '<span class="fav"></span><span class="t">New Tab</span><button class="x" title="Close tab">✕</button>';

    const tab = { id, wv, el, title: 'New Tab', url, favicon: null, loading: false, ready: false, zoom: 1, progress: 0,
      safety: null, allowed: new Set(), banner: null, shieldMuted: false };
    tabs.push(tab);
    $('#tabs').appendChild(el);
    $('#views').appendChild(wv);

    el.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab); } });
    el.addEventListener('click', (e) => { if (e.target.closest('.x')) closeTab(tab); else activate(tab); });

    wireWebview(tab);
    // Check the address before the page is allowed to load at all.
    wv.src = beginSafety(tab, url) ? 'about:blank' : url;
    if (focus) activate(tab);
    return tab;
  }

  function wireWebview(tab) {
    const { wv } = tab;
    let timer;

    wv.addEventListener('dom-ready', () => {
      tab.ready = true;
      wv.setZoomFactor(tab.zoom);
      if (tab === active) syncChrome();
    });
    wv.addEventListener('did-start-loading', () => {
      tab.loading = true; tab.progress = 12;
      clearInterval(timer);
      timer = setInterval(() => { tab.progress += (92 - tab.progress) * 0.12; if (tab === active) syncProgress(); }, 200);
      renderTab(tab); if (tab === active) syncChrome();
    });
    wv.addEventListener('did-stop-loading', () => {
      tab.loading = false; tab.progress = 100; clearInterval(timer);
      renderTab(tab); if (tab === active) { syncChrome(); tachBlip(); }
    });
    wv.addEventListener('page-title-updated', (e) => {
      tab.title = e.title; renderTab(tab);
      const h = history.find((x) => x.url === tab.url);
      if (h) { h.title = e.title; saveHistory(); }
      if (tab === active) syncChrome();
    });
    wv.addEventListener('page-favicon-updated', (e) => { tab.favicon = e.favicons[0] || null; renderTab(tab); });
    const onNav = (e) => {
      if (e.isMainFrame === false) return;
      const errorPage = e.url.startsWith('data:') && tab.errorUrl;
      const blockedPage = e.url === 'about:blank' && tab.safety && tab.safety.stopped;
      tab.url = errorPage ? tab.errorUrl : blockedPage ? tab.safety.url : e.url;
      renderTab(tab);
      if (!e.url.startsWith('data:')) tab.errorUrl = null;
      tab.favicon = isHome(e.url) ? 'favicon.png' : tab.favicon;
      if (/^https?:/i.test(e.url)) addHistory(e.url, tab.title);
      if (tab === active) { $('#address').value = shownUrl(e.url); syncChrome(); }
    };
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);
    // Safety: check each new page as soon as navigation starts, and again after redirects.
    const onStart = (e) => { if (e.isMainFrame && !e.isInPlace) beginSafety(tab, e.url); };
    wv.addEventListener('did-start-navigation', onStart);
    wv.addEventListener('did-redirect-navigation', onStart);
    wv.addEventListener('did-navigate', (e) => beginSafety(tab, e.url));
    wv.addEventListener('ipc-message', (e) => onGuardMessage(tab, e.channel, e.args[0]));
    wv.addEventListener('update-target-url', (e) => { if (tab === active) setStatus(e.url || (tab.loading ? 'Loading ' + hostOf(tab.url) + '…' : 'Done')); });
    wv.addEventListener('did-fail-load', (e) => {
      if (!e.isMainFrame || e.errorCode === -3) return; // -3 = aborted (e.g. user hit stop)
      // A scam address that failed to load keeps its stop screen instead of the error page.
      beginSafety(tab, e.validatedURL);
      const v = verdictFor(tab);
      if (v && v.level === 'danger' && !tab.allowed.has(tab.safety.domain)) return;
      tab.errorUrl = e.validatedURL;
      const page = `<html><body style="margin:0;font-family:Roboto,Segoe UI,sans-serif;background:#151a2c;color:#dfe5f3;display:grid;place-items:center;height:100vh">
        <div style="text-align:center;max-width:520px"><div style="font:900 44px Roboto,Segoe UI,sans-serif;color:#5fd0f3">Can't reach this page</div>
        <p>Couldn't reach <b>${esc(hostOf(e.validatedURL))}</b>.</p><p style="color:#888">${esc(e.errorDescription)} (${e.errorCode})</p></div></body></html>`;
      wv.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
    });
    wv.addEventListener('found-in-page', (e) => {
      const r = e.result; if (r.finalUpdate) $('#find-count').textContent = r.matches ? `${r.activeMatchOrdinal} of ${r.matches}` : 'No matches';
    });
  }

  function renderTab(tab) {
    const t = tab.safety && tab.safety.stopped ? '⛔ Blocked site'
      : isHome(tab.url) ? 'Safety Home' : (tab.title || hostOf(tab.url));
    tab.el.querySelector('.t').textContent = t;
    tab.el.title = t;
    tab.el.classList.toggle('loading', tab.loading);
    const slot = tab.el.firstElementChild;
    if (tab.favicon && !tab.loading) {
      if (slot.tagName !== 'IMG') { const img = document.createElement('img'); img.onerror = () => { tab.favicon = null; renderTab(tab); }; slot.replaceWith(img); }
      tab.el.firstElementChild.src = tab.favicon;
    } else if (slot.tagName === 'IMG') {
      const s = document.createElement('span'); s.className = 'fav'; slot.replaceWith(s);
    }
  }

  function activate(tab) {
    active = tab;
    for (const t of tabs) { t.el.classList.toggle('active', t === tab); t.wv.classList.toggle('active', t === tab); }
    tab.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    closeFind();
    $('#address').value = shownUrl(tab.url);
    if (!isHome(tab.url)) $('#address').blur();
    syncChrome();
    renderSafety(tab);
    if (isHome(tab.url)) setTimeout(() => $('#address').focus(), 0);
  }

  function closeTab(tab) {
    const i = tabs.indexOf(tab);
    if (i < 0) return;
    tabs.splice(i, 1); tab.el.remove(); tab.wv.remove();
    if (!tabs.length) { createTab(); return; }
    if (tab === active) activate(tabs[Math.min(i, tabs.length - 1)]);
  }

  function cycleTab(dir) {
    const i = tabs.indexOf(active);
    activate(tabs[(i + dir + tabs.length) % tabs.length]);
  }

  // ---------------------------------------------------------------- chrome sync
  function syncProgress() {
    $('#progress div').style.width = (active.loading ? active.progress : 0) + '%';
  }

  function syncChrome() {
    const t = active; if (!t) return;
    const ready = t.ready;
    $('#btn-back').disabled = !(ready && t.wv.canGoBack());
    $('#btn-forward').disabled = !(ready && t.wv.canGoForward());
    $('#btn-stop').disabled = !t.loading;
    if (document.activeElement !== $('#address')) $('#address').value = shownUrl(t.url);
    const secure = t.url.startsWith('https:');
    $('#secure').textContent = isHome(t.url) ? '⌂' : secure ? '🔒' : 'ⓘ';
    $('#secure').title = isHome(t.url) ? 'Home' : secure ? 'Secure connection' : 'Not secure';
    $('#zone').textContent = isHome(t.url) ? 'Local' : secure ? 'Internet · Secure' : 'Internet';
    $('#btn-star').classList.toggle('on', favorites.some((f) => f.url === t.url));
    $('#btn-star').textContent = favorites.some((f) => f.url === t.url) ? '★' : '☆';
    $('#status').classList.toggle('busy', t.loading);
    setStatus(t.loading ? 'Loading ' + hostOf(t.url) + '…' : 'Done');
    syncProgress();
    $('#zoom-level').textContent = Math.round(t.zoom * 100) + '%';
    const name = isHome(t.url) ? '' : (t.title || hostOf(t.url));
    $('#title-text').textContent = name ? `${name} — St. Pete AI Safety Browser` : 'St. Pete AI Safety Browser';
    document.title = $('#title-text').textContent;
    tachTarget = t.loading ? 6.5 : 1;
  }

  function navigate(input) {
    const url = toUrl(input);
    active.url = url;
    if (beginSafety(active, url)) { syncChrome(); return; } // stop screen is showing
    active.wv.loadURL(url);
    active.wv.focus();
  }

  // ---------------------------------------------------------------- favorites & history
  function saveFavs() { store.set('favorites', favorites); renderFavs(); syncChrome(); if (active) renderSafety(active); }
  function saveHistory() { store.set('history', history); renderHistory(); }

  function toggleFavorite() {
    const t = active; if (isHome(t.url)) return;
    const i = favorites.findIndex((f) => f.url === t.url);
    if (i >= 0) favorites.splice(i, 1);
    else favorites.unshift({ title: t.title || hostOf(t.url), url: t.url, favicon: t.favicon });
    saveFavs();
    showPanel('favs');
  }

  function addHistory(url, title) {
    if (history[0] && history[0].url === url) return;
    history.unshift({ url, title: title || hostOf(url), time: Date.now() });
    history = history.slice(0, 300);
    saveHistory();
  }

  function listItem(item, onRemove) {
    const li = document.createElement('li');
    li.title = item.url;
    li.innerHTML = `${item.favicon ? `<img src="${esc(item.favicon)}">` : '<span class="dot"></span>'}<span class="t">${esc(item.title || item.url)}</span><button class="x" title="Remove">✕</button>`;
    const img = li.querySelector('img'); if (img) img.onerror = () => img.replaceWith(Object.assign(document.createElement('span'), { className: 'dot' }));
    li.addEventListener('click', (e) => { if (e.target.closest('.x')) { e.stopPropagation(); onRemove(); } else navigate(item.url); });
    li.addEventListener('auxclick', (e) => { if (e.button === 1) createTab(item.url); });
    return li;
  }

  function renderFavs() {
    const ul = $('#fav-list'); ul.innerHTML = '';
    if (!favorites.length) ul.innerHTML = '<li class="empty">No favorites yet. Press ☆ in the address bar to save a page.</li>';
    favorites.forEach((f, i) => ul.appendChild(listItem(f, () => { favorites.splice(i, 1); saveFavs(); })));
  }

  function renderHistory() {
    const ul = $('#history-list'); ul.innerHTML = '';
    if (!history.length) ul.innerHTML = '<li class="empty">No history yet.</li>';
    history.slice(0, 100).forEach((h) => ul.appendChild(listItem(h, () => { history = history.filter((x) => x !== h); saveHistory(); })));
  }

  function showPanel(name) {
    $('#sidebar').classList.remove('hidden');
    document.querySelectorAll('[data-ptab]').forEach((b) => b.classList.toggle('active', b.dataset.ptab === name));
    document.querySelectorAll('[data-ptab-body]').forEach((b) => (b.hidden = b.dataset.ptabBody !== name));
  }

  // ---------------------------------------------------------------- find in page
  function openFind() {
    $('#findbar').hidden = false; $('#find-input').focus(); $('#find-input').select();
  }
  function closeFind() {
    if ($('#findbar').hidden) return;
    $('#findbar').hidden = true; $('#find-count').textContent = '';
    try { active.wv.stopFindInPage('clearSelection'); } catch {}
  }
  function find(forward = true, findNext = true) {
    const q = $('#find-input').value;
    if (!q) { try { active.wv.stopFindInPage('clearSelection'); } catch {} $('#find-count').textContent = ''; return; }
    active.wv.findInPage(q, { forward, findNext });
  }

  // ---------------------------------------------------------------- zoom
  function zoom(delta) {
    const t = active;
    t.zoom = delta === 0 ? 1 : Math.min(3, Math.max(0.3, +(t.zoom + delta).toFixed(2)));
    if (t.ready) t.wv.setZoomFactor(t.zoom);
    syncChrome();
  }

  // ---------------------------------------------------------------- safety
  const Core = window.SafetyCore;
  const LEVEL_TITLE = { safe: 'Looks OK', caution: 'Be careful', danger: 'Danger', checking: 'Checking…' };
  const domainOf = (u) => { try { return Core.registrableDomain(new URL(u).hostname); } catch { return ''; } };
  const isTrusted = (domain) => !!domain && favorites.some((f) => domainOf(f.url) === domain);
  const ages = new Map(); // domain -> finding|null once known; undefined while the lookup runs
  let phishIndex = null;   // OpenPhish known-phishing list

  function urlFindingsFor(url) {
    const u = Core.checkUrl(url);
    const listed = Core.checkPhishList(phishIndex, url);
    return { ...u, findings: listed ? [listed, ...u.findings] : u.findings };
  }

  function setPhishFeed(feed) {
    phishIndex = Core.buildPhishIndex(feed && feed.lines);
    // Re-check pages that are already open against the fresh list.
    for (const t of tabs) {
      if (!t.safety || t.safety.skip) continue;
      t.safety.urlFindings = urlFindingsFor(t.safety.url).findings;
      renderSafety(t);
    }
  }

  function lookupAge(domain) {
    if (!domain || /^[\d.:]+$/.test(domain) || ages.has(domain)) return;
    ages.set(domain, undefined);
    api.domainAge(domain).then((created) => {
      ages.set(domain, Core.checkDomainAge(created));
      tabs.forEach((t) => { if (t.safety && t.safety.domain === domain) renderSafety(t); });
    });
  }

  // Returns true when the address was blocked and must not be loaded.
  function beginSafety(tab, url) {
    if (url === 'about:blank' && tab.safety && tab.safety.stopped) return false; // placeholder behind a stop screen
    if (!/^https?:/i.test(url)) { tab.safety = { url, skip: true }; tab.banner = null; renderSafety(tab); return false; }
    if (tab.safety && tab.safety.url === url) return !!tab.safety.stopped;
    const u = urlFindingsFor(url);
    tab.safety = { url, host: u.host, domain: u.domain, https: url.startsWith('https:'),
      urlFindings: u.findings, textFindings: [], guardFindings: [], stopped: false };
    tab.banner = null;
    lookupAge(u.domain);
    // A clearly fake address is stopped before the page can load or run anything.
    if (Core.combine(u.findings).level === 'danger' && !tab.allowed.has(u.domain)) {
      try { tab.wv.stop(); } catch {}
      tab.safety.stopped = true;
      tab.url = url;
      if (tab === active) $('#address').value = url;
    }
    renderSafety(tab);
    return tab.safety.stopped;
  }

  function verdictFor(tab) {
    const s = tab.safety;
    if (!s || s.skip) return null;
    const v = Core.combine([...s.urlFindings, ages.get(s.domain), ...s.textFindings, ...s.guardFindings]);
    v.trusted = isTrusted(s.domain);
    v.checking = ages.has(s.domain) && ages.get(s.domain) === undefined;
    return v;
  }

  function renderSafety(tab) {
    if (tab !== active) return;
    const panel = $('#safety-panel'), ul = $('#safety-reasons'), wrap = $('#address-wrap');
    const s = tab.safety, v = verdictFor(tab);
    ul.innerHTML = '';
    wrap.classList.remove('lvl-caution', 'lvl-danger');
    if (!v) {
      panel.dataset.level = 'home';
      $('#safety-title').textContent = 'Safety Meter';
      $('#safety-sub').textContent = isHome(tab.url) ? 'Home page' : 'Built-in page';
      hideShield(tab); renderBanner(tab);
      return;
    }
    const lvl = v.level === 'safe' && v.checking ? 'checking' : v.level;
    panel.dataset.level = lvl;
    $('#safety-title').textContent = LEVEL_TITLE[lvl];
    $('#safety-sub').textContent = s.host;
    if (v.level !== 'safe') wrap.classList.add('lvl-' + v.level);
    const items = v.reasons.slice(0, 4).map((r) => [r.level, r.text]);
    if (!items.length) items.push(['good', v.checking ? 'Checking how old this website is…' : 'No warning signs found.']);
    if (s.https && v.level === 'safe') items.push(['good', 'Secure connection (padlock).']);
    if (v.level === 'safe' && phishIndex && phishIndex.size) {
      items.push(['good', `Not on the list of ${phishIndex.size.toLocaleString()} known phishing sites.`]);
    }
    if (v.trusted) items.push(['good', 'This site is in your Favorites.']);
    for (const [cls, text] of items) {
      const li = document.createElement('li'); li.className = cls; li.textContent = text; ul.appendChild(li);
    }
    if (v.level === 'danger' && !tab.allowed.has(s.domain)) showShield(tab, v); else hideShield(tab);
    renderBanner(tab);
  }

  function showShield(tab, v) {
    const tech = v.reasons.some((r) => r.code === 'tech-support');
    $('#shield-title').textContent = tech ? 'Fake virus warning. Do not call.' : 'Stop. This page may be a scam.';
    $('#shield-site').textContent = tab.safety.host;
    const ul = $('#shield-reasons'); ul.innerHTML = '';
    v.reasons.slice(0, 4).forEach((r) => { const li = document.createElement('li'); li.textContent = r.text; ul.appendChild(li); });
    $('#shield-advice').textContent = (v.reasons.find((r) => r.advice) || {}).advice
      || 'Close this page. If someone sent you here by email, text or phone, do not reply to them.';
    $('#shield').hidden = false;
    if (!tab.shieldMuted) { try { tab.wv.setAudioMuted(true); tab.shieldMuted = true; } catch {} }
  }

  function hideShield(tab) {
    $('#shield').hidden = true;
    if (tab.shieldMuted) { try { tab.wv.setAudioMuted(false); } catch {} tab.shieldMuted = false; }
  }

  function setBanner(tab, finding, title) {
    tab.banner = { ...finding, title };
    renderBanner(tab);
  }

  function renderBanner(tab) {
    if (tab !== active) return;
    const b = tab.banner, el = $('#safety-banner');
    if (!b || !$('#shield').hidden) { el.hidden = true; return; }
    el.className = b.level === 'danger' ? 'danger' : '';
    $('#banner-title').textContent = b.title;
    $('#banner-text').textContent = b.text + (b.advice ? ' ' + b.advice : '');
    el.hidden = false;
  }

  const GUARD_TEXT = {
    fullscreen: 'This page tried to take over your whole screen. The Safety Browser blocked it.',
    dialogs: 'This page kept popping up messages. The Safety Browser silenced them.',
    pointerlock: 'This page tried to trap your mouse. The Safety Browser blocked it.',
  };

  function onGuardMessage(tab, channel, data) {
    const s = tab.safety;
    if (!s || s.skip) return;
    if (channel === 'scan') {
      s.textFindings = Core.checkPageText(data && data.text);
      const pay = s.textFindings.find((x) => x.code === 'payment-pressure' && x.level === 'caution');
      if (pay && !tab.banner) setBanner(tab, pay, 'Watch out: payment pressure');
    } else if (channel === 'guard' && GUARD_TEXT[data]) {
      if (!s.guardFindings.some((g) => g.code === 'guard-' + data)) {
        const g = { level: 'caution', code: 'guard-' + data, text: GUARD_TEXT[data],
          advice: 'Scam pages do this so you can\'t close them. Press the red Get Me Out button.' };
        s.guardFindings.push(g);
        setBanner(tab, g, 'The Safety Browser blocked a trick');
      }
    } else if (channel === 'sensitive' && data) {
      const v = verdictFor(tab);
      const w = Core.sensitiveFieldWarning({ kind: data.kind, level: v.level, https: s.https, trusted: v.trusted });
      if (w) setBanner(tab, w, w.level === 'danger' ? 'Stop before you type' : 'Think before you type');
    }
    renderSafety(tab);
  }

  // The panic button: throw the page away entirely (kills its scripts and sound) and go home.
  function panic() {
    const bad = active;
    try { bad.wv.stop(); bad.wv.setAudioMuted(true); } catch {}
    document.body.classList.remove('fullscreen');
    api.win('leave-fullscreen');
    closeFind(); closeMenu();
    createTab(HOME);
    closeTab(bad);
    setStatus('You are safe. That page was closed.');
  }

  $('#btn-panic').onclick = panic;
  $('#shield-out').onclick = panic;
  $('#shield-continue').onclick = () => {
    const t = active, s = t.safety;
    if (!s || s.skip) return;
    t.allowed.add(s.domain);
    hideShield(t);
    if (s.stopped) { s.stopped = false; t.wv.loadURL(s.url); }
    renderTab(t);
    renderSafety(t);
  };
  $('#banner-close').onclick = () => { if (active) { active.banner = null; renderBanner(active); } };

  // Held downloads (remote-control tools and programs).
  let heldDl = null;
  function closeDownloadModal(allow) {
    if (heldDl) (allow ? api.allowDownload : api.denyDownload)(heldDl.id);
    heldDl = null;
    $('#dl-modal').hidden = true;
  }
  api.onDownloadHeld((info) => {
    if (heldDl) api.denyDownload(heldDl.id);
    heldDl = info;
    const remote = info.kind === 'remote';
    $('.dl-card').className = 'dl-card ' + info.kind;
    $('#dl-title').textContent = remote
      ? `Stop. ${info.tool} lets someone else control your computer.`
      : 'This file installs a program on your computer.';
    $('#dl-file').textContent = info.filename;
    $('#dl-body').innerHTML = remote
      ? `<p>Scammers almost always ask people to install <b>${esc(info.tool)}</b> or a program like it. Once it is running they can see your screen, open your bank and move your money.</p>
         <ul><li>Microsoft, Apple, Amazon, your bank and the government will <b>never</b> ask you to install this.</li>
         <li>If someone on the phone told you to do this, <b>hang up now</b>.</li></ul>
         <p>Only continue if a family member or helper you know in person is setting this up with you.</p>`
      : `<p>Programs can change your computer. Scam sites trick people into installing fake "updates", "video players" and "virus cleaners".</p>
         <ul><li>Only install programs you went looking for, from the maker's own website.</li>
         <li>If a pop-up or a caller told you to download this, don't.</li></ul>`;
    const phrase = remote ? 'I KNOW THIS PERSON' : 'INSTALL';
    $('#dl-confirm-label').textContent = `To download it anyway, type ${phrase} in the box.`;
    $('#dl-confirm').value = '';
    $('#dl-confirm').dataset.phrase = phrase;
    $('#dl-allow').disabled = true;
    $('#dl-modal').hidden = false;
    $('#dl-cancel').focus();
  });
  $('#dl-confirm').addEventListener('input', (e) => {
    $('#dl-allow').disabled = e.target.value.trim().toUpperCase() !== e.target.dataset.phrase;
  });
  $('#dl-cancel').onclick = () => closeDownloadModal(false);
  $('#dl-allow').onclick = () => closeDownloadModal(true);

  // ---------------------------------------------------------------- commands
  const commands = {
    'new-tab': () => createTab(),
    'close-tab': () => closeTab(active),
    'next-tab': () => cycleTab(1),
    'prev-tab': () => cycleTab(-1),
    'focus-address': () => { $('#address').focus(); $('#address').select(); },
    bookmark: toggleFavorite,
    history: () => showPanel('history'),
    print: () => active.ready && active.wv.print(),
    find: openFind,
    reload: () => active.wv.reload(),
    back: () => active.ready && active.wv.canGoBack() && active.wv.goBack(),
    forward: () => active.ready && active.wv.canGoForward() && active.wv.goForward(),
    stop: () => active.wv.stop(),
    home: () => navigate(HOME),
    'zoom-in': () => zoom(0.1),
    'zoom-out': () => zoom(-0.1),
    'zoom-reset': () => zoom(0),
    fullscreen: () => { document.body.classList.toggle('fullscreen'); api.win('fullscreen'); },
    devtools: () => active.ready && active.wv.openDevTools(),
    panel: () => $('#sidebar').classList.toggle('hidden'),
    escape: () => { closeFind(); closeMenu(); if (!$('#dl-modal').hidden) closeDownloadModal(false); },
    panic: () => panic(),
    exit: () => api.win('close'),
    about: () => createTab(HOME + '#about'),
  };
  const run = (cmd) => commands[cmd] && commands[cmd]();

  api.onShortcut(run);
  api.onOpenTab((url) => createTab(url));
  api.onWinState((max) => { document.querySelector('[data-win="max"]').title = max ? 'Restore' : 'Maximize'; });

  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    let cmd = null;
    if (ctrl && e.shiftKey && k === 'x') cmd = 'panic';
    else if (ctrl && k === 't') cmd = 'new-tab';
    else if (ctrl && k === 'w') cmd = 'close-tab';
    else if (ctrl && k === 'l') cmd = 'focus-address';
    else if (ctrl && k === 'd') cmd = 'bookmark';
    else if (ctrl && k === 'h') cmd = 'history';
    else if (ctrl && k === 'p') cmd = 'print';
    else if (ctrl && k === 'f') cmd = 'find';
    else if (ctrl && k === 'tab') cmd = e.shiftKey ? 'prev-tab' : 'next-tab';
    else if (ctrl && (k === '=' || k === '+')) cmd = 'zoom-in';
    else if (ctrl && k === '-') cmd = 'zoom-out';
    else if (ctrl && k === '0') cmd = 'zoom-reset';
    else if (k === 'f5' || (ctrl && k === 'r')) cmd = 'reload';
    else if (k === 'f11') cmd = 'fullscreen';
    else if (k === 'f12') cmd = 'devtools';
    else if (k === 'escape') cmd = 'escape';
    else if (e.altKey && k === 'arrowleft') cmd = 'back';
    else if (e.altKey && k === 'arrowright') cmd = 'forward';
    else if (e.altKey && k === 'home') cmd = 'home';
    if (cmd) { e.preventDefault(); run(cmd); }
  });

  // ---------------------------------------------------------------- menus
  const menus = {
    file: () => [['New Tab', 'new-tab', 'Ctrl+T'], ['Close Tab', 'close-tab', 'Ctrl+W'], '-', ['Print…', 'print', 'Ctrl+P'], ['Find on Page', 'find', 'Ctrl+F'], '-', ['Exit', 'exit']],
    view: () => [['Zoom In', 'zoom-in', 'Ctrl++'], ['Zoom Out', 'zoom-out', 'Ctrl+-'], ['Actual Size', 'zoom-reset', 'Ctrl+0'], '-',
      ['Side Panel', 'panel'], ['Full Screen', 'fullscreen', 'F11'], ['Developer Tools', 'devtools', 'F12']],
    favorites: () => [['Add to Favorites', 'bookmark', 'Ctrl+D'], ['Open History', 'history', 'Ctrl+H'], '-',
      ...(favorites.length ? favorites.slice(0, 15).map((f) => [f.title, () => navigate(f.url)]) : [['(empty)', null]])],
    help: () => [['About St. Pete AI Safety Browser', 'about'], ['Keyboard Shortcuts', 'about']],
  };
  let openMenuEl = null;

  function openMenu(el) {
    closeMenu();
    const pop = $('#menu-pop');
    pop.innerHTML = '';
    for (const item of menus[el.dataset.menu]()) {
      if (item === '-') { pop.appendChild(document.createElement('hr')); continue; }
      const [label, action, key] = item;
      const d = document.createElement('div');
      d.className = 'mi';
      d.innerHTML = `<span>${esc(label)}</span>${key ? `<kbd>${key}</kbd>` : ''}`;
      d.addEventListener('click', () => { closeMenu(); if (typeof action === 'function') action(); else if (action) run(action); });
      pop.appendChild(d);
    }
    const r = el.getBoundingClientRect();
    pop.style.left = r.left + 'px'; pop.style.top = r.bottom + 2 + 'px';
    pop.hidden = false; el.classList.add('open'); openMenuEl = el;
  }
  function closeMenu() {
    $('#menu-pop').hidden = true;
    if (openMenuEl) openMenuEl.classList.remove('open');
    openMenuEl = null;
  }
  document.querySelectorAll('.menu').forEach((m) => {
    m.addEventListener('click', (e) => { e.stopPropagation(); openMenuEl === m ? closeMenu() : openMenu(m); });
    m.addEventListener('mouseenter', () => { if (openMenuEl && openMenuEl !== m) openMenu(m); });
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#menu-pop')) closeMenu(); });
  window.addEventListener('blur', closeMenu);

  // ---------------------------------------------------------------- wire up buttons
  document.querySelectorAll('[data-win]').forEach((b) => b.addEventListener('click', () => api.win(b.dataset.win)));
  $('#titlebar').addEventListener('dblclick', (e) => { if (e.target.id === 'titlebar' || e.target.id === 'title-text') api.win('max'); });
  $('#btn-back').onclick = () => run('back');
  $('#btn-forward').onclick = () => run('forward');
  $('#btn-stop').onclick = () => run('stop');
  $('#btn-reload').onclick = () => run('reload');
  $('#btn-home').onclick = () => run('home');
  $('#emblem').onclick = () => run('home');
  $('#btn-search').onclick = () => { $('#sidebar').classList.remove('hidden'); $('#side-search-input').focus(); };
  $('#btn-favs').onclick = () => showPanel('favs');
  $('#btn-history').onclick = () => showPanel('history');
  $('#btn-print').onclick = () => run('print');
  $('#btn-panel').onclick = () => run('panel');
  $('#btn-newtab').onclick = () => createTab();
  $('#btn-star').onclick = toggleFavorite;
  $('#btn-go').onclick = () => navigate($('#address').value);
  $('#address').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.altKey ? createTab(toUrl(e.target.value)) : navigate(e.target.value); }
    if (e.key === 'Escape') { e.target.value = shownUrl(active.url); e.target.blur(); }
  });
  $('#address').addEventListener('focus', (e) => setTimeout(() => e.target.select(), 0));
  $('#side-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#side-search-input').value.trim();
    if (q) navigate(SEARCH + encodeURIComponent(q));
  });
  document.querySelectorAll('[data-ptab]').forEach((b) => (b.onclick = () => showPanel(b.dataset.ptab)));
  $('#clear-history').onclick = () => { history = []; saveHistory(); };
  $('#notes').value = store.get('notes', '');
  $('#notes').addEventListener('input', (e) => store.set('notes', e.target.value));
  $('#find-input').addEventListener('input', () => find(true, false));
  $('#find-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') find(!e.shiftKey); if (e.key === 'Escape') closeFind(); });
  $('#find-next').onclick = () => find(true);
  $('#find-prev').onclick = () => find(false);
  $('#find-close').onclick = closeFind;

  // ---------------------------------------------------------------- emblem sprocket + tachometer
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };

  const teeth = document.getElementById('teeth');
  for (let i = 0; teeth && i < 28; i++) {
    teeth.appendChild(mk('rect', { x: 56.5, y: 1, width: 7, height: 8, rx: 1.5, transform: `rotate(${(360 / 28) * i} 60 60)` }));
  }

  const MAX = 8, A0 = -125, A1 = 125;
  const angleFor = (v) => A0 + (A1 - A0) * (v / MAX);
  const ticks = $('#tach-ticks');
  for (let v = 0; v <= MAX; v += 0.5) {
    const a = (angleFor(v) - 90) * Math.PI / 180, major = v % 1 === 0, red = v >= 6.5;
    const r1 = 68, r2 = major ? 57 : 62;
    ticks.appendChild(mk('line', { x1: 100 + r1 * Math.cos(a), y1: 95 + r1 * Math.sin(a), x2: 100 + r2 * Math.cos(a), y2: 95 + r2 * Math.sin(a),
      stroke: red ? '#ff3b1d' : '#e8e8e8', 'stroke-width': major ? 2.4 : 1.2 }));
    if (major) {
      const t = mk('text', { x: 100 + 47 * Math.cos(a), y: 95 + 47 * Math.sin(a), class: 'tick-num' });
      if (red) t.setAttribute('style', 'fill:#ff5a30');
      t.textContent = v; ticks.appendChild(t);
    }
  }
  // redline arc
  const arc = (v0, v1, r) => {
    const p = (v) => { const a = (angleFor(v) - 90) * Math.PI / 180; return [100 + r * Math.cos(a), 95 + r * Math.sin(a)]; };
    const [x0, y0] = p(v0), [x1, y1] = p(v1);
    return `M${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1}`;
  };
  ticks.prepend(mk('path', { d: arc(6.5, 8, 66), stroke: '#c4200c', 'stroke-width': 5, fill: 'none', opacity: '.8' }));

  let tachTarget = 1, tachValue = 1, blip = 0;
  function tachBlip() { blip = 2.2; }
  setInterval(() => {
    const jitter = active && active.loading ? (Math.random() - 0.5) * 0.9 : (Math.random() - 0.5) * 0.08;
    tachValue = tachTarget + jitter + blip;
    blip *= 0.5;
    $('#needle').style.transform = `rotate(${angleFor(Math.min(MAX, Math.max(0, tachValue)))}deg)`;
    $('#tach-state').textContent = active && active.loading ? 'Pulling…' : 'Idle';
  }, 350);

  function tickClock() {
    const d = new Date();
    $('#tach-clock').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  tickClock(); setInterval(tickClock, 5000);

  // ---------------------------------------------------------------- boot
  renderFavs();
  renderHistory();
  api.onPhishFeed(setPhishFeed);
  api.phishFeed().then(setPhishFeed);
  createTab(HOME);
})();
