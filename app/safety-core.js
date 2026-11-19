/* Iron Road Safety core: pure detection rules, no Electron or DOM.
 * Loaded by the browser chrome (as window.SafetyCore) and by node tests (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SafetyCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RANK = { safe: 0, info: 0, caution: 1, danger: 2 };

  // ---------------------------------------------------------------- brands
  // key: the word scammers copy. domains: the real sites. name: how we say it.
  const BRANDS = [
    ['paypal', 'PayPal', ['paypal.com', 'paypal.me', 'paypalobjects.com']],
    ['amazon', 'Amazon', ['amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.de', 'amazon.fr', 'amazon.in', 'amazon.com.au', 'amazon.jobs', 'amazonaws.com', 'a2z.com', 'primevideo.com']],
    ['apple', 'Apple', ['apple.com', 'icloud.com', 'me.com']],
    ['icloud', 'iCloud', ['icloud.com', 'apple.com']],
    ['microsoft', 'Microsoft', ['microsoft.com', 'live.com', 'outlook.com', 'office.com', 'microsoftonline.com', 'bing.com', 'msn.com', 'windows.com', 'xbox.com', 'azure.com', 'microsoft365.com']],
    ['windows', 'Microsoft Windows', ['microsoft.com', 'windows.com']],
    ['outlook', 'Microsoft Outlook', ['outlook.com', 'live.com', 'microsoft.com', 'office.com']],
    ['google', 'Google', ['google.com', 'gmail.com', 'youtube.com', 'googleusercontent.com', 'gstatic.com', 'googleapis.com', 'google.co.uk']],
    ['gmail', 'Gmail', ['gmail.com', 'google.com']],
    ['netflix', 'Netflix', ['netflix.com']],
    ['facebook', 'Facebook', ['facebook.com', 'fb.com', 'meta.com']],
    ['instagram', 'Instagram', ['instagram.com']],
    ['wellsfargo', 'Wells Fargo', ['wellsfargo.com', 'wf.com']],
    ['chase', 'Chase Bank', ['chase.com', 'jpmorganchase.com', 'jpmorgan.com']],
    ['bankofamerica', 'Bank of America', ['bankofamerica.com', 'bofa.com']],
    ['citibank', 'Citibank', ['citi.com', 'citibank.com']],
    ['capitalone', 'Capital One', ['capitalone.com']],
    ['usbank', 'U.S. Bank', ['usbank.com']],
    ['venmo', 'Venmo', ['venmo.com']],
    ['zelle', 'Zelle', ['zellepay.com', 'zelle.com']],
    ['cashapp', 'Cash App', ['cash.app', 'squareup.com']],
    ['coinbase', 'Coinbase', ['coinbase.com']],
    ['walmart', 'Walmart', ['walmart.com']],
    ['costco', 'Costco', ['costco.com']],
    ['ebay', 'eBay', ['ebay.com']],
    ['bestbuy', 'Best Buy', ['bestbuy.com']],
    ['geeksquad', 'Geek Squad', ['geeksquad.com', 'bestbuy.com']],
    ['norton', 'Norton', ['norton.com', 'nortonlifelock.com', 'gen.com']],
    ['mcafee', 'McAfee', ['mcafee.com']],
    ['usps', 'the U.S. Postal Service', ['usps.com', 'usps.gov']],
    ['fedex', 'FedEx', ['fedex.com']],
    ['irs', 'the IRS', ['irs.gov']],
    ['medicare', 'Medicare', ['medicare.gov', 'cms.gov']],
    ['socialsecurity', 'Social Security', ['ssa.gov']],
    ['verizon', 'Verizon', ['verizon.com', 'verizonwireless.com']],
    ['xfinity', 'Xfinity', ['xfinity.com', 'comcast.com', 'comcast.net']],
    ['aarp', 'AARP', ['aarp.org']],
    ['docusign', 'DocuSign', ['docusign.com', 'docusign.net']],
  ].map(([key, name, domains]) => ({ key, name, domains }));

  const OFFICIAL = new Set(BRANDS.flatMap((b) => b.domains));

  const TWO_PART_SUFFIXES = new Set(['co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'com.au', 'net.au', 'org.au', 'co.nz',
    'co.jp', 'co.in', 'com.br', 'com.mx', 'co.za', 'com.cn', 'com.sg', 'com.tr']);

  const RISKY_TLDS = new Set(['zip', 'mov', 'top', 'xyz', 'click', 'country', 'gq', 'tk', 'ml', 'cf', 'ga', 'work',
    'rest', 'buzz', 'cam', 'icu', 'monster', 'cyou', 'sbs', 'quest', 'bond', 'lol', 'mom']);

  function registrableDomain(host) {
    const labels = String(host).toLowerCase().replace(/\.$/, '').split('.');
    if (labels.length <= 2) return labels.join('.');
    const last2 = labels.slice(-2).join('.');
    return TWO_PART_SUFFIXES.has(last2) ? labels.slice(-3).join('.') : last2;
  }

  // Undo common character swaps: paypa1 -> paypal, arnazon -> amazon, g00gle -> google.
  function deconfuse(s) {
    return s.replace(/rn/g, 'm').replace(/vv/g, 'w')
      .replace(/[0-9@$]/g, (c) => ({ 0: 'o', 1: 'l', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's' }[c] || c));
  }

  function editDistance(a, b) {
    const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = dp[0]; dp[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = dp[j];
        dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return dp[b.length];
  }

  const f = (level, code, text, advice) => ({ level, code, text, advice });

  // ---------------------------------------------------------------- URL checks
  function checkUrl(rawUrl) {
    const findings = [];
    let u;
    try { u = new URL(rawUrl); } catch { return { host: '', domain: '', findings }; }
    if (!/^https?:$/.test(u.protocol)) return { host: '', domain: '', findings };

    const host = u.hostname.toLowerCase();
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
    const domain = isIp ? host : registrableDomain(host);

    if (u.username || u.password) {
      findings.push(f('danger', 'userinfo', `The address hides its real destination. It actually goes to ${host}.`,
        'Scammers put a famous name before an "@" so the link looks real.'));
    }
    if (u.protocol === 'http:' && host !== 'localhost') {
      findings.push(f('caution', 'not-encrypted', 'This page is not encrypted (no padlock).',
        'Never type passwords or card numbers on a page without the padlock.'));
    }
    if (isIp && host !== '127.0.0.1') {
      findings.push(f('caution', 'ip-address', 'This site uses a bare number instead of a name.',
        'Real banks and stores always use a name like "chase.com".'));
    }
    if (isIp) return { host, domain, findings };

    if (host.split('.').some((l) => l.startsWith('xn--'))) {
      findings.push(f('danger', 'punycode', 'This address uses look-alike letters from another alphabet.',
        'Fake sites swap in foreign letters that look identical to English ones.'));
    }
    const tld = host.split('.').pop();
    if (RISKY_TLDS.has(tld)) {
      findings.push(f('caution', 'risky-tld', `Addresses ending in ".${tld}" are often used for scams.`));
    }
    if (host.split('.').length >= 6) {
      findings.push(f('caution', 'deep-subdomain', 'This address is unusually long and layered.'));
    }

    if (!OFFICIAL.has(domain)) {
      const label = domain.split('.')[0];
      const sub = host.slice(0, Math.max(0, host.length - domain.length - 1));
      const tokens = new Set([...sub.split(/[.-]/), ...label.split(/[-]/)].filter(Boolean));
      const joined = label.replace(/-/g, '');
      const lookalike = deconfuse(label);
      const swappedTokens = new Set([...tokens].map(deconfuse));
      const swappedJoined = deconfuse(joined);
      let hit = null;

      for (const b of BRANDS) {
        if (label === b.key) {           // e.g. paypal.net, chase.biz
          hit = f('danger', 'impersonation', `This is not the real ${b.name} website (${b.domains[0]}).`,
            `Go to ${b.domains[0]} yourself by typing it, or use your Favorites.`);
        } else if (lookalike === b.key) {
          hit = f('danger', 'lookalike', `This address imitates ${b.name} by swapping letters (${domain}).`,
            `The real site is ${b.domains[0]}.`);
        } else if (b.key.length >= 6 && editDistance(label, b.key) <= (b.key.length >= 8 ? 2 : 1)) {
          hit = f('danger', 'lookalike', `This address is a misspelling of ${b.name} (${domain}).`,
            `The real site is ${b.domains[0]}.`);
        } else if (tokens.has(b.key)) {
          hit = f('danger', 'impersonation', `This site uses the name ${b.name} but is not ${b.domains[0]}.`,
            `Scam sites put a trusted name in their address. The real site is ${b.domains[0]}.`);
        } else if (swappedTokens.has(b.key) || (b.key.length >= 6 && swappedJoined.includes(b.key) && !joined.includes(b.key))) {
          // Both tricks at once: swapped letters plus extra words (paypa1-verify.com, wellsfarg0login.com).
          hit = f('danger', 'lookalike', `This address imitates ${b.name} by swapping letters (${domain}).`,
            `The real site is ${b.domains[0]}.`);
        } else if (b.key.length >= 6 && joined.includes(b.key)) {
          hit = f(b.key.length >= 7 ? 'danger' : 'caution', 'impersonation', `This address contains "${b.key}" but is not ${b.name}.`,
            `The real site is ${b.domains[0]}.`);
        }
        if (hit) break;
      }
      if (hit) findings.push(hit);
      else if (tld !== 'gov' && tld !== 'mil' && tokens.has('gov')) {
        findings.push(f('danger', 'fake-gov', 'This address pretends to be a government site, but it does not end in ".gov".',
          'Real U.S. government websites always end in .gov.'));
      }
    }
    return { host, domain, findings };
  }

  // ---------------------------------------------------------------- domain age
  function checkDomainAge(created, now = new Date()) {
    if (!created) return null;
    const t = new Date(created).getTime();
    if (!isFinite(t)) return null;
    const days = Math.floor((now.getTime() - t) / 86400000);
    if (days < 0) return null;
    const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
    if (days < 14) return f('danger', 'new-domain', `This website was created ${when}.`,
      'Scam shops and fake login pages are usually brand new and disappear within weeks.');
    if (days < 90) return f('caution', 'young-domain', `This website is only ${days} days old.`,
      'Be careful buying from or signing in to very new websites.');
    return null;
  }

  // ---------------------------------------------------------------- page text
  const PHONE = /(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
  const TECH_STRONG = ['computer has been locked', 'computer is locked', 'pc is locked', 'computer has been blocked',
    'access to this pc has been blocked', 'do not shut down', 'do not restart', 'do not close this', 'windows defender',
    'microsoft support', 'apple support', 'call microsoft', 'call apple', 'your computer is infected', 'your pc is infected',
    'your iphone is infected', 'your mac is infected', 'firewall alert', 'error code: 0x', 'error # 0x', 'system has been compromised'];
  const TECH_WEAK = ['virus', 'infected', 'malware', 'spyware', 'trojan', 'hacked', 'security alert', 'tech support',
    'technical support', 'call immediately', 'call now', 'toll free', 'toll-free', 'identity theft', 'suspicious activity',
    'pornographic', 'license expired', 'subscription expired'];

  const PAY = ['gift card', 'google play card', 'itunes card', 'steam card', 'ebay card', 'bitcoin atm', 'crypto atm',
    'bitcoin machine', 'pay in bitcoin', 'pay with bitcoin', 'pay with crypto', 'wire transfer', 'western union',
    'moneygram', 'prepaid card', 'green dot', 'vanilla card', 'send zelle', 'via zelle', 'cash app'];
  const PRESSURE = ['immediately', 'within 24 hours', 'within 48 hours', 'today only', 'final notice', 'last warning',
    'arrest', 'warrant', 'lawsuit', 'legal action', 'suspended', 'frozen', 'penalty', 'overdue', 'act now', 'urgent',
    'do not tell', 'keep this confidential', 'prosecution', 'deportation', 'unpaid toll', 'social security number'];

  const countHits = (text, list) => list.filter((w) => text.includes(w));

  function checkPageText(raw) {
    const text = String(raw || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 40000);
    const findings = [];
    if (!text) return findings;

    const strong = countHits(text, TECH_STRONG), weak = countHits(text, TECH_WEAK);
    if (PHONE.test(text) && ((strong.length >= 1 && strong.length + weak.length >= 2) || strong.length + weak.length >= 3)) {
      findings.push(f('danger', 'tech-support',
        'This page shows a phone number together with a computer "virus" or "locked" warning.',
        'This is a tech-support scam. Microsoft, Apple and your bank never put phone numbers in warnings. Do not call. Nothing is wrong with your computer.'));
    }

    const pay = countHits(text, PAY), pressure = countHits(text, PRESSURE);
    if (pay.length && pressure.length) {
      findings.push(f(pressure.length >= 2 ? 'danger' : 'caution', 'payment-pressure',
        `This page pushes you to pay with ${pay[0].replace(/^(send|via) /, '')} and uses pressure words like "${pressure[0]}".`,
        'Government agencies and real companies never demand gift cards, crypto or wire transfers. When someone rushes you, stop and call a person you trust.'));
    }
    return findings;
  }

  // ---------------------------------------------------------------- downloads
  const REMOTE_TOOLS = [
    [/anydesk/i, 'AnyDesk'], [/teamviewer|tv_?setup|teamviewerqs/i, 'TeamViewer'], [/screenconnect|connectwise/i, 'ScreenConnect'],
    [/ultraviewer/i, 'UltraViewer'], [/logmein|lmi_?rescue|rescueassist/i, 'LogMeIn'], [/gotoassist|goto_?resolve|gotoopener/i, 'GoTo'],
    [/rustdesk/i, 'RustDesk'], [/supremo/i, 'Supremo'], [/splashtop|sos_?app/i, 'Splashtop'], [/zoho_?assist|zohoassist/i, 'Zoho Assist'],
    [/remotepc/i, 'RemotePC'], [/bomgar|beyondtrust/i, 'BeyondTrust'], [/ammyy/i, 'Ammyy Admin'], [/aeroadmin/i, 'AeroAdmin'],
    [/netsupport|client32/i, 'NetSupport'], [/atera/i, 'Atera'], [/quickassist/i, 'Quick Assist'],
    [/chromeremotedesktop/i, 'Chrome Remote Desktop'], [/dwagent|dwservice/i, 'DWService'], [/remoteutilities|rutserv/i, 'Remote Utilities'],
    [/litemanager/i, 'LiteManager'], [/action1/i, 'Action1'], [/simplehelp/i, 'SimpleHelp'], [/fixme\.it|fixmeit/i, 'FixMe.IT'],
  ];
  const PROGRAM_EXT = /\.(exe|msi|msix|appx|bat|cmd|com|scr|pif|ps1|vbs|vbe|js|jse|wsf|hta|jar|lnk|reg|cpl|iso|img|vhd|apk|dmg|pkg)$/i;

  function checkDownload(filename, url) {
    const subject = `${filename || ''} ${url || ''}`;
    for (const [re, tool] of REMOTE_TOOLS) if (re.test(subject)) return { kind: 'remote', tool };
    if (PROGRAM_EXT.test(filename || '')) return { kind: 'program', tool: null };
    return null;
  }

  // ---------------------------------------------------------------- sensitive fields
  const FIELD_NAMES = { password: 'your password', card: 'a card number', ssn: 'your Social Security number', bank: 'bank account details' };

  function sensitiveFieldWarning({ kind, level, https, trusted }) {
    const what = FIELD_NAMES[kind] || 'private information';
    if (trusted && https) return null;
    if (!https) return f('danger', 'field-unencrypted', `Do not type ${what} here. This page is not encrypted.`);
    if (level === 'danger') return f('danger', 'field-risky', `Do not type ${what} on this site. It shows signs of a scam.`);
    if (level === 'caution') return f('caution', 'field-caution', `Think twice before typing ${what} here.`,
      'If you got here from an email, text or pop-up, close it and go to the company\'s site yourself.');
    return null;
  }

  // ---------------------------------------------------------------- known-phishing list (OpenPhish feed)
  // Big shared platforms host millions of innocent pages, so only the listed page itself is blocked there.
  const SHARED_HOSTS = new Set(['sites.google.com', 'docs.google.com', 'drive.google.com', 'forms.gle', 'storage.googleapis.com',
    'firebasestorage.googleapis.com', 'script.google.com', 'github.com', 'raw.githubusercontent.com', 'gist.github.com', 'gitlab.com',
    'onedrive.live.com', '1drv.ms', 'dropbox.com', 'dl.dropboxusercontent.com', 'forms.office.com', 'ipfs.io', 'dweb.link',
    'cloudflare-ipfs.com', 'web.archive.org', 't.co', 'bit.ly', 'tinyurl.com', 'linktr.ee', 'jotform.com', 'form.jotform.com',
    'canva.com', 'notion.so', 'medium.com', 'wix.com', 'weebly.com', 'blogspot.com', 'wordpress.com', 'pages.dev', 'r2.dev',
    'vercel.app', 'netlify.app', 'webflow.io', 'glitch.me', 'replit.app', 'translate.goog', 'mailchi.mp', 'docsend.com']);

  const bareHost = (h) => String(h).toLowerCase().replace(/^www\./, '');
  const pageKey = (u) => bareHost(u.hostname) + u.pathname.replace(/\/+$/, '') + u.search;

  function buildPhishIndex(lines) {
    const pages = new Set(), hosts = new Set();
    for (const line of lines || []) {
      let u; try { u = new URL(String(line).trim()); } catch { continue; }
      if (!/^https?:$/.test(u.protocol)) continue;
      pages.add(pageKey(u));
      hosts.add(bareHost(u.hostname));
    }
    return { pages, hosts, size: pages.size };
  }

  function checkPhishList(index, rawUrl) {
    if (!index || !index.size) return null;
    let u; try { u = new URL(rawUrl); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = bareHost(u.hostname);
    const advice = 'Phishing pages copy real sign-in and payment pages to steal passwords and card numbers. Close it and do not enter anything.';

    // The listed page, or any page beneath it (…/verify/index.php covers …/verify/index.php/step2).
    if (index.pages.has(pageKey(u))) return f('danger', 'phish-list', 'This page is on a list of known phishing (scam) sites.', advice);
    const segs = u.pathname.split('/').filter(Boolean);
    for (let i = segs.length - 1; i >= 1; i--) {
      if (index.pages.has(host + '/' + segs.slice(0, i).join('/'))) {
        return f('danger', 'phish-list', 'This page is on a list of known phishing (scam) sites.', advice);
      }
    }
    // The whole website, unless it is a shared platform or a real brand's own site.
    const reg = registrableDomain(host);
    if (index.hosts.has(host) && !SHARED_HOSTS.has(host) && !SHARED_HOSTS.has(reg) && !OFFICIAL.has(reg)) {
      return f('danger', 'phish-host', 'This website is on a list of known phishing (scam) sites.', advice);
    }
    return null;
  }

  // ---------------------------------------------------------------- combine
  function combine(findings) {
    const seen = new Set();
    const reasons = (findings || []).filter(Boolean).filter((x) => {
      const k = x.code + '|' + x.text; if (seen.has(k)) return false; seen.add(k); return true;
    }).sort((a, b) => RANK[b.level] - RANK[a.level]);
    const top = reasons.reduce((m, r) => Math.max(m, RANK[r.level] || 0), 0);
    return { level: top === 2 ? 'danger' : top === 1 ? 'caution' : 'safe', reasons };
  }

  return { BRANDS, registrableDomain, checkUrl, checkDomainAge, checkPageText, checkDownload, sensitiveFieldWarning,
    buildPhishIndex, checkPhishList, combine, editDistance };
});
