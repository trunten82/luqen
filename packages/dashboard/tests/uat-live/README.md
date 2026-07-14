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

Ground rules learned: login rate-limit is 10/15min (reuse jars, don't relogin
per probe); deploys restart the service and kill sessions mid-sweep; permission
probes need one persona PER org role, sidebar visibility ≠ route access.
