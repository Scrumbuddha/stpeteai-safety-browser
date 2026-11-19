const { app, BrowserWindow, ipcMain, Menu, session, webContents, net } = require('electron');
const path = require('path');
const Safety = require('./app/safety-core.js');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 820,
    minHeight: 560,
    frame: false,
    backgroundColor: '#0b0b0b',
    title: 'St. Pete AI Safety Browser',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.on('maximize', () => win.webContents.send('win-state', true));
  win.on('unmaximize', () => win.webContents.send('win-state', false));

  // Dev aid: IRONROAD_SHOT=out.png saves a screenshot after startup, then quits.
  if (process.env.IRONROAD_NAV) {
    win.webContents.once('did-finish-load', () =>
      setTimeout(() => win.webContents.send('open-tab', process.env.IRONROAD_NAV), 800));
  }
  // Dev aid: IRONROAD_PAGE_JS runs a snippet inside the newest page shortly before the screenshot
  // (e.g. to simulate typing into a password box).
  if (process.env.IRONROAD_PAGE_JS) {
    setTimeout(() => {
      const pages = webContents.getAllWebContents().filter((c) => c.getType() === 'webview');
      const page = pages.find((c) => c.getURL().startsWith('http')) || pages.pop();
      if (page) page.executeJavaScript(process.env.IRONROAD_PAGE_JS).catch((err) => console.log('[page-js] ' + err));
    }, Number(process.env.IRONROAD_SHOT_DELAY || 4000) - 2000);
  }
  if (process.env.IRONROAD_SHOT) {
    win.webContents.on('console-message', (_e, level, message, line, source) =>
      console.log(`[renderer:${level}] ${message} (${source}:${line})`));
    setTimeout(async () => {
      const img = await win.capturePage();
      require('fs').writeFileSync(process.env.IRONROAD_SHOT, img.toPNG());
      app.quit();
    }, Number(process.env.IRONROAD_SHOT_DELAY || 4000));
  }
}

// Keyboard shortcuts that should work even while a page has focus.
function shortcutFor(input) {
  if (input.type !== 'keyDown') return null;
  const k = input.key.toLowerCase();
  const ctrl = input.control || input.meta;
  if (ctrl && input.shift && k === 'x') return 'panic';
  if (ctrl && k === 't') return 'new-tab';
  if (ctrl && k === 'w') return 'close-tab';
  if (ctrl && k === 'l') return 'focus-address';
  if (ctrl && k === 'd') return 'bookmark';
  if (ctrl && k === 'h') return 'history';
  if (ctrl && k === 'p') return 'print';
  if (ctrl && k === 'f') return 'find';
  if (ctrl && k === 'tab') return input.shift ? 'prev-tab' : 'next-tab';
  if (ctrl && (k === '=' || k === '+')) return 'zoom-in';
  if (ctrl && k === '-') return 'zoom-out';
  if (ctrl && k === '0') return 'zoom-reset';
  if (k === 'f5' || (ctrl && k === 'r')) return 'reload';
  if (k === 'f11') return 'fullscreen';
  if (k === 'f12') return 'devtools';
  if (k === 'escape') return 'escape';
  if (input.alt && k === 'arrowleft') return 'back';
  if (input.alt && k === 'arrowright') return 'forward';
  if (input.alt && k === 'home') return 'home';
  return null;
}

app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return;
  // Pop-ups and target=_blank links open as new tabs instead of new windows.
  contents.setWindowOpenHandler(({ url }) => {
    if (win) win.webContents.send('open-tab', url);
    return { action: 'deny' };
  });
  contents.on('before-input-event', (event, input) => {
    const cmd = shortcutFor(input);
    if (cmd && cmd !== 'escape') {
      event.preventDefault();
      win.webContents.send('shortcut', cmd);
    }
  });
  // Pages can never trap you with "Are you sure you want to leave?"
  contents.on('will-prevent-unload', (event) => event.preventDefault());
});

ipcMain.on('win', (_e, action) => {
  if (!win) return;
  if (action === 'min') win.minimize();
  else if (action === 'max') (win.isMaximized() ? win.unmaximize() : win.maximize());
  else if (action === 'close') win.close();
  else if (action === 'fullscreen') win.setFullScreen(!win.isFullScreen());
  else if (action === 'leave-fullscreen' && win.isFullScreen()) win.setFullScreen(false);
});

// ---------------------------------------------------------------- download guard
// Remote-control tools and program files are held until the person confirms.
const heldDownloads = new Map();
const allowOnce = new Set();
let heldSeq = 1;

function guardDownloads(ses) {
  ses.on('will-download', (event, item, wc) => {
    const url = item.getURL();
    if (allowOnce.has(url)) { allowOnce.delete(url); return; }
    const verdict = Safety.checkDownload(item.getFilename(), url);
    if (!verdict) return;
    event.preventDefault(); // cancels the download
    const id = heldSeq++;
    heldDownloads.set(id, { url, wcId: wc ? wc.id : null });
    if (win) win.webContents.send('download-held', { id, filename: item.getFilename(), url, ...verdict });
  });
}

