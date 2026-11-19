// Local fake-scam pages for manually testing Iron Road's safety features.
// Run: node test/scam-fixtures-server.js   then visit http://localhost:8765/
const http = require('http');

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:Segoe UI,sans-serif;padding:30px">${body}</body></html>`;

const routes = {
  '/': page('Iron Road safety test pages', `<h1>Safety test pages</h1><ul>
    <li><a href="/techscam">Tech-support scam</a></li>
    <li><a href="/pay">Payment pressure (gift cards)</a></li>
    <li><a href="/login">Password form on an unencrypted page</a></li>
    <li><a href="/download/AnyDesk.exe">Remote-control download</a></li>
    <li><a href="/download/free-player-setup.exe">Program download</a></li></ul>`),
  '/techscam': page('Windows Defender Security Alert', `
    <h1 style="color:#c00">WINDOWS DEFENDER SECURITY ALERT</h1>
    <p>Your computer has been locked due to a virus infection (Error code: 0x80070424).</p>
    <p>Do not shut down or restart your PC. Call Microsoft Support immediately: <b>1-888-555-0199</b> (toll free)</p>
    <script>document.addEventListener('click', () => document.documentElement.requestFullscreen().catch(() => {}));
      setTimeout(() => document.body.requestFullscreen().catch(() => {}), 300);</script>`),
  '/pay': page('Gift card offer', `<h1>Holiday savings</h1><p>Buy a gift card for the family. Sale ends today only!</p>`),
  '/login': page('Sign in', `<h1>Sign in to your account</h1>
    <form><label>Email <input name="email"></label><br><br><label>Password <input type="password" name="pw" autofocus></label></form>
    <script>window.addEventListener('load', () => setTimeout(() => document.querySelector('[type=password]').focus(), 300));</script>`),
};

http.createServer((req, res) => {
  if (req.url.startsWith('/download/')) {
    const name = req.url.slice('/download/'.length);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"` });
    return res.end('this is not a real program');
  }
  const html = routes[req.url];
  res.writeHead(html ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html || 'not found');
}).listen(8765, () => console.log('scam fixtures on http://localhost:8765/'));
