const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../app/safety-core.js');

const codes = (findings) => findings.map((f) => f.code);
const levelOf = (url) => S.combine(S.checkUrl(url).findings).level;

test('registrableDomain handles plain and two-part suffixes', () => {
  assert.equal(S.registrableDomain('www.paypal.com'), 'paypal.com');
  assert.equal(S.registrableDomain('login.amazon.co.uk'), 'amazon.co.uk');
  assert.equal(S.registrableDomain('example.com'), 'example.com');
});

test('official brand sites are clean', () => {
  for (const u of ['https://www.paypal.com/signin', 'https://www.amazon.com/', 'https://accounts.google.com/',
    'https://secure.chase.com/', 'https://www.irs.gov/refunds', 'https://www.wellsfargo.com/', 'https://www.bankofamerica.com/']) {
    assert.equal(levelOf(u), 'safe', u);
  }
});

test('ordinary sites that merely contain brand-ish letters are not flagged as danger', () => {
  for (const u of ['https://www.applebees.com/', 'https://www.purchase.edu/', 'https://www.apply.com/', 'https://pop-ups.com/', 'https://en.wikipedia.org/wiki/PayPal']) {
    assert.notEqual(levelOf(u), 'danger', u);
  }
});

test('character-swap lookalikes are danger', () => {
  assert.ok(codes(S.checkUrl('https://paypa1.com/login').findings).includes('lookalike'));
  assert.equal(levelOf('https://paypa1.com/login'), 'danger');
  assert.equal(levelOf('https://arnazon.com/'), 'danger'); // rn -> m
  assert.equal(levelOf('https://g00gle.com/'), 'danger');
});

test('letter swaps combined with extra words are danger', () => {
  assert.equal(levelOf('https://paypa1-verify.com/signin'), 'danger');
  assert.equal(levelOf('https://secure-arnazon-billing.com/'), 'danger');
  assert.equal(levelOf('https://wellsfarg0login.com/'), 'danger');
  assert.notEqual(levelOf('https://www.applebees.com/'), 'danger');
});

test('typo-squats of longer brands are danger', () => {
  assert.equal(levelOf('https://wellsfargp.com/'), 'danger');
  assert.equal(levelOf('https://amazom.com/'), 'danger');
  assert.equal(levelOf('https://netfllx.com/'), 'danger');
});

test('brand name used as a word in someone else\'s address is danger', () => {
  assert.equal(levelOf('https://paypal-verify-account.com/'), 'danger');
  assert.equal(levelOf('https://paypal.com.secure-login.xyz/'), 'danger');
  assert.equal(levelOf('https://irs-refund-center.com/'), 'danger');
  const f = S.checkUrl('https://paypal-verify-account.com/').findings.find((x) => x.code === 'impersonation');
  assert.match(f.text, /PayPal/);
});

test('punycode, user-info tricks, raw IPs and http are flagged', () => {
  assert.equal(levelOf('https://xn--pypal-4ve.com/'), 'danger');
  assert.equal(levelOf('https://www.paypal.com@evil.example/'), 'danger');
  assert.equal(levelOf('http://192.168.4.20/login'), 'caution');
  assert.equal(levelOf('http://example.com/'), 'caution');
  assert.ok(codes(S.checkUrl('https://cheap-deals.top/').findings).includes('risky-tld'));
});

test('domain age thresholds', () => {
  const now = new Date('2026-11-18T00:00:00Z');
  assert.equal(S.checkDomainAge('2026-11-12T00:00:00Z', now).level, 'danger');
  assert.equal(S.checkDomainAge('2026-09-30T00:00:00Z', now).level, 'caution');
  assert.equal(S.checkDomainAge('2015-01-01T00:00:00Z', now), null);
  assert.equal(S.checkDomainAge(null, now), null);
});

test('tech-support scam page text is danger', () => {
  const text = 'WINDOWS DEFENDER SECURITY ALERT. Your computer has been locked due to a virus. Do not shut down your PC. Call Microsoft Support now: 1-888-555-0199';
  const f = S.checkPageText(text);
  assert.ok(codes(f).includes('tech-support'));
  assert.equal(S.combine(f).level, 'danger');
});

test('a phone number with ordinary text is not tech-support', () => {
  assert.deepEqual(codes(S.checkPageText('Call our store at (727) 555-0100 for hours and directions.')), []);
  assert.deepEqual(codes(S.checkPageText('A computer virus is malware. Learn how antivirus works.')), []);
});