ipcMain.on('download-allow', (_e, id) => {
  const held = heldDownloads.get(id);
  heldDownloads.delete(id);
  if (!held) return;
  allowOnce.add(held.url);
  const wc = held.wcId && webContents.fromId(held.wcId);
  (wc && !wc.isDestroyed() ? wc : win.webContents).downloadURL(held.url);
});
ipcMain.on('download-deny', (_e, id) => heldDownloads.delete(id));

// ---------------------------------------------------------------- OpenPhish community feed
// Free list of currently active phishing URLs. Cached on disk so protection works offline,
// refreshed every 6 hours (the community feed itself updates roughly twice a day).
const fs = require('fs');
const FEED_URL = 'https://openphish.com/feed.txt';
const FEED_EVERY_MS = 6 * 60 * 60 * 1000;
let phishFeed = { lines: [], updated: null };
const feedFile = () => path.join(app.getPath('userData'), 'openphish-feed.json');

function loadCachedFeed() {
  try {
    const saved = JSON.parse(fs.readFileSync(feedFile(), 'utf8'));
    if (Array.isArray(saved.lines)) phishFeed = saved;
  } catch (_) { /* first run: no cache yet */ }
}

function withTestEntries(feed) {
  // Dev aid: IRONROAD_PHISH_EXTRA adds fake entries (e.g. local test pages) to the list.
  const extra = (process.env.IRONROAD_PHISH_EXTRA || '').split(/\s+/).filter(Boolean);
  return extra.length ? { ...feed, lines: [...feed.lines, ...extra] } : feed;
}

async function refreshFeed() {
  try {
    const res = await net.fetch(FEED_URL, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const lines = (await res.text()).split(/\r?\n/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
    if (lines.length < 10) throw new Error(`feed looked empty (${lines.length} entries)`);
    phishFeed = { lines, updated: new Date().toISOString() };
    fs.writeFileSync(feedFile(), JSON.stringify(phishFeed));
    console.log(`[openphish] ${lines.length} entries`);
  } catch (err) {
    console.log('[openphish] refresh failed, keeping cached list: ' + err.message);
  }
  if (win && !win.isDestroyed()) win.webContents.send('phish-feed', withTestEntries(phishFeed));
}

function startFeed() {
  loadCachedFeed();
  const age = phishFeed.updated ? Date.now() - new Date(phishFeed.updated).getTime() : Infinity;
  // Stale or missing: fetch now. Fresh: wait until it is 6 hours old. Then every 6 hours.
  const firstIn = age >= FEED_EVERY_MS ? 0 : FEED_EVERY_MS - age;
  setTimeout(() => { refreshFeed(); setInterval(refreshFeed, FEED_EVERY_MS); }, firstIn);
}

ipcMain.handle('phish-feed', () => withTestEntries(phishFeed));

// ---------------------------------------------------------------- domain age (RDAP)
const ageCache = new Map();
ipcMain.handle('domain-age', async (_e, domain) => {
  if (typeof domain !== 'string' || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return null;
  if (ageCache.has(domain)) return ageCache.get(domain);
  let created = null;
  try {
    const res = await net.fetch(`https://rdap.org/domain/${domain}`, { signal: AbortSignal.timeout(7000) });
    if (res.ok) {
      const data = await res.json();
      const reg = (data.events || []).find((ev) => ev.eventAction === 'registration');
      created = reg ? reg.eventDate : null;
    }
  } catch (_) { /* offline or no RDAP for this TLD: say nothing */ }
  ageCache.set(domain, created);
  return created;
});

// One window only: launching again focuses the existing one and opens any URL passed in.
// Screenshot test runs get a throwaway profile so they never collide with a running copy.
if (process.env.IRONROAD_SHOT) app.setPath('userData', path.join(app.getPath('temp'), 'ironroad-test-profile'));
else {
  // Keep using the original "Iron Road" profile folder after the rename, so favorites,
  // history, notes, sign-ins and the cached phishing list carry over.
  app.setPath('userData', path.join(app.getPath('appData'), 'Iron Road'));
  if (!app.requestSingleInstanceLock()) app.quit();
}
app.on('second-instance', (_e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  const url = argv.find((a) => /^https?:\/\//i.test(a));
  if (url) win.webContents.send('open-tab', url);
});

app.setAppUserModelId('local.ironroad.browser');
app.whenReady().then(() => {
  guardDownloads(session.fromPartition('persist:ironroad'));
  guardDownloads(session.defaultSession);
  startFeed();
  createWindow();
});
app.on('window-all-closed', () => app.quit());
