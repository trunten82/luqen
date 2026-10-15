# Live UAT harness

Read-only-by-default sweeps for a RUNNING Luqen dashboard (run ON the host,
against `http://localhost:5000`). Built during the 2026-07-14 full-capability
UAT which surfaced 11 production bugs the unit suites missed.

- **uat-sweep.mjs** `<user> <pass> [label]` — logs in, BFS-crawls every
  internal link + per-scan surfaces (`SCAN_IDS=a,b,...` env), flags 5xx,
  denied-linked-pages (the "sidebar shows it but the route rejects it" class),
  and error signatures in 200 HTML (Missing helper, raw i18n ids, stack traces).
  Run once per persona (admin + one user per org role).

- **uat-openapi-sweep.mjs** `<user> <pass> <fixtures.json> [--mutate]` —
  executes EVERY operation in docs/reference/openapi/dashboard.json with real
  entity ids (fixtures) and schema-built bodies. GETs by default; `--mutate`
  adds POST/PATCH/DELETE against UAT-prefixed artifacts only. Classifies:
  5xx = FAIL, real-id GET 404 = WARN, schema-body 400 = WARN.

- **uat-helper.sh** — sourceable curl helpers (cookie jar + CSRF) for driving
  individual flows by hand. NOTE: pass JSON bodies via --data-binary @file —
  inline JSON through ssh quoting mangles quotes.

- **uat-graphql-createscan.mjs** `[--preflight | --selftest]` — read-back of
  GraphQL `createScan` against a RUNNING dashboard (also reachable remotely),
  configured by environment variables only: `LUQEN_UAT_BASE_URL`,
  `LUQEN_UAT_ADMIN_USER`, `LUQEN_UAT_ADMIN_PASS` (required; the script names
  any missing one and exits 2; `LUQEN_UAT_BASE_URL` must be `https://`, or the
  script exits 2 without sending anything, except a loopback `http://` URL with
  an explicit port for a local rehearsal), `LUQEN_UAT_ORG_NAME` (default `Fabrikam UAT`),
  `LUQEN_UAT_SCAN_TARGET` (default `https://example.com`),
  `LUQEN_UAT_PRIVATE_PROBE` (`on`/`off`), `LUQEN_UAT_SCHEDULE_PROBE` (`on`/`off`),
  and the timing knobs
  `LUQEN_UAT_LEAVE_QUEUED_S`, `LUQEN_UAT_TERMINAL_S`, `LUQEN_UAT_POLL_MS`.
  Full mode logs in, finds the UAT org by name, switches to it and asserts it
  by name AND id (no GraphQL call is made before that), checks that a loopback
  target is refused through GraphQL, checks that a loopback start URL posted
  to `POST /schedules` is refused with the shared private-target text and
  creates no schedule (a schedule the server accepted is deleted again and
  read back as absent, and the run stops before creating a scan), creates one
  scan, watches it leave
  `queued` and reach `completed`/`failed`, then deletes it in a finally block
  and reads it back as null. `--preflight` stops after the org assertion and
  never calls `/graphql`. `--selftest` drives the same code against an
  in-process fake server in fifteen worlds and greps the output for sentinel
  values. Output is check names, status words and elapsed seconds only.
  **Run full mode against production only after the fix is deployed and the
  Deploy run succeeded; never before** (operators should confirm no queued
  scans first). `--preflight` and `--selftest` are always safe; `--preflight`
  never posts a schedule.

Ground rules learned: login rate-limit is 10/15min (reuse jars, don't relogin
per probe); deploys restart the service and kill sessions mid-sweep; permission
probes need one persona PER org role, sidebar visibility ≠ route access.
