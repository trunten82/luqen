[Docs](../README.md) > [Guides](../README.md#how-to-guides) > Security Administration Guide

# Security Administration Guide

How to configure, manage, and audit security for Luqen dashboard deployments.

---

## Authentication modes

Luqen supports three progressive authentication modes. The active mode is determined automatically based on the system state:

| Mode | Triggered when | Login methods | Suitable for |
|------|---------------|---------------|-------------|
| **Solo** | No dashboard users exist | API key only | Single developer, local dev |
| **Team** | 1+ dashboard users created | Password + API key fallback | Small teams |
| **Enterprise** | SSO auth plugin active | SSO + password + API key fallback | Organisations with IdP |

**API key login is always available** in all modes as a fallback. In team and enterprise mode, it appears under a collapsible section on the login page. API key login always grants admin-level access.

---

## Permission model

Luqen uses a **database-driven RBAC** (Role-Based Access Control) model. Permissions are assigned to roles, and roles are assigned to users. All route guards and UI elements check `perm.*` flags — never hardcoded role names.

### Permission matrix

| Group | Permission | Description |
|-------|-----------|-------------|
| **Scans** | `scans.create` | Create and run accessibility scans |
| | `scans.schedule` | Create, edit, and delete scan schedules |
| **Reports** | `reports.view` | View scan reports |
| | `reports.view_technical` | View selectors, DOM context, and technical details |
| | `reports.export` | Export reports as CSV and PDF |
| | `reports.delete` | Delete scan reports |
| | `reports.compare` | Compare two scan reports side by side |
| **Issues** | `issues.assign` | Assign issues to team members |
| | `issues.fix` | View and propose code fixes |
| **Testing** | `manual_testing` | Run manual testing checklists |
| **Repositories** | `repos.manage` | Connect and manage source code repositories |
| **Analytics** | `trends.view` | View trend charts and analytics dashboards |
| **User Management** | `users.create` | Create new dashboard user accounts |
| | `users.delete` | Permanently delete user accounts |
| | `users.activate` | Activate and deactivate user accounts |
| | `users.reset_password` | Reset passwords for other users |
| | `users.roles` | Change user role assignments |
| **Administration** | `admin.users` | Manage compliance service API users |
| | `admin.roles` | Create, edit, and delete roles |
| | `admin.system` | System settings, plugins, webhooks, OAuth clients, organisations |

### Default roles

| Role | Permissions | Use case |
|------|------------|---------|
| **admin** | All 20 permissions | System administrators |
| **developer** | Scans, reports (incl. technical), issues, fixes, repos, trends, manual testing | Developers fixing accessibility issues |
| **user** | Scans, schedules, reports, issues, manual testing, trends | QA testers and content editors |
| **executive** | Reports (view + export), trends | Management and stakeholders |

### Custom roles

Admins can create custom roles at **Admin > Roles** with any combination of the 20 available permissions. Common examples:

| Custom role | Suggested permissions | Use case |
|-------------|----------------------|----------|
| **Team Lead** | `users.activate`, `users.reset_password`, `issues.assign`, `reports.view`, `trends.view` | Manage team members and assignments |
| **QA Tester** | `scans.create`, `reports.view`, `manual_testing`, `issues.assign` | Testing without admin access |
| **Auditor** | `reports.view`, `reports.export`, `trends.view` | Read-only compliance auditing |
| **Plugin Manager** | `admin.system` | Install and configure plugins only |

---

## Principle of least privilege

Follow these guidelines when assigning roles:

1. **Start with the most restrictive role** — assign `executive` or a custom read-only role by default
2. **Escalate only when needed** — grant `user` or `developer` permissions only to people who need to create scans or view technical details
3. **Limit admin access** — only grant `admin` to people who need to manage the system itself
4. **Use custom roles for delegation** — instead of granting full admin, create a "Team Lead" role with only `users.activate` and `users.reset_password`
5. **Review roles quarterly** — audit who has what access and remove unnecessary permissions
6. **Deactivate, don't delete** — when someone leaves a project, deactivate their account first. Delete only after confirming no active assignments need transfer.

---

## API key management

### First-start key

On first startup with a fresh database, Luqen generates a master API key and prints it to the server log once:

```
========================================
  LUQEN DASHBOARD — First Start
  API Key: <64-character hex string>
  Save this key — it will not be shown again.
========================================
```

**Store this key securely.** It is hashed (SHA-256) in the database and cannot be recovered.

### Key rotation

1. Navigate to **Admin > API Keys**
2. Create a new key with a descriptive label (e.g., "CI pipeline 2026-Q2")
3. Update all systems that use the old key
4. Deactivate the old key
5. After confirming nothing breaks, delete the old key

### Key security checklist

- [ ] API keys are stored in environment variables or a secrets manager — never in source code
- [ ] Keys are rotated at least quarterly
- [ ] Unused keys are deactivated and deleted
- [ ] Each integration (CI/CD, Power BI, monitoring) has its own key with a descriptive label
- [ ] Keys are never shared between environments (dev, staging, production)
- [ ] Server logs containing the first-start key are secured or purged

---

## Encryption and secrets

### Per-installation encryption salt

Each dashboard installation generates a unique 32-byte random salt on first startup, stored in the `dashboard_settings` database table. This salt is combined with `DASHBOARD_ENCRYPTION_KEY` (the at-rest encryption key — see [Rotating the session secret and the at-rest encryption key](#rotating-the-session-secret-and-the-at-rest-encryption-key) below) when encrypting plugin configuration secrets and the other at-rest stores (AES-256-GCM). Even if two installations share the same encryption key, their encrypted data cannot be decrypted by the other installation.

### Plugin configuration security

Plugin configuration secrets (API keys, OAuth client secrets, SMTP passwords) are encrypted with **AES-256-GCM** using a key derived from the dashboard's `DASHBOARD_ENCRYPTION_KEY` (which defaults to `DASHBOARD_SESSION_SECRET` when unset — see the rotation runbook below) combined with the per-installation encryption salt. Secret values are masked in the UI and API responses.

**Org isolation:** Plugin configurations are scoped per organisation. Org admins can only view and modify their own org's plugin settings — they cannot see configuration values belonging to other organisations. Global admins can see which organisations have activated each plugin and view activation status, but org-specific secret values remain encrypted and masked.

**Config inheritance:** Org-specific configurations inherit from global defaults. Only values explicitly overridden by the org admin are stored separately. This means sensitive global defaults (e.g., a shared SMTP host) are inherited without being exposed to org admins as editable secret fields.

### SSRF protection

Scan start URLs are validated before a scan is created — on the scan form,
the REST/GraphQL `createScan` paths, and the agent `dashboard_scan_page` MCP
tool. The check uses the same `@luqen/core` predicate as discovery (below):
the hostname is refused when it is a private or reserved literal in any
spelling, AND when it **resolves** (DNS, all A/AAAA records) to any private
address — so a public name pointed at `127.0.0.1` or a LAN address is refused
before pa11y ever loads it. A start URL whose host does not resolve is refused
with "Domain not found". Refused ranges:

- RFC 1918 private addresses (10.x, 172.16-31.x, 192.168.x)
- Loopback (127.x, `::1`) and `0.0.0.0/8`
- Link-local (169.254.x, including the `169.254.169.254` metadata address; `fe80::/10`)
- CGNAT `100.64.0.0/10`, IPv6 unique-local `fc00::/7`
- IPv4-mapped / NAT64 / 6to4 forms of any of those, multicast and other reserved ranges

Residual, same as discovery: the check resolves the name, then the scanner's
browser resolves it again, so a DNS-rebinding host with a near-zero TTL can
still win that race.

**Discovery is guarded too.** Validating the start URL is not enough on its
own: a public site controls its `robots.txt`, its sitemaps and its redirects.
Every request discovery makes — `robots.txt`, each `Sitemap:` directive, each
sitemap-index child, each crawled page, incremental-scan content hashing,
every HTTP redirect hop (followed manually, at most 5, each re-checked), and
every request the headless-browser discovery fallback issues — is checked
against the hostname AND every address it resolves to. Refused: loopback,
RFC 1918, link-local incl. `169.254.169.254`, CGNAT `100.64.0.0/10`,
`0.0.0.0/8`, multicast/reserved, IPv6 `::1` / `fc00::/7` / `fe80::/10`,
IPv4-mapped / NAT64 / 6to4 forms of any of those, and decimal / hex / octal
IPv4 spellings. A name that cannot be resolved is refused. A refused request
degrades like an unreachable one (no sitemap, page skipped); it never fails
the scan. Residual: the guard resolves the name, then the HTTP client
resolves it again, so a DNS-rebinding host with a near-zero TTL can still win
that race.

**Page loads by the scan engines are guarded too.** After discovery, each
engine loads every page in a real headless Chromium, and a page controls its
own redirects and subresources. Every engine installs request interception on
its page BEFORE navigating and applies the same check to every request the
page makes — the navigation, each redirect hop, images, stylesheets, scripts,
frames, `fetch`/XHR, beacons and dedicated-worker fetches. A refused request
is aborted (`net::ERR_BLOCKED_BY_CLIENT`); the rest of the page still loads
and is scanned. A refused top-level redirect means that page yields no
results (it is not an error for the scan as a whole). Covered engines and how:

| Engine | Guard seam |
|--------|------------|
| pa11y (htmlcs / axe runners) — `DirectScanner` | Luqen launches Chromium, guards the page, passes both via pa11y's documented `browser` + `page` options. pa11y's own `headers` interceptor is not used (it resolves requests synchronously and would pre-empt the guard); custom headers are applied to the first request only, as pa11y did. |
| Behavioral (keyboard, dynamic state, vision capture) | Guard on the page before `goto`. |
| Accessibility tree | Guard on the page before `goto`. |
| Reflow / zoom 400% | Guard on the page before `goto`. |
| IBM Equal Access | Guard on the page Luqen hands `getCompliance`. |
| Lighthouse | Puppeteer attaches to the chrome-launcher instance, guards a page, and passes it as Lighthouse's documented `page` argument. |
| Browser discovery fallback | Unchanged (the same guard, now in `@luqen/core`'s `net/browser-request-guard`). |

Not covered, by design or by measurement:

- **WebSockets.** Chromium does not surface `ws:`/`wss:` handshakes to request
  interception, so a scanned page can still open a WebSocket to an internal
  address (measured: the handshake reached a loopback server while every
  other request type was refused). Closing it needs a network-level control
  (an egress proxy or firewall rule for the scanner host), not a browser hook.
- **DNS rebinding** — the same resolve-then-connect race as discovery.
- **The legacy pa11y webservice backend** (`webserviceUrl`) loads pages in its
  own remote process; its page loads are outside this guard.
- **The axe scanner plugin** (`@luqen/plugin-scanner-axe`, installed
  separately at runtime; its source is not in this repository) is not called
  by any scan path in this release — the dashboard has no caller of a scanner
  plugin's `evaluate` hook. If it is ever wired into scans, its page loads
  must go through the same guard (`guardPageRequests` in `@luqen/core`).

**Opt-out for trusted test environments.** `allowPrivateScanTargets: true` in
`dashboard.config.json` (or `DASHBOARD_ALLOW_PRIVATE_SCAN_TARGETS=true`)
disables the start-URL check, the discovery guard AND the engine page-load
guard. It exists for the
loopback UAT harness (`packages/dashboard/tests/browser-uat`); never enable it
on a server reachable by untrusted users.

---

## Session security

| Setting | Value | Purpose |
|---------|-------|---------|
| `DASHBOARD_SESSION_SECRET` | Min 32 bytes | Encrypts session cookies (AES-256-GCM) |
| `DASHBOARD_ENCRYPTION_KEY` | Min 32 bytes; defaults to `DASHBOARD_SESSION_SECRET` when unset | At-rest AES key for OAuth signing keys, service-connection secrets, git credentials, and plugin secrets — independent of the session secret so one can rotate without the other. See [Rotating the session secret and the at-rest encryption key](#rotating-the-session-secret-and-the-at-rest-encryption-key) below. |
| Session storage | Encrypted cookie (`@fastify/secure-session`) | No client-readable session data |
| Cookie flags | `httpOnly`, `SameSite=Strict` | Prevents XSS and CSRF via cookie theft |
| Encryption salt | Per-installation random 32 bytes | Unique encryption per deployment |
| Boot ID | UUID per database instance | Invalidates sessions when the DB is reset |
| Login rate limit | 5 attempts / 15 minutes | Prevents brute-force attacks |
| Global rate limiting | Per-endpoint limits on all state-changing routes | Prevents abuse of scan, schedule, and admin endpoints |
| CSRF protection | `@fastify/csrf-protection` | Prevents cross-site request forgery |

### Session secret best practices

- Generate with `openssl rand -base64 32` — never use a predictable value
- Store in environment variables, not config files checked into source control
- Rotate when staff with access leave the project
- Use different secrets per environment

---

## Rotating the session secret and the at-rest encryption key

**Audience: an agent operator on the dashboard host.** This section is written to be executed
cold, from the document alone. Read these conventions before running anything:

- **Run as root**, on the host that runs the dashboard's systemd unit. Docker/Kubernetes
  deployments (secrets in a compose `.env` or a Kubernetes Secret) are **not covered** by these
  literal commands — STOP and escalate if the dashboard is not a systemd unit.
- **Each fenced block is ONE shell invocation.** Blocks share nothing except files in the work
  directory `W=/root/luqen-rotation` (mode 0700). Shell variables do not survive between blocks,
  so every block re-reads `$W/vars` and `$W/vars.effective`. Every block runs inside `( ... )` so
  nothing — least of all a secret — is left exported in the operator's shell.
- **No secret value is ever printed, and no secret value is ever placed in a process's argv.**
  Secret values live only in 0600 files inside `$W`; commands receive them through environment
  variables set for that one command (`NAME="$(cat file)" command ...`), never as arguments.
  Checks compare values inside the helper script and print only `ok`/`FAIL`, lengths and counts.
- **Never `source` or `.` a systemd unit file or an EnvironmentFile** — a unit file is not shell,
  and sourcing it would execute `ExecStart=`. Only `$W/vars` and `$W/vars.effective` (written by
  this runbook, paths and port only) are ever sourced.
- **Every file edit is atomic:** temp file in the SAME directory as the target → fsync → rename →
  fsync the directory, preserving the target's mode and owner. The helper script below does this;
  do not edit these files with `sed -i`, `>>` or an editor.
- **STOP means STOP:** do not continue to the next step, do not improvise a fix. If the unit is
  already stopped at that point, follow [Rollback](#rollback); otherwise escalate with the output.
- **What was rehearsed:** every block that edits, backs up, restores or compares files, the
  helper script, every `rekey-at-rest` invocation (dry-run, apply, rollback) and every `curl`
  check was rehearsed against a throwaway fixture — a fake unit with inline `Environment=` lines,
  a drop-in, an EnvironmentFile and a `dashboard.config.json` holding dummy secrets — with a real
  dashboard process built from this repository. **`systemctl` and `journalctl` could not be
  rehearsed** there; their output formats were taken from systemd 257 on a probe unit, and two
  behaviours were measured on systemd 257 with probe units: the `NRestarts` reset (see
  [Verification window](#verification-window)) and EnvironmentFile-over-`Environment=` precedence.
  Guards watched FAILING in the rehearsal: a stray copy of an old value in a comment → `VERIFY:
  FAIL` on exactly that line; an unsupported line form → `set` refused, no file changed; the
  database left un-re-keyed under a new key → V1 `STOP` (the dashboard never came up); the
  process killed mid-window → V4 `STOP` after 16 s; a tampered stored ciphertext → V3's
  service-connections check `500` while `/health` still said `ok`; `--apply` with the dashboard
  running → exit 3.

**Background:** on 2026-09-28, rotating `DASHBOARD_SESSION_SECRET` alone crash-looped a live
dashboard for 48 seconds with `Failed to start server: Unsupported state or unable to
authenticate data`, because the session secret doubled as the AES key for four at-rest stores.
That coupling is gone — but only once `DASHBOARD_ENCRYPTION_KEY` is **pinned** to its own value
([Procedure P](#procedure-p--pin-dashboard_encryption_key-precondition-for-a-b-and-c)) before the
session secret is rotated.

### What each secret protects

| Secret | Protects | Rotation consequence |
|--------|----------|----------------------|
| `DASHBOARD_SESSION_SECRET` / config `sessionSecret` | Session cookies (`@fastify/secure-session`) | Every logged-in user is logged out. Nothing else. |
| `DASHBOARD_ENCRYPTION_KEY` / config `encryptionKey` | The four at-rest stores, named as `rekey-at-rest` prints them: `oauth-signing-keys` (`oauth_signing_keys.encrypted_private_key_pem`), `service-connections` (`service_connections.client_secret_encrypted`), `git-credentials` (`developer_credentials.encrypted_token`), `plugin-configs` (`plugins.config` secret fields) | Existing encrypted values become unreadable UNLESS re-keyed first with `rekey-at-rest --apply` (Procedure B/C). This is the crash this runbook exists to prevent. |
| `UNSUBSCRIBE_SECRET` | Outstanding unsubscribe links already sent to recipients | Rotating it invalidates every unsubscribe link already in an inbox. It is NOT tied to either dashboard key (by design — F-1: if `UNSUBSCRIBE_SECRET` and `SESSION_SECRET` are both unset, the installer's `DASHBOARD_SESSION_SECRET`-only env does not satisfy it, and minting an unsubscribe link throws; this is a reported, unfixed finding, not addressed by any procedure below). |
| The installation salt (`dashboard_settings.encryption_salt`) | Combined with the encryption key to derive the actual AES key | **Never rotate by hand.** It is generated once, automatically, on first start, and every at-rest value is tied to it. There is no supported salt-rotation procedure. |

**Every restart logs every user out, whatever you rotate.** `server.ts` registers the session
plugin without a database handle, so the session salt is regenerated on each process start
(`auth/session.ts`: the persistent-salt path is used only when a DB handle is passed). Measured in
the rehearsal: a session cookie that worked before a restart with an unchanged session secret was
redirected to `/login` after it. So Procedures P and B log users out too — announce all four.

### Deployment shapes — where each secret can live

The dashboard reads its secrets from up to three places, with this precedence
(`packages/dashboard/src/config.ts`, `applyEnvOverrides` and `withEncryptionKeyDefault`):

| Effective value | Rule |
|-----------------|------|
| session secret | env `DASHBOARD_SESSION_SECRET` if it is **defined at all** (even empty — an empty value then fails startup validation), otherwise config `sessionSecret`. |
| encryption key | env `DASHBOARD_ENCRYPTION_KEY` if **non-empty**; an EMPTY env value counts as unset. Then config `encryptionKey`. If neither is set, it **defaults to the effective session secret** — that state is called *unpinned* below. |

The process environment itself is assembled by systemd from:

1. **Inline `Environment=KEY=value` lines** in the unit file and its drop-ins
   (`/etc/systemd/system/<unit>.d/*.conf`). The installer's unit carries no secrets inline, but a
   hand-maintained unit may (`Environment=DASHBOARD_SESSION_SECRET=...`).
2. **`EnvironmentFile=` files** (`KEY=value` lines). A variable set in an EnvironmentFile
   overrides the same variable set with `Environment=` (measured on systemd 257 with a probe
   unit that set both).
3. **`dashboard.config.json`** (the file named by `--config` in `ExecStart=`). The installer writes
   `sessionSecret` here; `encryptionKey` may also be here.

A host can combine all three, and the SAME secret may be defined in more than one of them (for
example `DASHBOARD_SESSION_SECRET` inline in the unit AND `sessionSecret` in the config file).
**Every procedure below updates every location that defines a secret, and then proves by
comparison that the old value remains nowhere and the new value is present everywhere expected.**
Updating only the location that currently "wins" leaves a stale copy that silently becomes
effective the day someone removes the winner.

**Recommended end state (not scripted here):** both secrets in ONE 0600 `EnvironmentFile`
(for example `/etc/luqen/dashboard.env`), and none inline in the unit or in the config file.
Reasoned, not measured on the target host: unit files are normally mode 0644, and inline
`Environment=` values are exposed to any local user through `systemctl show`. Migrate as its own
change, in its own window — never in the middle of a rotation. The helper below only edits
definitions that already exist (plus the one addition Procedure P makes).

The locations this runbook does NOT edit — STOP if the inventory (S4) points at any of them:
the systemd manager environment (`systemctl show-environment`), `PassEnvironment=`, a wrapper
script in `ExecStart=`, docker/compose `.env`, Kubernetes Secrets.

### Setup (run before every procedure)

Every procedure starts with S1–S5 on a fresh `$W`, and ends with [Cleanup](#cleanup). Run
Procedure P and Procedure A as two separate runs (cleanup between them).

**S1 — Identify the unit and the install (non-secret facts only).** Set `UNIT` to the real unit
name (the installer's is `luqen-dashboard.service`). Only the `path=` and `--config` fields of
`ExecStart=` are extracted; the rest of the command line is never printed.

```bash
( set -eu
  UNIT=luqen-dashboard.service
  W=/root/luqen-rotation
  test ! -e "$W" || { echo "STOP: $W already exists — a previous run was not cleaned up"; exit 1; }
  install -d -m 700 "$W"
  X=$(systemctl show -p ExecStart --value "$UNIT")
  NODE=$(printf '%s\n' "$X" | sed -n 's/.*path=\([^ ;]*\).*/\1/p')
  INSTALL_DIR=$(printf '%s\n' "$X" | sed -n 's#.* \([^ ]*\)/packages/dashboard/dist/cli\.js .*#\1#p')
  CONFIG=$(printf '%s\n' "$X" | sed -n 's/.*--config \([^ ;]*\).*/\1/p')
  ( umask 077; printf "UNIT='%s'\nNODE='%s'\nINSTALL_DIR='%s'\nCONFIG='%s'\n" "$UNIT" "$NODE" "$INSTALL_DIR" "$CONFIG" > "$W/vars" )
  cat "$W/vars"
  for v in NODE INSTALL_DIR CONFIG; do eval "test -n \"\$$v\"" || echo "STOP: $v is empty"; done
  case "$CONFIG" in /*) ;; *) echo "STOP: CONFIG is not an absolute path" ;; esac )
```
Expected output: four lines `UNIT='…'`, `NODE='/…/node'`, `INSTALL_DIR='/…'`,
`CONFIG='/…/dashboard.config.json'`, and no `STOP` line. **STOP** if any `STOP` line prints
(an `ExecStart=` that runs a wrapper script, or `-c`/a relative config path, is not covered).
Every STOP before S5 leaves `$W` holding no secret: `rm -rf /root/luqen-rotation` before a retry.

**S2 — Preconditions.**

```bash
( W=/root/luqen-rotation; . "$W/vars"
  systemctl show -p ActiveState -p NeedDaemonReload -p User "$UNIT"
  echo "manager-environment DASHBOARD_ names: $(systemctl show-environment | cut -d= -f1 | grep -c '^DASHBOARD_')"
  echo "rekey command present: $("$NODE" "$INSTALL_DIR/packages/dashboard/dist/cli.js" rekey-at-rest --help | grep -c -- '--old-key-env')"
  for t in openssl curl journalctl sha256sum timeout; do command -v "$t" >/dev/null || echo "STOP: $t missing"; done )
```
Expected output:
```
ActiveState=active
NeedDaemonReload=no
User=root
manager-environment DASHBOARD_ names: 0
rekey command present: 1
```
`systemctl show` prints properties in its own order, not the order of the `-p` flags.
`User=` may also be empty (systemd's default, root). **STOP** if: `ActiveState` is not `active`
(the old values are read from the running process in S5); `NeedDaemonReload=yes` (the unit file
on disk differs from what is loaded — someone has an unfinished edit); `User=` is anything other
than `root`/empty (`rekey-at-rest` runs as root and would leave root-owned database files a
non-root unit cannot open); the manager-environment count is not 0; `rekey command present` is
`0` (the deployed build predates `rekey-at-rest` — deploy the current build first); any tool is
missing. Note: the CLI is NOT on `PATH` as `luqen-dashboard`; it is always invoked as
`"$NODE" "$INSTALL_DIR/packages/dashboard/dist/cli.js"`.

**S3 — Install the helper script.** It is the only code in this runbook that touches secret
values. Copy the block exactly.

```bash
( W=/root/luqen-rotation
  ( umask 077; cat > "$W/rotate-helper.mjs" <<'HELPER_EOF'
// rotate-helper.mjs — secret-location helper for the Luqen dashboard rotation runbook.
// Never prints a secret value. Secret values are read from 0600 FILES whose PATHS are
// passed as arguments; no value ever appears in argv. Every file edit is: temp file in the
// SAME directory -> fsync -> rename -> fsync(dir), preserving the original mode and owner.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SESSION = 'DASHBOARD_SESSION_SECRET';
const KEY = 'DASHBOARD_ENCRYPTION_KEY';
const JSON_KEY = { [SESSION]: 'sessionSecret', [KEY]: 'encryptionKey' };
const SAFE_VALUE = /^[A-Za-z0-9+/=]{32,}$/;
const die = (code, msg) => { console.log(`STOP: ${msg}`); process.exit(code); };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// JSON.parse error messages quote a snippet of the input, which could be part of a secret:
// never let one reach the output.
const parseJson = (text, file) => { try { return JSON.parse(text); } catch { return die(20, `${file} is not valid JSON (details suppressed: they could quote a secret)`); } };

function readValue(file) {
  const st = fs.statSync(file);
  if ((st.mode & 0o077) !== 0) die(10, `${file} is not mode 0600`);
  const v = fs.readFileSync(file, 'utf8').replace(/\n$/, '');
  if (v.includes('\n')) die(10, `${file} holds more than one line`);
  return v;
}
function readLocations(W) {
  return fs.readFileSync(path.join(W, 'locations'), 'utf8').split('\n').filter(Boolean).map((l) => {
    const [kind, file] = l.split('\t');
    if (!['unit', 'envfile', 'json'].includes(kind) || !path.isAbsolute(file ?? '')) die(11, `bad locations line: ${l}`);
    return { kind, file };
  });
}
function fsyncPath(p) { const fd = fs.openSync(p, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function atomicWrite(file, content, mode, uid, gid) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.rotate-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try {
    fs.chownSync(tmp, uid, gid);
    fs.chmodSync(tmp, mode & 0o7777);
    fs.renameSync(tmp, file);
  } catch (err) { try { fs.unlinkSync(tmp); } catch { /* already gone */ } throw err; }
  fsyncPath(dir);
}

// Line-based definition parsing for systemd unit files and EnvironmentFile files.
function lineForms(kind, name) {
  const n = esc(name);
  if (kind === 'unit') {
    return {
      forms: [
        new RegExp(`^(\\s*Environment=)${n}=([^\\s"]*)(\\s*)$`),
        new RegExp(`^(\\s*Environment=")${n}=([^"]*)("\\s*)$`),
      ],
      mention: new RegExp(`^\\s*Environment=.*(?:=|\\s|")${n}=`),
    };
  }
  return {
    forms: [
      new RegExp(`^(\\s*)${n}=([^\\s"'#]*)(\\s*)$`),
      new RegExp(`^(\\s*)${n}="([^"\\\\]*)("\\s*)$`),
      new RegExp(`^(\\s*)${n}='([^']*)('\\s*)$`),
    ],
    mention: new RegExp(`^\\s*(?:export\\s+)?${n}\\s*=`),
  };
}
function parseDefs(kind, text, name) {
  if (kind === 'json') {
    const obj = parseJson(text, 'a config file');
    const k = JSON_KEY[name];
    if (!(k in obj)) return { defs: [], unsupported: 0 };
    if (typeof obj[k] !== 'string') return { defs: [], unsupported: 1 };
    return { defs: [{ value: obj[k] }], unsupported: 0 };
  }
  const { forms, mention } = lineForms(kind, name);
  const defs = []; let unsupported = 0;
  text.split('\n').forEach((line, idx) => {
    if (/^\s*[#;]/.test(line)) return;
    for (const re of forms) {
      const m = re.exec(line);
      if (m) { defs.push({ idx, prefix: m[1], value: m[2], suffix: m[3] }); return; }
    }
    if (mention.test(line)) unsupported++;
  });
  return { defs, unsupported };
}
function describe(v) { return v === '' ? 'EMPTY' : `set, length ${v.length}${v.length < 32 ? ' (TOO SHORT)' : ''}`; }

function cmdInventory(W) {
  for (const { kind, file } of readLocations(W)) {
    const text = fs.readFileSync(file, 'utf8');
    const st = fs.statSync(file);
    console.log(`${kind} ${file} (mode ${(st.mode & 0o777).toString(8)}, uid ${st.uid})`);
    if (kind === 'json') console.log(`  top-level keys: ${Object.keys(parseJson(text, file)).join(', ')}`);
    for (const name of [SESSION, KEY]) {
      const label = kind === 'json' ? JSON_KEY[name] : name;
      const { defs, unsupported } = parseDefs(kind, text, name);
      if (defs.length === 0 && unsupported === 0) { console.log(`  ${label}: not defined here`); continue; }
      defs.forEach((d, i) => console.log(`  ${label} definition ${i + 1}: ${describe(d.value)}`));
      if (unsupported > 0) console.log(`  ${label}: ${unsupported} line(s) in an UNSUPPORTED form — STOP`);
    }
  }
}

function cmdEffective(W, installDir, configPath, pid) {
  if (!path.isAbsolute(configPath)) die(12, 'the config path must be absolute');
  const environ = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean);
  for (const k of Object.keys(process.env)) if (k.startsWith('DASHBOARD_')) delete process.env[k];
  for (const kv of environ) {
    const i = kv.indexOf('=');
    if (kv.slice(0, i).startsWith('DASHBOARD_')) process.env[kv.slice(0, i)] = kv.slice(i + 1);
  }
  const raw = fs.existsSync(configPath) ? parseJson(fs.readFileSync(configPath, 'utf8'), configPath) : {};
  const envS = process.env[SESSION]; const envK = process.env[KEY];
  console.log(`process env ${SESSION}: ${envS === undefined ? 'absent' : describe(envS)}`);
  console.log(`process env ${KEY}: ${envK === undefined ? 'absent' : describe(envK)}`);
  console.log(`config sessionSecret: ${raw.sessionSecret === undefined ? 'absent' : describe(String(raw.sessionSecret))}`);
  console.log(`config encryptionKey: ${raw.encryptionKey === undefined ? 'absent' : describe(String(raw.encryptionKey))}`);
  return import(path.join(installDir, 'packages/dashboard/dist/config.js')).then((m) => {
    const c = m.loadConfig(configPath);
    const keySource = envK !== undefined && envK !== '' ? 'from process env' : raw.encryptionKey ? 'from config file' : 'DEFAULTED to the session secret';
    const sessionSource = envS !== undefined ? 'from process env' : 'from config file';
    const pinned = keySource !== 'DEFAULTED to the session secret';
    console.log(`effective session secret: ${sessionSource}, length ${c.sessionSecret.length}`);
    console.log(`effective encryption key: ${keySource}, length ${c.encryptionKey.length}`);
    console.log(`encryption key equals session secret: ${c.encryptionKey === c.sessionSecret}`);
    if (raw.sessionSecret !== undefined) console.log(`config sessionSecret equals the effective session secret: ${raw.sessionSecret === c.sessionSecret}`);
    if (raw.encryptionKey !== undefined) console.log(`config encryptionKey equals the effective encryption key: ${raw.encryptionKey === c.encryptionKey}`);
    console.log(`PINNED: ${pinned ? 'yes' : 'NO'}`);
    fs.writeFileSync(path.join(W, 'old-session-secret'), `${c.sessionSecret}\n`, { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(path.join(W, 'old-encryption-key'), `${c.encryptionKey}\n`, { mode: 0o600, flag: 'wx' });
    const pluginsDir = m.serverPluginsDir(c);
    const vars = `DB_PATH='${c.dbPath}'\nPLUGINS_DIR='${pluginsDir}'\nPORT='${c.port}'\nPINNED='${pinned ? 'yes' : 'no'}'\n`;
    fs.writeFileSync(path.join(W, 'vars.effective'), vars, { mode: 0o600, flag: 'wx' });
    console.log(`dbPath: ${c.dbPath}`);
    console.log(`pluginsDir: ${pluginsDir}`);
    console.log(`port: ${c.port}`);
    console.log('wrote: old-session-secret, old-encryption-key, vars.effective (all 0600)');
  });
}

function cmdBackup(W) {
  const dir = path.join(W, 'backup');
  fs.mkdirSync(dir, { mode: 0o700 });
  const lines = [];
  readLocations(W).forEach(({ file }, i) => {
    const st = fs.statSync(file);
    const dst = path.join(dir, `${i}.bak`);
    fs.writeFileSync(dst, fs.readFileSync(file), { mode: 0o600, flag: 'wx' });
    fsyncPath(dst);
    const same = fs.readFileSync(dst).equals(fs.readFileSync(file));
    if (!same) die(13, `backup of ${file} does not match the original`);
    lines.push([i, (st.mode & 0o7777).toString(8), st.uid, st.gid, file].join('\t'));
    console.log(`backed up ${file} -> ${dst} (byte-identical: yes)`);
  });
  fs.writeFileSync(path.join(dir, 'MANIFEST'), `${lines.join('\n')}\n`, { mode: 0o600, flag: 'wx' });
  fsyncPath(dir);
  console.log(`BACKUP: ${lines.length} file(s)`);
}

function cmdRestore(W) {
  const dir = path.join(W, 'backup');
  const rows = fs.readFileSync(path.join(dir, 'MANIFEST'), 'utf8').split('\n').filter(Boolean);
  let bad = 0;
  for (const row of rows) {
    const [i, mode, uid, gid, file] = row.split('\t');
    const content = fs.readFileSync(path.join(dir, `${i}.bak`));
    atomicWrite(file, content, parseInt(mode, 8), Number(uid), Number(gid));
    const st = fs.statSync(file);
    const ok = fs.readFileSync(file).equals(content) && (st.mode & 0o7777) === parseInt(mode, 8) && st.uid === Number(uid) && st.gid === Number(gid);
    if (!ok) bad++;
    console.log(`restored ${file}: bytes+mode+owner ${ok ? 'match' : 'MISMATCH'}`);
  }
  console.log(`RESTORE: ${bad === 0 ? 'PASS' : 'FAIL'}`);
  if (bad !== 0) process.exit(14);
}

function rewrite(kind, text, name, value, anchor) {
  if (kind === 'json') {
    const obj = parseJson(text, 'a config file');
    const indentMatch = /\n([ \t]+)"/.exec(text);
    const out = { ...obj, [JSON_KEY[name]]: value };
    return JSON.stringify(out, null, indentMatch ? indentMatch[1] : 2) + (text.endsWith('\n') ? '\n' : '');
  }
  const lines = text.split('\n');
  if (anchor === undefined) {
    for (const d of parseDefs(kind, text, name).defs) lines[d.idx] = `${d.prefix}${name}=${value}${d.suffix}`;
    return lines.join('\n');
  }
  const a = parseDefs(kind, text, anchor).defs.at(-1);
  lines.splice(a.idx + 1, 0, `${a.prefix}${name}=${value}${a.suffix}`);
  return lines.join('\n');
}

// set: replace every existing definition of NAME in every location.
// pin: additionally ADD a definition of the encryption key next to the session secret in every
//      location that defines the session secret but not the encryption key.
function cmdSet(W, name, valueFile, mode) {
  if (![SESSION, KEY].includes(name)) die(15, `unknown name ${name}`);
  const value = readValue(valueFile);
  if (!SAFE_VALUE.test(value)) die(15, 'the new value is not >=32 characters of the base64 alphabet');
  const plan = [];
  for (const loc of readLocations(W)) {
    const text = fs.readFileSync(loc.file, 'utf8');
    const own = parseDefs(loc.kind, text, name);
    const anchor = parseDefs(loc.kind, text, SESSION);
    if (own.unsupported > 0 || anchor.unsupported > 0) die(16, `${loc.file} defines a name in an unsupported form; edit refused, nothing written`);
    if (own.defs.length > 0) plan.push({ ...loc, text, action: 'replace', n: own.defs.length });
    else if (mode === 'pin' && anchor.defs.length > 0) plan.push({ ...loc, text, action: 'add', n: 1 });
  }
  if (plan.length === 0) die(17, `no location defines ${name}; nothing written`);
  for (const p of plan) {
    const st = fs.statSync(p.file);
    const out = rewrite(p.kind, p.text, name, value, p.action === 'add' && p.kind !== 'json' ? SESSION : undefined);
    atomicWrite(p.file, out, st.mode, st.uid, st.gid);
    console.log(`${p.action === 'add' ? 'added' : 'replaced'} ${p.n} definition(s) of ${p.kind === 'json' ? JSON_KEY[name] : name} in ${p.file}`);
  }
  console.log(`SET: ${plan.length} file(s) written`);
}

// verify --val LABEL=file ... --expect NAME=LABEL ...
// PASS requires: every definition of each expected NAME holds exactly its expected value, each
// expected NAME is defined at least once, and no labelled value appears anywhere in any location
// file other than inside a definition that is expected to hold it (no "stray" copies).
function cmdVerify(W, args) {
  const vals = {}; const expect = {};
  for (let i = 0; i < args.length; i += 2) {
    const [k, v] = (args[i + 1] ?? '').split('=');
    if (args[i] === '--val') vals[k] = readValue(v);
    else if (args[i] === '--expect') expect[k] = v;
    else die(18, `bad verify argument ${args[i]}`);
  }
  const labelsOf = (v) => Object.keys(vals).filter((l) => vals[l] === v);
  let fail = 0; const seen = {};
  for (const { kind, file } of readLocations(W)) {
    const text = fs.readFileSync(file, 'utf8');
    const accounted = {};
    for (const [name, label] of Object.entries(expect)) {
      const { defs, unsupported } = parseDefs(kind, text, name);
      if (unsupported > 0) { fail++; console.log(`${file}: ${name} in an unsupported form — FAIL`); }
      defs.forEach((d) => {
        seen[name] = (seen[name] ?? 0) + 1;
        const ok = d.value === vals[label];
        if (!ok) fail++;
        if (ok) accounted[d.value] = (accounted[d.value] ?? 0) + 1;
        const got = labelsOf(d.value);
        console.log(`${file}: ${kind === 'json' ? JSON_KEY[name] : name} holds ${got.length ? got.join('|') : d.value === '' ? 'EMPTY' : 'an UNLABELLED value'} (expected ${label}) — ${ok ? 'ok' : 'FAIL'}`);
      });
    }
    for (const v of new Set(Object.values(vals))) {
      const raw = v === '' ? 0 : text.split(v).length - 1;
      const stray = raw - (accounted[v] ?? 0);
      if (stray !== 0) { fail++; console.log(`${file}: ${labelsOf(v).join('|')} appears ${stray} time(s) outside an expected definition — FAIL`); }
    }
  }
  for (const name of Object.keys(expect)) if (!seen[name]) { fail++; console.log(`${name}: defined in no location — FAIL`); }
  console.log(`VERIFY: ${fail === 0 ? 'PASS' : 'FAIL'}`);
  if (fail !== 0) process.exit(19);
}

const [cmd, W, ...rest] = process.argv.slice(2);
async function main() {
  if (!W || !path.isAbsolute(W)) die(2, 'usage: rotate-helper.mjs <inventory|effective|backup|restore|set|pin|verify> <absolute work dir> ...');
  switch (cmd) {
    case 'inventory': return cmdInventory(W);
    case 'effective': return cmdEffective(W, rest[0], rest[1], rest[2]);
    case 'backup': return cmdBackup(W);
    case 'restore': return cmdRestore(W);
    case 'set': return cmdSet(W, rest[0], rest[1], 'set');
    case 'pin': return cmdSet(W, KEY, rest[0], 'pin');
    case 'verify': return cmdVerify(W, rest);
    default: return die(2, `unknown command ${cmd}`);
  }
}
// An unexpected error's message could quote file content: print only its code and path.
main().catch((e) => die(21, `unexpected error ${e?.code ?? e?.name ?? ''}${e?.path ? ` on ${e.path}` : ''} (message suppressed)`));
HELPER_EOF
  )
  sha256sum "$W/rotate-helper.mjs" | cut -d' ' -f1 )
```
Expected output: `5b8f2167afee6aa27becef01282556f48b55c47af364552459dc8230563543b4`. **STOP** on any other hash — the copy is damaged; delete `$W`
and start again from S1.
<!-- Maintainers: this hash is sha256 of the helper text between the two HELPER_EOF lines,
including its final newline. Recompute it whenever the helper changes, and re-run the rehearsal. -->

**S4 — Build the location list and inventory it (names and lengths only).**

```bash
( set -eu; W=/root/luqen-rotation; . "$W/vars"
  ( umask 077
    { printf 'unit\t%s\n' "$(systemctl show -p FragmentPath --value "$UNIT")"
      for f in $(systemctl show -p DropInPaths --value "$UNIT"); do printf 'unit\t%s\n' "$f"; done
      systemctl show -p EnvironmentFiles --value "$UNIT" | sed 's/ (ignore_errors=.*)$//' | while IFS= read -r f; do
        if [ -f "$f" ]; then printf 'envfile\t%s\n' "$f"; else echo "note: env file $f does not exist (skipped)" >&2; fi
      done
      printf 'json\t%s\n' "$CONFIG"
    } > "$W/locations" )
  cat "$W/locations"
  echo "--- variable NAMES in the unit's Environment= (never values):"
  systemctl show -p Environment --value "$UNIT" | tr ' ' '\n' | cut -d= -f1 | grep -E '^[A-Z_][A-Z0-9_]*$' | sort -u
  echo "--- definitions per location (lengths only, never values):"
  "$NODE" "$W/rotate-helper.mjs" inventory "$W" )
```
Expected output shape (the rehearsal fixture's output with its paths shortened — your paths and
lines differ; the `Environment=` names part was not rehearsed):
```
unit	/etc/systemd/system/luqen-dashboard.service
unit	/etc/systemd/system/luqen-dashboard.service.d/override.conf
envfile	/etc/luqen/dashboard.env
json	/opt/luqen/dashboard.config.json
--- variable NAMES in the unit's Environment= (never values):
DASHBOARD_PUBLIC_URL
DASHBOARD_SESSION_SECRET
NODE_ENV
SESSION_EXPIRY_MINUTES
--- definitions per location (lengths only, never values):
unit /etc/systemd/system/luqen-dashboard.service (mode 644, uid 0)
  DASHBOARD_SESSION_SECRET definition 1: set, length 44
  DASHBOARD_ENCRYPTION_KEY: not defined here
unit /etc/systemd/system/luqen-dashboard.service.d/override.conf (mode 644, uid 0)
  DASHBOARD_SESSION_SECRET: not defined here
  DASHBOARD_ENCRYPTION_KEY: not defined here
envfile /etc/luqen/dashboard.env (mode 600, uid 0)
  DASHBOARD_SESSION_SECRET: not defined here
  DASHBOARD_ENCRYPTION_KEY definition 1: EMPTY
json /opt/luqen/dashboard.config.json (mode 640, uid 0)
  top-level keys: port, dbPath, reportsDir, sessionSecret, complianceClientId, complianceClientSecret
  sessionSecret definition 1: set, length 44
  encryptionKey: not defined here
```
The helper recognises these forms only: in unit files `Environment=NAME=value` and
`Environment="NAME=value"` (one assignment per line); in EnvironmentFiles `NAME=value`,
`NAME="value"`, `NAME='value'`; in the config file the top-level `sessionSecret` /
`encryptionKey` strings. **STOP** if any line says `UNSUPPORTED form` (e.g. several assignments
on one `Environment=` line, or `export NAME=`) — rewrite that line by hand into a supported form
as a separate, reviewed change first. **STOP** if a secret defined in the process environment (S5)
is defined in no `unit`/`envfile` location here — it comes from somewhere this runbook cannot edit.

**S5 — Read the old (current) values from the running process, and record the baseline.** The
helper reads `/proc/<MainPID>/environ` (exactly what the running dashboard received from systemd)
and the config file, runs the DEPLOYED build's own `loadConfig`, and writes the effective values
to `$W/old-session-secret` and `$W/old-encryption-key` (0600). It prints sources and lengths only.

```bash
( set -eu; W=/root/luqen-rotation; . "$W/vars"
  PID=$(systemctl show -p MainPID --value "$UNIT")
  test "$PID" -gt 0 || { echo "STOP: the unit has no running main process"; exit 1; }
  "$NODE" "$W/rotate-helper.mjs" effective "$W" "$INSTALL_DIR" "$CONFIG" "$PID"
  . "$W/vars.effective"
  curl -sS -o "$W/health.before" -w 'GET /health -> %{http_code}\n' "http://127.0.0.1:$PORT/health"
  cat "$W/health.before"; echo )
```
Expected output (the rehearsal fixture, paths shortened — an UNPINNED install whose
EnvironmentFile holds an EMPTY `DASHBOARD_ENCRYPTION_KEY=`):
```
process env DASHBOARD_SESSION_SECRET: set, length 44
process env DASHBOARD_ENCRYPTION_KEY: EMPTY
config sessionSecret: set, length 44
config encryptionKey: absent
effective session secret: from process env, length 44
effective encryption key: DEFAULTED to the session secret, length 44
encryption key equals session secret: true
config sessionSecret equals the effective session secret: true
PINNED: NO
dbPath: /opt/luqen/dashboard.db
pluginsDir: /opt/luqen/plugins
port: 5000
wrote: old-session-secret, old-encryption-key, vars.effective (all 0600)
GET /health -> 200
{"status":"ok","version":"…","checks":{"browser":{"status":"ok","source":"…"},"atRestEncryption":{"status":"ok"}}}
```
Read the output:

- `PINNED: NO` → run [Procedure P](#procedure-p--pin-dashboard_encryption_key-precondition-for-a-b-and-c)
  first, whatever you came to rotate. A line like `DASHBOARD_ENCRYPTION_KEY=` with nothing after
  the `=` is **not** a pin — the code treats an empty value as unset, and rotating the session
  secret over it reproduces the 2026-09-28 crash. That is why this runbook never tests for a pin
  with `grep '^DASHBOARD_ENCRYPTION_KEY='`.
- `PINNED: yes` → Procedures A, B, C are available.
- `dbPath` is where the dashboard's database really is. The config file's `dbPath` is resolved
  relative to the **config file's directory** (not the working directory), and
  `DASHBOARD_DB_PATH` in the unit's environment overrides it. The `rekey-at-rest` commands below
  pass `--db-path "$DB_PATH"` and `--plugins-dir "$PLUGINS_DIR"` explicitly, because your shell
  does not have the unit's environment; `--db-path` itself is resolved against the current
  directory, which is why the helper records an absolute path.
- **STOP** if the effective session secret or encryption key length is below 32, if
  `GET /health` is not 200, or if `health.before` shows `"atRestEncryption":{"status":"failed"}` —
  the key is already wrong; do not rotate on top of it.

### Procedure P — pin `DASHBOARD_ENCRYPTION_KEY` (precondition for A, B and C)

Run when S5 printed `PINNED: NO`. It writes the CURRENT effective encryption key (today: the
session secret's value) as an explicit `DASHBOARD_ENCRYPTION_KEY` / `encryptionKey` into every
location that defines the session secret, and replaces any existing (for example empty)
definition of it. The at-rest key does not change, so nothing is re-keyed. Costs one restart.

P1. **Prove the value to be pinned decrypts every stored value** (read-only dry-run against a
throwaway probe key; safe while the dashboard runs):
```bash
( W=/root/luqen-rotation; . "$W/vars"; . "$W/vars.effective"
  ( umask 077; openssl rand -base64 32 > "$W/probe-key" )
  OLD_DASHBOARD_ENCRYPTION_KEY="$(cat "$W/old-encryption-key")" \
  PROBE_DASHBOARD_ENCRYPTION_KEY="$(cat "$W/probe-key")" \
  "$NODE" "$INSTALL_DIR/packages/dashboard/dist/cli.js" rekey-at-rest --dry-run \
    --config "$CONFIG" --db-path "$DB_PATH" --plugins-dir "$PLUGINS_DIR" \
    --old-key-env OLD_DASHBOARD_ENCRYPTION_KEY --new-key-env PROBE_DASHBOARD_ENCRYPTION_KEY
  echo "exit=$?"; rm -f "$W/probe-key" )
```
Expected: `mode: dry-run`, `ok: true`, `wrote: false`, one `store …: count=N skipped=M` line per
store, no `failures:` line, possibly `database in use — --apply would refuse` (normal while the
dashboard runs), and `exit=0`. **STOP** on any other exit code or any `failures:` line (see
[exit codes](#rekey-at-rest-exit-codes)).

P2. **Announce the restart** (every user is logged out) through your deployment's usual
channel — this runbook has no command for it.

P3. **Back up every location file** (0600 copies plus a manifest of mode/owner):
```bash
( W=/root/luqen-rotation; . "$W/vars"; "$NODE" "$W/rotate-helper.mjs" backup "$W" )
```
Expected: one `backed up <file> -> $W/backup/<n>.bak (byte-identical: yes)` line per location,
then `BACKUP: <n> file(s)`. **STOP** otherwise.

P4. **Write the pin into every location** (atomic, mode/owner preserved):
```bash
( W=/root/luqen-rotation; . "$W/vars"; "$NODE" "$W/rotate-helper.mjs" pin "$W" "$W/old-encryption-key" )
```
Expected (fixture): `added 1 definition(s) of DASHBOARD_ENCRYPTION_KEY in …/luqen-dashboard.service`,
`replaced 1 definition(s) of DASHBOARD_ENCRYPTION_KEY in …/dashboard.env`,
`added 1 definition(s) of encryptionKey in …/dashboard.config.json`, `SET: 3 file(s) written`.
In a unit file the new line is inserted directly after the session secret's line, in the same
`[Service]` section and the same quoting form. **STOP** on any `STOP:` line — nothing was written.

P5. **Verify by comparison** (no value printed):
```bash
( W=/root/luqen-rotation; . "$W/vars"
  "$NODE" "$W/rotate-helper.mjs" verify "$W" \
    --val OLD_SESSION="$W/old-session-secret" --val OLD_KEY="$W/old-encryption-key" \
    --expect DASHBOARD_SESSION_SECRET=OLD_SESSION --expect DASHBOARD_ENCRYPTION_KEY=OLD_KEY )
```
Expected: every definition line ends `— ok`, last line `VERIFY: PASS`. (Here `OLD_SESSION` and
`OLD_KEY` are the same value, so lines read `holds OLD_SESSION|OLD_KEY`.) **STOP → Rollback** on
`VERIFY: FAIL`.

P6. **Reload systemd** and confirm it picked the edit up:
```bash
( W=/root/luqen-rotation; . "$W/vars"
  systemctl daemon-reload
  systemctl show -p NeedDaemonReload "$UNIT"
  systemctl show -p Environment --value "$UNIT" | tr ' ' '\n' | cut -d= -f1 | grep -cx 'DASHBOARD_ENCRYPTION_KEY' )
```
Expected: `NeedDaemonReload=no`, then a count of at least `1` if the pin was added inline to the
unit or a drop-in (`0` if no unit file defines a dashboard secret inline). **STOP → Rollback**
otherwise.

P7. Run the [verification window](#verification-window) (it performs the restart), then
[Cleanup](#cleanup). **STOP → Rollback** if any check fails.

### Procedure A — rotate the session secret only (logout only, no re-keying)

Precondition: S1–S5 done in this run and S5 printed `PINNED: yes`.

A1. Generate the new value into a 0600 file (never echoed):
```bash
( W=/root/luqen-rotation
  ( umask 077; openssl rand -base64 32 > "$W/new-session-secret" )
  echo "bytes: $(wc -c < "$W/new-session-secret")" )
```
Expected: `bytes: 45` (44 base64 characters and a newline). **STOP** otherwise.

A2. **Announce the logout** — every session ends the moment the unit restarts.

A3. Back up every location file — the P3 block, unchanged. Expected `BACKUP: <n> file(s)`.

A4. Write the new session secret into every location that defines it:
```bash
( W=/root/luqen-rotation; . "$W/vars"; "$NODE" "$W/rotate-helper.mjs" set "$W" DASHBOARD_SESSION_SECRET "$W/new-session-secret" )
```
Expected: one `replaced N definition(s) of DASHBOARD_SESSION_SECRET|sessionSecret in <file>`
line per location that defines it, then `SET: <n> file(s) written`. **STOP** on any `STOP:` line.

A5. Verify by comparison:
```bash
( W=/root/luqen-rotation; . "$W/vars"
  "$NODE" "$W/rotate-helper.mjs" verify "$W" \
    --val OLD_SESSION="$W/old-session-secret" --val NEW_SESSION="$W/new-session-secret" \
    --val OLD_KEY="$W/old-encryption-key" \
    --expect DASHBOARD_SESSION_SECRET=NEW_SESSION --expect DASHBOARD_ENCRYPTION_KEY=OLD_KEY )
```
Expected: `VERIFY: PASS`. If the key was pinned from the session secret, the OLD session value
legitimately remains — as the encryption key's value only; the helper accounts for that, and any
other copy of it anywhere in a location file is reported as `appears N time(s) outside an
expected definition — FAIL`. **STOP → Rollback** on `VERIFY: FAIL`.

A6. `daemon-reload` — the P6 block (expect `NeedDaemonReload=no`; the count line is not needed).

A7. Run the [verification window](#verification-window), then [Cleanup](#cleanup).

### Procedure B — rotate the at-rest encryption key

Precondition: S1–S5 done in this run and S5 printed `PINNED: yes`. B re-encrypts every stored
at-rest value under the new key before any file names the new key.

B1. Generate the new key:
```bash
( W=/root/luqen-rotation
  ( umask 077; openssl rand -base64 32 > "$W/new-encryption-key" )
  echo "bytes: $(wc -c < "$W/new-encryption-key")" )
```
Expected: `bytes: 45`.

B2. **Dry-run** (read-only; safe while the dashboard runs):
```bash
( W=/root/luqen-rotation; . "$W/vars"; . "$W/vars.effective"
  OLD_DASHBOARD_ENCRYPTION_KEY="$(cat "$W/old-encryption-key")" \
  NEW_DASHBOARD_ENCRYPTION_KEY="$(cat "$W/new-encryption-key")" \
  "$NODE" "$INSTALL_DIR/packages/dashboard/dist/cli.js" rekey-at-rest --dry-run \
    --config "$CONFIG" --db-path "$DB_PATH" --plugins-dir "$PLUGINS_DIR" \
    --old-key-env OLD_DASHBOARD_ENCRYPTION_KEY --new-key-env NEW_DASHBOARD_ENCRYPTION_KEY
  echo "exit=$?" )
```
Expected output (rehearsal fixture):
```
mode: dry-run
ok: true
wrote: false
store oauth-signing-keys: count=1 skipped=0
store service-connections: count=1 skipped=1
store git-credentials: count=0 skipped=0
store plugin-configs: count=0 skipped=0 viaManifest=0 viaShape=0
database in use — --apply would refuse
exit=0
```
`database in use — --apply would refuse` is expected here (the dashboard holds the database);
the dry-run still exits 0. `count=` is the number of encrypted values in that store, `skipped=`
the number of rows with nothing encrypted (for example a service connection with no client
secret). **Record the `service-connections` line** — it decides whether the live decrypt check in
the verification window applies. **STOP** on a non-zero
exit or a `failures:` line: `wrong-key-or-tampered`/`malformed` means the old key does not match
what is stored — investigate, never generate a new key on top of a wrong one; `default-salt`
(F-3, a CLI-configured plugin secret) is an OWNER DECISION — do not proceed without one.

B3. **Announce** the downtime and the logout.

B4. Back up every location file — the P3 block. Expected `BACKUP: <n> file(s)`.

B5. Stop the unit:
```bash
( W=/root/luqen-rotation; . "$W/vars"; systemctl stop "$UNIT"; echo "is-active: $(systemctl is-active "$UNIT")" )
```
Expected: `is-active: inactive` (or `failed`). **STOP** if `active` (and start it again if you
cannot tell why).

B6. **Apply** (the only step that writes the database):
```bash
( W=/root/luqen-rotation; . "$W/vars"; . "$W/vars.effective"
  test "$(systemctl is-active "$UNIT")" != active || { echo "STOP: unit is active"; exit 1; }
  OLD_DASHBOARD_ENCRYPTION_KEY="$(cat "$W/old-encryption-key")" \
  NEW_DASHBOARD_ENCRYPTION_KEY="$(cat "$W/new-encryption-key")" \
  "$NODE" "$INSTALL_DIR/packages/dashboard/dist/cli.js" rekey-at-rest --apply \
    --config "$CONFIG" --db-path "$DB_PATH" --plugins-dir "$PLUGINS_DIR" \
    --old-key-env OLD_DASHBOARD_ENCRYPTION_KEY --new-key-env NEW_DASHBOARD_ENCRYPTION_KEY > "$W/apply.out"
  rc=$?; cat "$W/apply.out"; echo "exit=$rc"
  ( umask 077; sed -n 's/^Backup written to: //p' "$W/apply.out" > "$W/db-backup-path" )
  test -s "$W/db-backup-path" && stat -c 'db backup: %n mode %a' "$(cat "$W/db-backup-path")" )
```
Expected output:
```
mode: apply
ok: true
wrote: true
store oauth-signing-keys: count=1 skipped=0
store service-connections: count=1 skipped=1
store git-credentials: count=0 skipped=0
store plugin-configs: count=0 skipped=0 viaManifest=0 viaShape=0
Backup written to: /opt/luqen/dashboard.db.pre-rekey-2026-09-28T20-58-03-123Z.bak
Next steps: 1) set DASHBOARD_ENCRYPTION_KEY to the new value, 2) restart the dashboard, 3) delete the backup after the verification window.
exit=0
db backup: /opt/luqen/dashboard.db.pre-rekey-2026-09-28T20-58-03-123Z.bak mode 600
```
The database backup is always `<dbPath>.pre-rekey-<ISO timestamp with : and . replaced by ->.bak`,
mode 0600, beside the database; its path is now in `$W/db-backup-path`. It holds every at-rest
value under the OLD key. Counts must equal B2's. On a non-zero exit, **nothing was written**:
exit 3 = `Apply refused: database in use. …` — the database is still open (the unit or another
process; measured: the CLI's own lock check refuses even when the `is-active` test above passed) —
find it, then re-run B6;
exit 1, 2 or 4 = zero writes, no database rollback is needed and no file has been edited yet —
run the [verification window](#verification-window) (V1 starts the unit on its unchanged
configuration), clean up, and investigate with the dry-run. Do not continue to B7 unless
`exit=0`.

B7. Write the new key into every location that defines it:
```bash
( W=/root/luqen-rotation; . "$W/vars"; "$NODE" "$W/rotate-helper.mjs" set "$W" DASHBOARD_ENCRYPTION_KEY "$W/new-encryption-key" )
```
Expected: `replaced …` lines and `SET: <n> file(s) written`. **STOP → Rollback** on a `STOP:` line.

B8. Verify by comparison:
```bash
( W=/root/luqen-rotation; . "$W/vars"
  "$NODE" "$W/rotate-helper.mjs" verify "$W" \
    --val OLD_SESSION="$W/old-session-secret" --val OLD_KEY="$W/old-encryption-key" \
    --val NEW_KEY="$W/new-encryption-key" \
    --expect DASHBOARD_SESSION_SECRET=OLD_SESSION --expect DASHBOARD_ENCRYPTION_KEY=NEW_KEY )
```
Expected: `VERIFY: PASS`. **STOP → Rollback** on `VERIFY: FAIL`.

B9. `daemon-reload` — the P6 block (expect `NeedDaemonReload=no`).

B10. Run the [verification window](#verification-window) (it starts the unit). **STOP →
Rollback** on any failure. Only after it passes, run [Cleanup](#cleanup) — which deletes the
database backup.

### Procedure C — rotate both at once (an exposed secret)

Use when the session secret AND the encryption key must both change in one maintenance window
(for example a suspected leak). Precondition: S1–S5 done in this run and S5 printed
`PINNED: yes` (if not, run Procedure P first, clean up, and start C with a fresh S1 — pinning the
exposed value is fine, C replaces it minutes later). One stop, one apply, one start.

C1. Generate both new values:
```bash
( W=/root/luqen-rotation
  ( umask 077; openssl rand -base64 32 > "$W/new-session-secret"; openssl rand -base64 32 > "$W/new-encryption-key" )
  echo "bytes: $(wc -c < "$W/new-session-secret") $(wc -c < "$W/new-encryption-key")" )
```
Expected: `bytes: 45 45`.

C2. Dry-run — the B2 block, unchanged. Expected `ok: true`, `wrote: false`, `exit=0`; record
the `count=` lines. **STOP** exactly as in B2.

C3. **Announce, once:** downtime now, and every user logged out when the dashboard returns.

C4. Back up every location file — the P3 block. Expected `BACKUP: <n> file(s)`.

C5. Stop the unit — the B5 block. Expected `is-active: inactive`.

C6. Apply — the B6 block. Expected `ok: true`, `wrote: true`, `Backup written to: …`, `exit=0`,
and a `db backup: … mode 600` line. On a non-zero exit follow B6's instructions (zero writes).

C7. Write BOTH new values into every location:
```bash
( W=/root/luqen-rotation; . "$W/vars"
  "$NODE" "$W/rotate-helper.mjs" set "$W" DASHBOARD_ENCRYPTION_KEY "$W/new-encryption-key" &&
  "$NODE" "$W/rotate-helper.mjs" set "$W" DASHBOARD_SESSION_SECRET "$W/new-session-secret" )
```
Expected: two `SET: <n> file(s) written` lines. **STOP → Rollback** on a `STOP:` line (if the
first `set` succeeded and the second refused, the files are half-edited — Rollback restores them).

C8. Verify by comparison — both old values must be gone from every location file:
```bash
( W=/root/luqen-rotation; . "$W/vars"
  "$NODE" "$W/rotate-helper.mjs" verify "$W" \
    --val OLD_SESSION="$W/old-session-secret" --val OLD_KEY="$W/old-encryption-key" \
    --val NEW_SESSION="$W/new-session-secret" --val NEW_KEY="$W/new-encryption-key" \
    --expect DASHBOARD_SESSION_SECRET=NEW_SESSION --expect DASHBOARD_ENCRYPTION_KEY=NEW_KEY )
```
Expected: `VERIFY: PASS` — which here also proves neither old value appears anywhere in any
location file. **STOP → Rollback** on `VERIFY: FAIL`.

C9. `daemon-reload` — the P6 block (expect `NeedDaemonReload=no`).

C10. Run the [verification window](#verification-window) (it starts the unit). **STOP →
Rollback** on any failure.

C11. Only after the window passes: [Cleanup](#cleanup) — location backups, value files, temp
files and the database backup. Until then they are the only way back.

### Verification window

Run V1–V4 in order after every procedure (and after a rollback). **STOP and roll back** if any
check fails — do not clean up and do not report success on a partial pass. Any outcome not
listed as a pass is a fail.

V1. **(Re)start and record the post-start state.** `systemctl restart` starts a stopped unit
too, so this one block serves every procedure.
```bash
( W=/root/luqen-rotation; . "$W/vars"; . "$W/vars.effective"
  date '+%Y-%m-%d %H:%M:%S' > "$W/start-time"
  systemctl show -p NRestarts "$UNIT" | tee "$W/nrestarts.before"
  systemctl restart "$UNIT"
  timeout 90 bash -c "until curl -fsS -o /dev/null http://127.0.0.1:$PORT/health 2>/dev/null; do sleep 2; done" \
    && echo "health: answering" || echo "STOP: /health not answering after 90 s"
  systemctl show -p ActiveState -p NRestarts -p ActiveEnterTimestamp -p MainPID "$UNIT" > "$W/window.start"
  cat "$W/window.start"; systemctl --version | head -1 )
```
Expected: the pre-restart `NRestarts=` line, `health: answering`, `ActiveState=active`,
**`NRestarts=0`**, an `ActiveEnterTimestamp=` after the time in `$W/start-time`, a non-zero
`MainPID=`. `NRestarts` must be exactly 0: measured on systemd 257 (probe unit), an explicit
`systemctl start` or `restart` resets it to 0 while a `stop` keeps it, so any non-zero value here
means the dashboard already crashed and was auto-restarted during startup — **STOP → Rollback**.
Only if `systemctl --version` is NOT 257 (reset behaviour unmeasured there) and `NRestarts` is
non-zero: pass only if it equals the pre-restart value in `$W/nrestarts.before` (the counter was
carried over, not increased), and say in your report that you applied this relative rule.

V2. **`/health` body** — the status is computed ONCE at startup by decrypting every stored at-rest
value (`routes/health.ts`, DEC-4), so HTTP 200 alone proves nothing (`/health` answers 200 even
when degraded), and a value that becomes undecryptable after startup does not change it (measured:
it stayed `ok` over a tampered ciphertext — V3 is the check that caught it):
```bash
( W=/root/luqen-rotation; . "$W/vars.effective"
  curl -sS -o "$W/health.after" -w 'GET /health -> %{http_code}\n' "http://127.0.0.1:$PORT/health"
  cat "$W/health.after"; echo
  grep -qF '"atRestEncryption":{"status":"ok"}' "$W/health.after" && echo "atRestEncryption: ok" || echo "atRestEncryption: NOT ok"
  grep -q '^{"status":"ok",' "$W/health.after" && echo "overall: ok" || echo "overall: NOT ok"
  grep -qF '"browser":{"status":"failed"}' "$W/health.after" && echo "browser: failed" || echo "browser: not failed"
  grep -qF '"browser":{"status":"failed"}' "$W/health.before" && echo "browser before: failed" || echo "browser before: not failed" )
```
Pass: `atRestEncryption: ok`. (`"atRestEncryption":{"status":"empty"}` passes only if
`$W/health.before` was also `empty` — an installation with no at-rest data.)
`"failed"` is the signal this runbook exists to surface → **STOP → Rollback**. `overall: NOT ok`
with `atRestEncryption: ok` and `browser: failed` is a **Chromium problem unrelated to the
rotation** — it does not STOP the rotation, but record it in your report (and say whether
`browser before` was already `failed`).

V3. **Live checks** — `/health` is precomputed; these exercise the keys at request time. They
need an admin API key for this dashboard in the environment variable `LUQEN_ADMIN_API_KEY` (a
name chosen by this runbook — the dashboard never reads it). Do NOT mint one with the
`api-key` CLI command: it revokes every existing key.
```bash
( W=/root/luqen-rotation; . "$W/vars.effective"
  echo "GET /login -> $(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/login")"
  if [ -z "${LUQEN_ADMIN_API_KEY:-}" ]; then echo "LIVE CHECKS NOT RUN: LUQEN_ADMIN_API_KEY is not set"; exit 0; fi
  ( umask 077
    printf 'X-API-Key: %s\n' "$LUQEN_ADMIN_API_KEY" > "$W/apikey.hdr"
    printf '%s' "$LUQEN_ADMIN_API_KEY" > "$W/apikey.txt"
    : > "$W/cookies" )
  B="http://localhost:$PORT"
  echo "GET /admin/service-connections (API key, JSON) -> $(curl -sS -o "$W/sc.json" -w '%{http_code}' -H @"$W/apikey.hdr" -H 'Accept: application/json' "$B/admin/service-connections")"
  echo "  connections read from the database: $(grep -o '"source":"db"' "$W/sc.json" | wc -l)"
  curl -sS -c "$W/cookies" -b "$W/cookies" -o "$W/login.html" "$B/login"
  ( umask 077; sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p' "$W/login.html" | head -1 | tr -d '\n' > "$W/csrf" )
  curl -sS -c "$W/cookies" -b "$W/cookies" -o /dev/null -w 'POST /login (API key) -> %{http_code} %{redirect_url}\n' \
    --data-urlencode "_csrf@$W/csrf" --data-urlencode "apiKey@$W/apikey.txt" "$B/login"
  curl -sS -b "$W/cookies" -o /dev/null -w 'GET /home with the new session -> %{http_code} %{redirect_url}\n' "$B/home" )
```
Pass:
```
GET /login -> 200
GET /admin/service-connections (API key, JSON) -> 200
  connections read from the database: <the number of service_connections rows = count + skipped on the dry-run's service-connections line>
POST /login (API key) -> 302 http://localhost:<port>/
GET /home with the new session -> 200
```
What each line proves: `GET /admin/service-connections` calls `repo.list()`, which decrypts every
stored service-connection client secret **per request** with the running key (a wrong key makes
it fail with a 500) — it is the live decrypt check (measured: a tampered ciphertext turned exactly this line into
`500` and left the other lines green), and it only exercises the key when the dry-run's
`service-connections` `count=` is > 0. Procedure A has no dry-run of its own: run the P1 block
first (read-only, throwaway key) to get the count. With 0, say so in your report: the only decrypt
evidence is then V2 plus the boot-time OAuth signer, which crashes the process on a wrong key
and so shows up in V1/V4. The OAuth token endpoint and JWKS are NOT decrypt checks: JWKS serves
public keys, and the signing key is decrypted once at boot. `POST /login` then `GET /home` proves the
session secret can seal and open a cookie; a `302 …/login` on `GET /home` is a FAIL. The CSRF
token file must hold no trailing newline (`tr -d '\n'` above): `--data-urlencode name@file` sends
the newline too, and the POST then fails `403 … Invalid csrf token` (measured in the rehearsal). The login
writes a `login.success` audit entry (actor `admin`, API key login). If you cannot provide
`LUQEN_ADMIN_API_KEY`, report "live checks NOT RUN" — never "passed". Pass `GET /login -> 200`
regardless.

V4. **Hold for ≥ 60 s and prove nothing moved** (polls every 5 s, fails fast):
```bash
( W=/root/luqen-rotation; . "$W/vars"
  t0=$(stat -c %Y "$W/window.start")
  while :; do
    systemctl show -p ActiveState -p NRestarts -p ActiveEnterTimestamp -p MainPID "$UNIT" > "$W/window.now"
    if ! cmp -s "$W/window.start" "$W/window.now"; then echo "STOP: the unit changed during the window"; diff "$W/window.start" "$W/window.now"; exit 1; fi
    [ $(( $(date +%s) - t0 )) -ge 65 ] && break
    sleep 5
  done
  echo "WINDOW: $(( $(date +%s) - t0 )) s since V1, unchanged"; cat "$W/window.now"
  echo "is-active: $(systemctl is-active "$UNIT")"
  echo "journal crash lines since the restart: $(journalctl -u "$UNIT" --since "$(cat "$W/start-time")" --no-pager | grep -c -e 'Unsupported state or unable to authenticate data' -e 'Failed to start server')" )
```
Pass: `WINDOW: 6x s since V1, unchanged`, `ActiveState=active`, `NRestarts=0`, the SAME
`ActiveEnterTimestamp` and `MainPID` as V1, `is-active: active`, `journal crash lines since the
restart: 0`. Then re-run V2 once more — it must still pass. Anything else: **STOP → Rollback**.

### Rollback

For any procedure, when a step says **STOP → Rollback** or the verification window fails. The
location-file backups (P3/A3/B4/C4) restore the OLD values; the database backup (B6/C6) restores
the OLD encryption of the at-rest data.

R1. Stop the unit — the B5 block. Expected `is-active: inactive` or `failed`.

R2. **Only if an `--apply` exited 0 in this run** (B6/C6 recorded `$W/db-backup-path`): restore the
database byte-exact. **This discards every database write made since the apply** — anything the
dashboard wrote after it was started under the new key (scans, audit entries, logins) is lost.
If `--apply` exited 1, 2, 3 or 4 (or never ran), it wrote nothing: skip R2.
```bash
( W=/root/luqen-rotation; . "$W/vars"; . "$W/vars.effective"
  test "$(systemctl is-active "$UNIT")" != active || { echo "STOP: unit is active"; exit 1; }
  "$NODE" "$INSTALL_DIR/packages/dashboard/dist/cli.js" rekey-at-rest \
    --config "$CONFIG" --db-path "$DB_PATH" --rollback "$(cat "$W/db-backup-path")"
  echo "exit=$?" )
```
Expected:
```
Rollback complete: the database has been restored from the backup.
The backup file was NOT deleted. Delete it once you have verified the rollback.
exit=0
```
(`--rollback` needs no key variables.) Exit 3 = `Rollback refused: database in use…` — something
still holds the database; find and stop it, then re-run R2. Exit 1 = `Rollback refused: the
backup path does not exist.` or `… does not have a valid SQLite header.` — **STOP, leave the unit
stopped, escalate.** Side effect, measured in the rehearsal: the restored database file takes the
backup's mode 0600 (owner root) — harmless for a `User=root` unit, which S2 required.

R3. Restore every location file from the backup (atomic; bytes, mode and owner):
```bash
( W=/root/luqen-rotation; . "$W/vars"; "$NODE" "$W/rotate-helper.mjs" restore "$W" )
```
Expected: one `restored <file>: bytes+mode+owner match` line per location, then `RESTORE: PASS`.
**STOP, leave the unit stopped, escalate** on `RESTORE: FAIL`.

R4. `daemon-reload` — the P6 block (expect `NeedDaemonReload=no`).

R5. Run the [verification window](#verification-window) again (V1–V4) — now against the OLD
values.

R6. **If the post-rollback verification fails:** stop the unit (B5 block), LEAVE IT STOPPED, do
not re-apply anything, do not start a second rotation, keep `$W` and the database backup
untouched, and escalate with the full output of every step.

R7. Only after the post-rollback verification passes: [Cleanup](#cleanup) (it deletes the
location backups, the value files and the database backup).

### Cleanup

Only after a verification window has PASSED (after a procedure, or after a rollback). Until then,
`$W` and the database backup are the only way back.

```bash
( W=/root/luqen-rotation; . "$W/vars"
  echo "stray helper temp files: $(cut -f2 "$W/locations" | xargs -r -n1 dirname | sort -u | xargs -r -I{} find {} -maxdepth 1 -name '.*.rotate-*' | wc -l)"
  if [ -s "$W/db-backup-path" ]; then rm -f -- "$(cat "$W/db-backup-path")"; echo "database backup deleted: $(test -e "$(cat "$W/db-backup-path")" && echo NO || echo yes)"; fi
  rm -rf -- "$W"
  echo "work dir deleted: $(test -e "$W" && echo NO || echo yes)" )
```
Expected: `stray helper temp files: 0`, `database backup deleted: yes` (B/C only), `work dir
deleted: yes`. `$W` held the old and new values, the location backups (with old values), the
API-key header, the cookie jar and the CSRF token — all go with it. A non-zero stray count means a
helper run was interrupted: delete those `.<name>.rotate-*` files by hand (they are never the live
file). No `/tmp` file is created by this runbook.

### `rekey-at-rest` exit codes

| Code | Meaning |
|------|---------|
| 0 | Success: a dry-run reported cleanly, or `--apply` / `--rollback` wrote successfully. A dry-run against a database the dashboard has open also exits 0 and prints `database in use — --apply would refuse`. |
| 1 | Usage or argument error — nothing was touched (missing/invalid `--old-key-env`/`--new-key-env` name, a key variable unset/empty/shorter than 32 characters, old and new keys identical, database file not found, `--rollback` backup missing or without a valid SQLite header, `--rollback` combined with `--apply`). |
| 2 | Decrypt failures — refused before any write (wrong old key, missing salt row, malformed or default-salt values). Dry-run or apply. |
| 3 | Database in use — `--apply` / `--rollback` only: another connection (the dashboard, a shell, another CLI run) holds the database. A dry-run never exits 3. |
| 4 | `--apply` passed the pre-flight check but failed during write and rolled back — zero writes landed. |

---

## Admin recovery

If you are locked out of the dashboard (forgot password, no working admin accounts):

### Method 1: API key login

1. Open the login page
2. Click "Sign in with API key" (collapsible section in team/enterprise mode)
3. Enter your master API key

### Method 2: Setup API

```bash
curl -X POST http://localhost:5000/api/v1/setup \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "NewSecurePass!", "role": "admin"}'
```

This creates a new admin account. Works regardless of auth mode.

### Method 3: Database reset

As a last resort, delete the dashboard database file and restart. This resets all users, roles, and settings but preserves scan data (stored in report JSON files).

---

## SSO security (Enterprise mode)

When using the Entra ID SSO plugin:

### Token validation

- ID tokens are validated for signature, expiry, audience, and issuer
- Group claims are extracted from the token (up to 200 groups) or via Microsoft Graph API
- Role mapping is configured in the plugin settings

### IdP group → team sync

When configured, Luqen automatically syncs IdP group memberships to dashboard teams at login:

| Setting | Default | Description |
|---------|---------|-------------|
| `groupClaimName` | `groups` | JWT claim containing group IDs |
| `groupMapping` | `{}` | JSON map: IdP group ID → dashboard team name |
| `autoCreateTeams` | `true` | Create teams automatically if they don't exist |
| `syncMode` | `additive` | `additive` = only add memberships; `mirror` = add and remove |

**Recommendation:** Start with `additive` mode. Switch to `mirror` only after verifying the group mapping is complete and correct.

### SSO checklist

- [ ] Redirect URI registered in Azure portal matches the dashboard callback URL
- [ ] Client secret is stored encrypted (Luqen uses AES-256-GCM for plugin config)
- [ ] Token signing keys are rotated by the IdP (Entra does this automatically)
- [ ] Group claim is enabled in the app registration (Token Configuration > Add groups claim)
- [ ] Fallback password login is tested and working (in case SSO is unavailable)

---

## Network security

### Recommended deployment

```
Internet → Reverse Proxy (nginx/Caddy) → Luqen Dashboard (:5000)
                                        → pa11y Webservice (:3000)
                                        → Compliance Service (:4000)
```

### Checklist

- [ ] Dashboard is behind a reverse proxy with TLS termination
- [ ] Internal services (pa11y, compliance) are not exposed to the internet
- [ ] CORS headers are configured on the reverse proxy if the API is accessed from a different origin
- [ ] Rate limiting is enabled (built-in for login; configure at reverse proxy for API endpoints)
- [ ] HTTP security headers are set by the reverse proxy: `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Content-Security-Policy`

---

## Audit log

Luqen includes a built-in audit log that records security-relevant actions in the dashboard database via the `AuditRepository` (part of the StorageAdapter). Audit entries are queryable from the admin UI at **Admin > Audit Log** and via the GraphQL API (`auditLog` query, requires `audit.view` permission).

### Logged events

| Category | Events |
|----------|--------|
| **Authentication** | Login success, login failure, logout |
| **User management** | User created, deleted, activated, deactivated, role changed, password reset |
| **API keys** | Key created, deactivated, deleted |
| **Plugins** | Installed, configured, activated, deactivated, removed |
| **Scans** | Scan created, completed, failed, deleted |
| **Roles** | Role created, updated, deleted |
| **System** | Organisation created/deleted, settings changed |

### Additional recommendations

For environments requiring extended audit trails:

1. **Enable structured logging** — set `NODE_ENV=production` for JSON log output
2. **Forward logs to a SIEM** — ship Fastify request logs to Splunk, ELK, or similar
3. **Set up alerts for:**
   - Multiple failed login attempts from the same IP
   - API key creation outside business hours
   - Role escalation (user → admin)
   - Plugin installation events

---

## Security checklist for new deployments

Before going live, verify:

- [ ] `DASHBOARD_SESSION_SECRET` is set to a strong random value (min 32 bytes)
- [ ] First-start API key is saved securely and the server log is purged
- [ ] At least one admin user account is created (to exit solo mode)
- [ ] Non-admin users have appropriate roles assigned (not all admins)
- [ ] Dashboard is served over HTTPS (via reverse proxy)
- [ ] Internal services are not publicly accessible
- [ ] Rate limiting is active on the login endpoint
- [ ] CSRF protection is enabled (built-in, on by default)
- [ ] Plugin secrets (SMTP passwords, OAuth secrets) are configured through the UI (encrypted at rest)
- [ ] Unused API keys are deactivated
- [ ] Webhook secrets are configured for HMAC signature verification
- [ ] Backup strategy is in place for the SQLite database
- [ ] SSRF protection is active (built-in, blocks private/internal IPs on scan URLs)
- [ ] Per-installation encryption salt has been generated (automatic on first start)
- [ ] Audit log is monitored for suspicious activity

---

*See also: [Dashboard Administration Guide](dashboard-admin.md) | [Deployment Guide](../deployment/README.md)*
