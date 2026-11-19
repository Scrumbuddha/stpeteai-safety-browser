// Makes the near-white background around an image transparent (flood fill from the edges).
// Usage: electron tools/cutout.js <input> <output.png>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const [input, output] = process.argv.slice(-2);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');
  const dataUrl = 'data:image/jpeg;base64,' + fs.readFileSync(path.resolve(input)).toString('base64');
  const png = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(dataUrl)}; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data, W = c.width, H = c.height;
    const whiteness = (i) => Math.min(p[i], p[i + 1], p[i + 2]);
    const seen = new Uint8Array(W * H), stack = [];
    for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
    for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
    while (stack.length) {
      const k = stack.pop(); if (seen[k]) continue; seen[k] = 1;
      const w = whiteness(k * 4); if (w < 200) continue;          // hit the badge edge
      p[k * 4 + 3] = w > 235 ? 0 : Math.round(255 * (235 - w) / 35); // soft edge
      const x = k % W, y = (k / W) | 0;
      if (x > 0) stack.push(k - 1); if (x < W - 1) stack.push(k + 1);
      if (y > 0) stack.push(k - W); if (y < H - 1) stack.push(k + W);
    }
    g.putImageData(d, 0, 0);
    return c.toDataURL('image/png');
  })()`);
  fs.writeFileSync(path.resolve(output), Buffer.from(png.split(',')[1], 'base64'));
  console.log('wrote', output);
  app.quit();
});
