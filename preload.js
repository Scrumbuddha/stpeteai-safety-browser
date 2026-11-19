const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

contextBridge.exposeInMainWorld('ironroad', {
  homeUrl: pathToFileURL(path.join(__dirname, 'app', 'start.html')).href,
  guardPreload: pathToFileURL(path.join(__dirname, 'app', 'guard-preload.js')).href,
  win: (action) => ipcRenderer.send('win', action),
  onWinState: (cb) => ipcRenderer.on('win-state', (_e, max) => cb(max)),
  onOpenTab: (cb) => ipcRenderer.on('open-tab', (_e, url) => cb(url)),
  onShortcut: (cb) => ipcRenderer.on('shortcut', (_e, cmd) => cb(cmd)),
  domainAge: (domain) => ipcRenderer.invoke('domain-age', domain),
  phishFeed: () => ipcRenderer.invoke('phish-feed'),
  onPhishFeed: (cb) => ipcRenderer.on('phish-feed', (_e, feed) => cb(feed)),
  onDownloadHeld: (cb) => ipcRenderer.on('download-held', (_e, info) => cb(info)),
  allowDownload: (id) => ipcRenderer.send('download-allow', id),
  denyDownload: (id) => ipcRenderer.send('download-deny', id),
});
