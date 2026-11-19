/* Runs inside every web page (webview preload). Sandboxed: only 'electron' may be required. */
const { ipcRenderer, webFrame } = require('electron');

// ---- 1. Lock-down patches that must run in the page's own JavaScript world.
function pageGuard() {
  const tell = (what) => { try { window.postMessage({ __ironroadGuard: what }, '*'); } catch (_) {} };

  // Alert/confirm loops: allow two, then silently swallow the rest.
  let dialogs = 0;
  for (const name of ['alert', 'confirm', 'prompt']) {
    const orig = window[name];
    if (typeof orig !== 'function') continue;
    window[name] = function (...args) {
      dialogs++;
      if (dialogs > 2) { if (dialogs === 3) tell('dialogs'); return name === 'confirm' ? false : name === 'prompt' ? null : undefined; }
      return orig.apply(window, args);
    };
  }

  // "Are you sure you want to leave?" traps.
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (type === 'beforeunload') return undefined;
    return add.call(this, type, ...rest);
  };
  try { Object.defineProperty(window, 'onbeforeunload', { configurable: false, get: () => null, set: () => {} }); } catch (_) {}

  // Full-screen takeover: allowed only for videos (YouTube etc.).
  const hasVideo = (el) => el && (el.tagName === 'VIDEO' || (el.querySelector && el.querySelector('video')));
  for (const fn of ['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen']) {
    const orig = Element.prototype[fn];
    if (!orig) continue;
    Element.prototype[fn] = function (...args) {
      if (hasVideo(this)) return orig.apply(this, args);
      tell('fullscreen');
      return Promise.reject(new TypeError('Full screen was blocked by St. Pete AI Safety Browser.'));
    };
  }
  // Keyboard and mouse capture used to stop people closing the page.
  if (navigator.keyboard) { try { navigator.keyboard.lock = () => Promise.reject(new TypeError('Blocked by St. Pete AI Safety Browser.')); } catch (_) {} }
  Element.prototype.requestPointerLock = function () { tell('pointerlock'); };
}
webFrame.executeJavaScript(`(${pageGuard.toString()})()`).catch(() => {});

// ---- 2. Report back to the browser chrome.
window.addEventListener('message', (e) => {
  if (e.source === window && e.data && e.data.__ironroadGuard) ipcRenderer.sendToHost('guard', e.data.__ironroadGuard);
});

let lastText = '', scans = 0;
function scan() {
  if (!document.body || scans > 25) return;
  const text = (document.body.innerText || '').slice(0, 40000);
  if (text === lastText) return;
  lastText = text; scans++;
  ipcRenderer.sendToHost('scan', { text, title: document.title });
}
window.addEventListener('DOMContentLoaded', () => {
  scan();
  let t;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(scan, 1500); })
    .observe(document.documentElement, { childList: true, subtree: true, characterData: true });
});
window.addEventListener('load', () => setTimeout(scan, 800));

function classify(el) {
  const type = (el.type || '').toLowerCase();
  const hint = [el.name, el.id, el.autocomplete, el.placeholder, el.getAttribute('aria-label')].join(' ').toLowerCase();
  if (type === 'password') return 'password';
  if (/cc-number|cc-csc|card.?num|credit.?card|debit.?card|cvv|cvc|security.?code/.test(hint)) return 'card';
  if (/\bssn\b|social.?security/.test(hint)) return 'ssn';
  if (/routing|account.?num|bank.?acc/.test(hint)) return 'bank';
  return null;
}
const reported = new Set();
function checkField(e) {
  const el = e.target;
  if (!(el instanceof HTMLInputElement)) return;
  const kind = classify(el);
  if (kind && !reported.has(kind)) { reported.add(kind); ipcRenderer.sendToHost('sensitive', { kind }); }
}
// Focus alone is not reliable (e.g. autofocus while the window is in the background), so also watch clicks and typing.
for (const type of ['focusin', 'pointerdown', 'keydown', 'input']) document.addEventListener(type, checkField, true);
