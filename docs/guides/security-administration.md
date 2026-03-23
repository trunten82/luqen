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

Each dashboard installation generates a unique 32-byte random salt on first startup, stored in the `dashboard_settings` database table. This salt is combined with the `sessionSecret` when encrypting plugin configuration secrets (AES-256-GCM). Even if two installations share the same session secret, their encrypted data cannot be decrypted by the other installation.

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
