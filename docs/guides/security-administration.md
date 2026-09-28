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

Scan target URLs are validated before being submitted to the pa11y webservice. Private and internal IP ranges are blocked to prevent the scanner from being used as a proxy to reach internal services:

- RFC 1918 private addresses (10.x, 172.16-31.x, 192.168.x)
- Loopback (127.x)
- Link-local (169.254.x)
- Other reserved ranges

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

**Audience: an agent operator.** Every step below is a fenced command block with its expected
output and an explicit STOP condition — this document is written to be executed cold by an
agent, not read by a person. Substitute `<env-file>`, `<unit>`, `<install-dir>` and `<port>` for
your deployment's real values (this document never names an internal host). No block records a
"pass" without first observing the output that justifies it.

**Background:** on 2026-09-28, rotating `DASHBOARD_SESSION_SECRET` alone crash-looped a live
dashboard for 48 seconds with `Failed to start server: Unsupported state or unable to
authenticate data`, because the session secret doubled as the AES key for four at-rest stores. As
of this plan, that is no longer true — but only if `DASHBOARD_ENCRYPTION_KEY` is pinned
**before** the session secret is rotated (Procedure A, step 0).

### What each secret protects

| Secret | Protects | Rotation consequence |
|--------|----------|----------------------|
| `DASHBOARD_SESSION_SECRET` | Session cookies (`@fastify/secure-session`) | Every logged-in user is logged out. Nothing else. |
| `DASHBOARD_ENCRYPTION_KEY` | The four at-rest stores by name: `oauth_signing_keys.encrypted_private_key_pem`, `service_connections.client_secret_encrypted`, `developer_credentials.encrypted_token`, `plugins.config` secret fields | Existing encrypted values become unreadable UNLESS re-keyed first with `rekey-at-rest --apply` (below). This is the crash this runbook exists to prevent. |
| `UNSUBSCRIBE_SECRET` | Outstanding unsubscribe links already sent to recipients | Rotating it invalidates every unsubscribe link already in an inbox. It is NOT tied to either dashboard key (by design — F-1: if `UNSUBSCRIBE_SECRET` and `SESSION_SECRET` are both unset, the installer's `DASHBOARD_SESSION_SECRET`-only env does not satisfy it, and minting an unsubscribe link throws; this is a reported, unfixed finding, not addressed by either procedure below). |
| The installation salt (`dashboard_settings.encryption_salt`) | Combined with `DASHBOARD_ENCRYPTION_KEY` to derive the actual AES key | **Never rotate by hand.** It is generated once, automatically, on first start, and every at-rest value is tied to it. There is no supported salt-rotation procedure — rotating the salt without re-encrypting every value is equivalent to losing the data. |

### Procedure A — rotate the session secret only (logout only, no re-keying)

**Step 0 (mandatory precondition):** if `DASHBOARD_ENCRYPTION_KEY` is unset in `<env-file>`, pin
it to the CURRENT `DASHBOARD_SESSION_SECRET` value first, restart, and verify — so the at-rest
key does not silently move when you change the session secret next.

```bash
grep -q '^DASHBOARD_ENCRYPTION_KEY=' <env-file> && echo "already pinned" || \
  echo "DASHBOARD_ENCRYPTION_KEY=$(grep '^DASHBOARD_SESSION_SECRET=' <env-file> | cut -d= -f2-)" >> <env-file>
```
Expected output: `already pinned`, or nothing (the `echo >>` line succeeds silently). **STOP** if
`DASHBOARD_SESSION_SECRET` cannot be read from `<env-file>` — do not invent a value.

Restart `<unit>` and run the [verification window](#verification-window) below before continuing.
**STOP** if verification fails — do not proceed to rotate the session secret over a broken pin.

**Announce the logout to users first** — every active session ends the moment the new secret is
live.

1. Generate the new value:
   ```bash
   umask 077; openssl rand -base64 32 > /tmp/new-session-secret
   ```
   Expected output: none (file created, mode 600). **STOP** if `openssl` is unavailable.
2. Replace `DASHBOARD_SESSION_SECRET` in `<env-file>` atomically:
   ```bash
   NEW=$(cat /tmp/new-session-secret); TMP=$(mktemp); \
   awk -v v="$NEW" '/^DASHBOARD_SESSION_SECRET=/{print "DASHBOARD_SESSION_SECRET="v; next}{print}' <env-file> > "$TMP" && \
   mv "$TMP" <env-file>
   ```
   Expected output: none. **STOP** if the file does not contain exactly one
   `DASHBOARD_SESSION_SECRET=` line afterward — an `awk` count check before trusting the write:
   ```bash
   test "$(grep -c '^DASHBOARD_SESSION_SECRET=' <env-file>)" = "1" && echo "one line, ok" || echo "STOP: wrong count"
   ```
3. Restart `<unit>` and run the [verification window](#verification-window) below.
4. Delete the temp file: `rm -f /tmp/new-session-secret`.

### Procedure B — rotate the at-rest encryption key

This is the procedure the 2026-09-28 incident needed and did not have. It re-encrypts every
stored at-rest value under a new key before the new key becomes the one the running dashboard
reads.

1. Generate the new key into a 0600 file, never echoed:
   ```bash
   umask 077; openssl rand -base64 32 > /tmp/new-encryption-key
   ```
   Expected output: none. **STOP** if `openssl` is unavailable.
2. Load the current and new values into the shell environment (never into argv):
   ```bash
   set -a; source <env-file>; NEW_DASHBOARD_ENCRYPTION_KEY=$(cat /tmp/new-encryption-key); set +a
   ```
   Expected output: none. **STOP** if `<env-file>` does not define `DASHBOARD_ENCRYPTION_KEY` —
   run Procedure A's step 0 first.
3. Dry-run (read-only; safe to run WHILE the dashboard is still up — DEC-3):
   ```bash
   luqen-dashboard rekey-at-rest --config <install-dir>/dashboard.config.json \
     --old-key-env DASHBOARD_ENCRYPTION_KEY --new-key-env NEW_DASHBOARD_ENCRYPTION_KEY
   ```
   Expected output: `mode: dry-run`, `ok: true`, per-store `count=`/`skipped=` lines, exit code 0.
   **STOP** on any non-zero exit code and read the printed `failures:` lines. A `default-salt`
   classification (F-3: a CLI-configured plugin secret) is an OWNER DECISION — do not proceed
   past it without a decision from the owner. A `wrong-key-or-tampered` or `malformed` failure
   means `DASHBOARD_ENCRYPTION_KEY` in `<env-file>` does not match what is actually stored — stop
   and investigate before generating a new key on top of an already-wrong one.
4. **Announce the downtime**, then stop the dashboard:
   ```bash
   systemctl stop <unit>
   ```
   Expected output: none. Confirm with `systemctl is-active <unit>` — expect `inactive` or
   `failed`. **STOP** if it still reports `active`.
5. Apply:
   ```bash
   luqen-dashboard rekey-at-rest --config <install-dir>/dashboard.config.json \
     --old-key-env DASHBOARD_ENCRYPTION_KEY --new-key-env NEW_DASHBOARD_ENCRYPTION_KEY --apply
   ```
   Expected output: `mode: apply`, `ok: true`, `wrote: true`, a `Backup written to: <path>` line,
   exit code 0. **Record `<path>` — it is needed for rollback.** STOP on any non-zero exit code;
   the command writes nothing on failure (verify-after-write, single transaction) — it is safe to
   re-run the dry-run to diagnose before trying again.
6. Set `DASHBOARD_ENCRYPTION_KEY` to the new value in `<env-file>`, atomically (same
   temp-file-then-rename pattern as Procedure A step 2, substituting
   `DASHBOARD_ENCRYPTION_KEY=$NEW_DASHBOARD_ENCRYPTION_KEY`).
7. Start the unit:
   ```bash
   systemctl start <unit>
   ```
8. Run the [verification window](#verification-window) below. **STOP** and roll back (see
   [Rollback](#rollback) below) if verification fails.
9. Only after verification passes, delete the backup — it holds every at-rest value encrypted
   under the OLD (now-retired) key:
   ```bash
   rm -f "<path from step 5>"; rm -f /tmp/new-encryption-key
   ```

### Procedure C — rotate both at once (an exposed secret)

Use this when the session secret AND the encryption key must both change in one maintenance
window (e.g. a suspected leak of both). Run Procedure B steps 1-6 first (dry-run, stop, apply,
pin the new encryption key), then ALSO update `DASHBOARD_SESSION_SECRET` in the same edit to
`<env-file>` before starting the unit — one stop/apply/start cycle, both new values live
together. Run the [verification window](#verification-window) once, at the end.

### Verification window

Run ALL of the following. **STOP and roll back** if any check fails — do not proceed to delete
a backup or announce success on a partial pass.

1. Record the restart count before touching anything further:
   ```bash
   systemctl show -p NRestarts <unit>
   ```
2. Wait at least 60 seconds, then confirm it did not crash-loop:
   ```bash
   sleep 60; systemctl show -p NRestarts <unit>
   ```
   Expected: identical to the value recorded before. **STOP** if it increased.
3. Query `/health` — this is the decrypt-dependent check (PBH-D): it decrypts every stored
   at-rest value once at startup, so a wrong key shows up here even if the process itself stayed
   up.
   ```bash
   curl -fsS http://127.0.0.1:<port>/health
   ```
   Expected: `"status":"ok"` and `"checks":{"atRestEncryption":{"status":"ok"}, ...}`. **STOP** if
   `atRestEncryption.status` is `"failed"` — that is the signal this whole runbook exists to
   surface. (`"empty"` is fine on a brand-new installation with no at-rest data yet.)
4. Confirm login still works:
   ```bash
   curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/login
   ```
   Expected: `200`. **STOP** otherwise.

### Rollback

Only for Procedure B/C, and only if verification failed above.

1. Stop the unit: `systemctl stop <unit>`.
2. Restore the at-rest data from the backup taken in Procedure B step 5:
   ```bash
   luqen-dashboard rekey-at-rest --config <install-dir>/dashboard.config.json --rollback "<backup path>"
   ```
   Expected: `Rollback complete: the database has been restored from the backup.`, exit code 0.
   **STOP** if it exits 3 (database still in use — confirm the unit is really stopped) or exits 1
   (bad backup path or corrupt header — do not proceed; escalate).
3. Restore the OLD values of `DASHBOARD_ENCRYPTION_KEY` (and `DASHBOARD_SESSION_SECRET`, for
   Procedure C) in `<env-file>`.
4. Start the unit and re-run the [verification window](#verification-window).

### `rekey-at-rest` exit codes

| Code | Meaning |
|------|---------|
| 0 | Success (dry-run reported cleanly, or apply/rollback wrote successfully) |
| 1 | Usage or argument error — nothing was touched (bad env var name/value, missing backup path, corrupt backup header) |
| 2 | Decrypt failures — refused before any write (wrong old key, missing salt row, malformed or default-salt values) |
| 3 | Database in use — another connection (the dashboard, a shell, another CLI invocation) holds the database open; `--apply`/`--rollback` refuse, `--dry-run` reports it and continues read-only |
| 4 | Apply passed the pre-flight check but failed during write and rolled back — zero writes landed |

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
