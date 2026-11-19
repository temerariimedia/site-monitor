# Site monitoring

`.github/workflows/site-monitor.yml` runs `scripts/monitor.mjs` every 30 minutes (and on demand).
No secrets, no dependencies, Node 20.

## What is checked

For each site: www.temerarii.com, temerarii.xyz, domdavis.network, www.cominc.org, learn.cominc.org

- Home returns 200, its first `<h1>` contains the expected text, and it responds in under 5 s
- 3 key inner pages return 200 (listed in `SITES` in `scripts/monitor.mjs`)
- `/favicon.ico` returns 200
- `/sitemap.xml` returns 200 and is a real sitemap
- TLS certificate has more than 14 days left

Plus the TM CRM intake (`temerarii-office-app.vercel.app/api/intake`): a valid lead payload with
`"dry": true` must return 2xx with `ok: true, dry: true`. Dry runs validate and route only; nothing is
written and no lead is created. Never remove the `dry` flag.

A failing check is retried once after 60 s before the run is marked failed.

## How alerts arrive

A failed run makes GitHub email the account that owns the workflow schedule (the last person to edit the
cron, normally the repo owner), per GitHub notification settings: Settings > Notifications > Actions >
"Notify me for failed workflows only". The run page (Actions > Site monitor) has a table of every check.

## Run it by hand

    node scripts/monitor.mjs          # local
    gh workflow run site-monitor.yml  # on GitHub

## Silence / change it

- Pause: `gh workflow disable site-monitor.yml` (re-enable with `gh workflow enable site-monitor.yml`)
- Drop one check: edit `SITES` / `inner` in `scripts/monitor.mjs`
- A redesign changes an H1: update that site's `h1` value (whitespace is ignored when comparing)
- GitHub disables scheduled workflows after 60 days with no repo activity; re-enable from the Actions tab
