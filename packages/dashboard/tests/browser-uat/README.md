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
dashboard is configured with `allowPrivateScanTargets: true`.

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
