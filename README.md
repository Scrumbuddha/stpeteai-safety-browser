# St. Pete AI Safety Browser

A free web browser for Windows that steps in before online scams can reach you. It's built for older adults and anyone else who is targeted by phishing, fake virus warnings and payment scams. It's a community project of [St. Pete AI](https://stpeteai.org), a nonprofit in Saint Petersburg, Florida.

**Download:** get the latest installer from [Releases](https://github.com/Scrumbuddha/stpeteai-safety-browser/releases/latest) (Windows 10 or 11, 64-bit). Once installed, the browser keeps itself up to date.

## What it protects against

| Protection | What happens |
|---|---|
| **Safety Meter** | A green, yellow or red light on every page, with plain-language reasons. |
| **Fake website addresses** | Look-alikes such as `paypa1.com` or `amaz0n-billing.com`, fake `.gov` names, hidden letters and "@" tricks are stopped before the page loads. |
| **Known phishing sites** | Every address is checked on your computer against the [OpenPhish](https://openphish.com) list of active phishing sites. |
| **Fake virus warnings** | "Your computer is locked, call Microsoft" pages get a stop screen. They can't take over the screen or loop pop-ups. |
| **Get Me Out button** | One big red button (or Ctrl+Shift+X) closes any page instantly. |
| **Remote-control programs** | Downloads of AnyDesk, TeamViewer and about 20 similar tools are held behind a clear warning. |
| **Program downloads** | `.exe`, `.msi` and similar files must be confirmed before they download. |
| **Payment pressure** | Gift cards, crypto or wire transfers combined with threats or deadlines trigger a warning. |
| **Password and card guard** | A warning before you type sensitive details on an unsafe page. |
| **Brand-new websites** | Sites registered in the last few days are flagged. |

No protection is perfect. The browser lowers the risk; it doesn't remove it.

Privacy: no accounts, ads or tracking. See [PRIVACY.md](PRIVACY.md) for the three outside services the browser contacts.

## For developers

Requires Node.js 20 or newer.

```
npm install
npm test             # unit tests for the scam-detection rules (app/safety-core.js)
npm start            # run from source
npm run scam-pages   # local fake scam pages for manual testing (http://localhost:8765)
npm run dist         # build the installer into dist/
npm run release      # build and publish a GitHub release (needs GH_TOKEN)
```

Layout:

- `main.js`: app startup, download guard, phishing list, automatic updates
- `app/safety-core.js`: all detection rules, with no Electron dependencies so they're easy to test
- `app/guard-preload.js`: runs in each web page and blocks screen takeover, pop-up loops and similar tricks
- `app/renderer.js`, `app/index.html`, `app/styles.css`: the browser window
- `app/start.html`: the Safety Home page

### Publishing a release

1. Bump `version` in `package.json` and commit.
2. Set `GH_TOKEN` to a GitHub token with `repo` scope, then run `npm run release`. This uploads the installer, `latest.yml` and the blockmap to a GitHub release.
3. Installed copies download the update in the background and install it the next time they close.

Release builds should be code-signed before wide distribution, or Windows SmartScreen will warn about an unknown publisher.

## License

Source code: ISC. The St. Pete AI name, logo and artwork are not covered. See [LICENSE](LICENSE).
