// Renders the Iron Road emblem to build/icon.png (512x512, transparent).
// Run with: electron tools/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const teeth = Array.from({ length: 28 }, (_, i) =>
  `<rect x="56.5" y="1" width="7" height="8" rx="1.5" transform="rotate(${(360 / 28) * i} 60 60)"/>`).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="512" height="512">
  <defs>
    <radialGradient id="c" cx="40%" cy="30%" r="75%"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#b9bcc2"/><stop offset=".7" stop-color="#4b4e55"/><stop offset="1" stop-color="#d6d8dc"/></radialGradient>
    <linearGradient id="o" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a3c"/><stop offset="1" stop-color="#c94a06"/></linearGradient>
  </defs>
  <g fill="url(#c)"><circle cx="60" cy="60" r="54"/>${teeth}</g>
  <circle cx="60" cy="60" r="47" fill="#0c0c0c" stroke="#5a5d63" stroke-width="1.5"/>
  <g fill="url(#c)">
    <path d="M60 60 L14 44 L21 51 L10 51 L21 58 L12 60 L26 65 L19 69 L40 70 Z"/>
    <path d="M60 60 L106 44 L99 51 L110 51 L99 58 L108 60 L94 65 L101 69 L80 70 Z"/>
  </g>
  <path d="M40 34 H80 V60 Q80 80 60 92 Q40 80 40 60 Z" fill="url(#o)" stroke="#fff" stroke-width="2.5"/>
  <path d="M50 42 H70 M60 42 V82" stroke="#111" stroke-width="7" stroke-linecap="square"/>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false,
    webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,' + encodeURIComponent(
    `<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`));
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const out = path.join(__dirname, '..', 'build');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.png'), img.resize({ width: 512, height: 512 }).toPNG());
  fs.writeFileSync(path.join(out, 'icon.svg'), svg);
  console.log('wrote build/icon.png');
  app.quit();
});
