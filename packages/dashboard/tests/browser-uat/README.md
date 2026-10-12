# Browser UAT — Deep behavioral scan (beta)

A real-browser, end-to-end UAT that proves two things together:

1. **FIX 2** — the "Deep behavioral scan" checkbox (`#behavioral-cb`) is surfaced
   on the New Scan page **outside** the collapsed *Scan Options* `<details>`
   accordion, so it is visible and clickable without expanding anything.
2. The behavioral scan engine actually runs against a loopback fixture and
   produces the keyboard-trap finding, which flows through to the report and the
   VPAT.

It also exercises **FIX 1** — the `allowPrivateScanTargets` SSRF escape hatch —
because the fixture is served on `127.0.0.1` and the scan only succeeds when the
dashboard is configured with `allowPrivateScanTargets: true`. The same flag also
opts discovery (robots.txt, sitemaps, crawl, redirects, browser fallback) out of
the core SSRF guard; without it, discovery refuses every loopback request.

## Run it

```bash
node packages/dashboard/tests/browser-uat/run.mjs
```

The orchestrator (`run.mjs`):

1. Builds `@luqen/dashboard` (skip with `UAT_SKIP_BUILD=1`).
2. Resets an isolated `.tmp/` workspace (DB, reports, plugins) — nothing touches
   the real `dashboard.db`.
3. Starts `node dist/cli.js serve` with:
   - `PUPPETEER_EXECUTABLE_PATH` pointing at the auto-discovered ms-playwright
     Chromium, so the scan engine can launch a browser;
   - `DASHBOARD_ALLOW_PRIVATE_SCAN_TARGETS=true` and an isolated config so the
     loopback fixture is reachable;
   - a dedicated port (`5071` by default, see `uat.config.json`).
4. Waits for `GET /login`, then seeds a fresh admin user + org (`seed.mjs`).
5. Starts the loopback behavioral fixture (`fixture-server.mjs`).
6. Runs the puppeteer-core driver (`driver.mjs`), which asserts every step and
   exits non-zero on the first failure.
7. Tears down all child processes and propagates the driver's exit code.

Exit code `0` == all assertions GREEN.

## Driver assertions

1. Login works.
2. `#behavioral-cb` is present, **not** a descendant of a closed `<details>`,
   and visible/clickable without expanding anything (FIX 2 regression guard).
3. After ticking it and scanning the loopback fixture, the scan completes with
   `pages_scanned > 0`.
4. The report / issues API contains a `Luqen.Behavioral.…2_1_2.KeyboardTrap`
   code.
5. The VPAT shows criterion 2.1.2 == *Does Not Support* and 2.1.1 ==
   *Not Evaluated*.

## Dependencies

- **puppeteer-core** is **not** a direct dependency of `@luqen/dashboard`. The
  driver resolves it transitively from `pa11y`'s nested copy
  (`node_modules/pa11y/node_modules/puppeteer-core`), which the dashboard already
  depends on. No extra install is required.
- **better-sqlite3** and **bcrypt** are resolved from the monorepo root
  `node_modules` for seeding.
- **Chromium** is auto-discovered via
  `/root/.cache/ms-playwright/chromium-*/chrome-linux64/chrome` (or override with
  `PUPPETEER_EXECUTABLE_PATH`).

## Artifacts

Everything the run produces lands in `.tmp/` (git-ignored): `dashboard.log`,
`fixture.log`, `uat-dashboard.db`, `evidence.json`, `scan-api.json`,
`issues-api.json`, `report-text.txt`, `vpat-text.txt`, and the three evidence
screenshots `01-newscan-ticked.png`, `02-report-behavioral.png`,
`03-vpat-212.png`.

## Dismissal UI UAT (`uat-dismissals.mjs`, Phase 89)

A real-browser UAT of the false-positive dismissal UI (mark dialog, Dismissed section, revoke dialog,
toast), written against the UI-SPEC "Browser UAT Contract". It lives next to `run.mjs` but is
self-contained: the entry point is `uat-dismissals.mjs`, the helpers are in `dismissals/`.

```bash
cd packages/dashboard && npm run build        # the script runs dist/, so build first
node tests/browser-uat/uat-dismissals.mjs [--mode local|remote|remote-selftest]
     [--expect dark|granted] [--scenario <name>|all] [--leave-active]
```

Output is one `PASS <scenario>: <check>` or `FAIL <scenario>: <check> :: <detail>` line per check and a
final `UAT GREEN: <n> checks`. It stops at the first FAIL (exit 1); bad arguments or a missing remote
environment exit 2. Browser waits are 90 s.

### Modes

| Mode | What it does |
|------|--------------|
| `local` (default) | Per scenario: boots a fresh-DB dashboard from `dist/` on the `uat.config.json` port, seeds a Fabrikam test org, five personas, a four-page scan and a site with 150 dismissals, then drives Chromium. Each scenario gets its own world (they mark and revoke real data). |
| `remote` | Drives an already-running dashboard from environment variables only. Never seeds. Never prints a value (check output carries names only, details are withheld, no screenshots are written, and every credential value is redacted from the process output; a leak fails the run). Writes one mark, one revoke and, with `--leave-active`, one re-mark of the same finding. Persona write probes use a refused selector, so a missing 403 shows up as a FAIL and never as a stray row. |
| `remote-selftest` | Boots and seeds exactly like `local`, then runs the remote code path against that server with an in-process env object (no files). This is how the remote path is proven without production. |

### `--expect`

`dark` (default): only global admins hold `issues.dismiss`. An org Owner sees no Dismiss control, gets 403
from a direct mark, preview and revoke request, and `/admin/roles/new` offers no `issues.dismiss`; a
`reports.view`-only user sees the Dismissed section with no Revoke button and no Element column.
`granted`: the Owner sees the control and can mark; Member and Viewer see none and get 403. A local
`granted` run needs a build that has the grant (Phase 89 Plan 09).

### Local scenarios (`--scenario`)

`tracer`, `permissions`, `dialog`, `refused`, `mark`, `surfaces`, `revoke`, `conflict`, `public`, `mobile`
(375x812), `longtext` (1000-char reason, 600-char selector, 1000-char comment at 375 and 1280),
`locales` (de, it), `theme` (dark), `keyboard` (real key presses, real Escape), `overflow` (150 rows).
`all` runs them in that order.

### Remote environment variables

Names only; values are never printed and must never be committed. All ten are required or the script
exits 2 naming the missing ones.

```
LUQEN_UAT_BASE_URL   LUQEN_UAT_SCAN_ID
LUQEN_UAT_ADMIN_USER LUQEN_UAT_ADMIN_PASS
LUQEN_UAT_OWNER_USER LUQEN_UAT_OWNER_PASS
LUQEN_UAT_MEMBER_USER LUQEN_UAT_MEMBER_PASS
LUQEN_UAT_VIEWER_USER LUQEN_UAT_VIEWER_PASS
```

### Artifacts

Everything the local modes write lands in `.tmp/` (git-ignored by `.tmp/.gitignore`): `dashboard.log`, the
database, and the screenshots under `.tmp/shots/`. The login rate limit is 10 per 15 minutes per IP; each
scenario logs each persona in once.