test('payment pressure language', () => {
  const scam = 'FINAL NOTICE: a warrant has been issued. To avoid arrest you must pay immediately with Google Play gift cards.';
  assert.ok(codes(S.checkPageText(scam)).includes('payment-pressure'));
  assert.equal(S.combine(S.checkPageText(scam)).level, 'danger');
  const shop = 'Shop gift cards for every occasion. Free shipping.';
  assert.deepEqual(codes(S.checkPageText(shop)), []);
  const sale = 'Gift cards on sale today only!';
  assert.notEqual(S.combine(S.checkPageText(sale)).level, 'danger');
});

test('download classification', () => {
  assert.equal(S.checkDownload('AnyDesk.exe', 'https://download.anydesk.com/AnyDesk.exe').kind, 'remote');
  assert.equal(S.checkDownload('TeamViewer_Setup_x64.exe', 'https://x/').tool, 'TeamViewer');
  assert.equal(S.checkDownload('ScreenConnect.ClientSetup.msi', 'https://x/').kind, 'remote');
  assert.equal(S.checkDownload('setup.exe', 'https://x/').kind, 'program');
  assert.equal(S.checkDownload('invoice.pdf.exe', 'https://x/').kind, 'program');
  assert.equal(S.checkDownload('report.pdf', 'https://x/'), null);
  assert.equal(S.checkDownload('photo.jpg', 'https://x/'), null);
});

test('sensitive field warnings', () => {
  assert.equal(S.sensitiveFieldWarning({ kind: 'password', level: 'safe', https: true, trusted: false }), null);
  assert.equal(S.sensitiveFieldWarning({ kind: 'password', level: 'safe', https: false, trusted: false }).level, 'danger');
  assert.equal(S.sensitiveFieldWarning({ kind: 'card', level: 'caution', https: true, trusted: false }).level, 'caution');
  assert.equal(S.sensitiveFieldWarning({ kind: 'card', level: 'caution', https: true, trusted: true }), null);
});

test('phishing list: exact pages, deeper pages and dedicated hosts are danger', () => {
  const idx = S.buildPhishIndex([
    'https://secure-login-update.example-bad.com/verify/index.php',
    'http://rack-qs-e4aabd.9f37.com/',
    'https://sites.google.com/view/paypal-help-desk',
    'not a url',
  ]);
  assert.equal(idx.size, 3);
  assert.equal(S.checkPhishList(idx, 'https://secure-login-update.example-bad.com/verify/index.php').level, 'danger');
  assert.equal(S.checkPhishList(idx, 'http://secure-login-update.example-bad.com/verify/index.php#x').code, 'phish-list');
  assert.equal(S.checkPhishList(idx, 'https://rack-qs-e4aabd.9f37.com/login/step2').level, 'danger');
  assert.equal(S.checkPhishList(idx, 'https://www.rack-qs-e4aabd.9f37.com/').level, 'danger');
  assert.equal(S.checkPhishList(idx, 'https://secure-login-update.example-bad.com/other').code, 'phish-host');
});

test('phishing list: shared hosting sites only block the listed page', () => {
  const idx = S.buildPhishIndex(['https://sites.google.com/view/paypal-help-desk', 'https://docs.google.com/forms/d/abc123/viewform']);
  assert.equal(S.checkPhishList(idx, 'https://sites.google.com/view/paypal-help-desk').level, 'danger');
  assert.equal(S.checkPhishList(idx, 'https://sites.google.com/view/paypal-help-desk/contact').level, 'danger');
  assert.equal(S.checkPhishList(idx, 'https://sites.google.com/view/my-church-bake-sale'), null);
  assert.equal(S.checkPhishList(idx, 'https://docs.google.com/document/d/xyz'), null);
});

test('phishing list: empty or missing index is harmless', () => {
  assert.equal(S.checkPhishList(null, 'https://example.com/'), null);
  assert.equal(S.checkPhishList(S.buildPhishIndex([]), 'https://example.com/'), null);
  assert.equal(S.checkPhishList(S.buildPhishIndex(['https://evil.example/']), 'file:///C:/x.html'), null);
});

test('combine picks the worst level and keeps reasons ordered by severity', () => {
  const v = S.combine([{ level: 'caution', code: 'a', text: 'A' }, { level: 'danger', code: 'b', text: 'B' }]);
  assert.equal(v.level, 'danger');
  assert.equal(v.reasons[0].code, 'b');
  assert.equal(S.combine([]).level, 'safe');
});
