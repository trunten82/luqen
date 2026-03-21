[Docs](../README.md) > [Paths](./) > Full Dashboard

# Full Dashboard — Web UI Deployment

Composition path 6: all services with a browser interface for scans, reports, and administration.

---

## Prerequisites

- Docker and Docker Compose (recommended), or Node.js 20+
- pa11y webservice running and accessible from the host/containers

---

## Docker Compose quickstart

The monorepo includes a `docker-compose.yml` that starts Redis, the compliance service, and the dashboard.

```bash
git clone https://github.com/trunten82/pally-agent.git ~/pally-agent
cd ~/pally-agent

# Set required secrets
export DASHBOARD_SESSION_SECRET="$(openssl rand -base64 32)"
export PALLY_WEBSERVICE_URL=http://host.docker.internal:3000

# Start all services
docker compose up -d
```

This starts:

| Service | Port | Description |
|---------|------|-------------|
| `pally-redis` | 6379 | Optional cache, SSE pub/sub, scan queue |
| `pally-compliance` | 4000 | Compliance API with JWT auth |
| `pally-dashboard` | 5000 | Web UI |

The dashboard depends on the compliance service and waits for its health check before starting.

### Seed compliance data

```bash
# Seed baseline data (58 jurisdictions, 62 regulations)
docker exec pally-compliance node dist/cli.js seed
```

### Environment variables

Key environment variables in `docker-compose.yml`:

| Variable | Default | Description |
|----------|---------|-------------|
| `DASHBOARD_PORT` | `5000` | Dashboard listen port |
| `DASHBOARD_COMPLIANCE_URL` | `http://compliance:4000` | Compliance service URL (container name) |
| `DASHBOARD_WEBSERVICE_URL` | `http://host.docker.internal:3000` | pa11y webservice URL |
| `DASHBOARD_SESSION_SECRET` | (must set) | Session encryption key (32+ bytes) |
| `COMPLIANCE_PORT` | `4000` | Compliance API listen port |

Uncomment `DASHBOARD_REDIS_URL` and `COMPLIANCE_REDIS_URL` in `docker-compose.yml` to enable Redis for caching, SSE pub/sub, and scan queuing.

---

## Manual setup (without Docker)

```bash
git clone https://github.com/trunten82/pally-agent.git ~/pally-agent
cd ~/pally-agent && npm install && npm run build --workspaces
```

### Start compliance service

```bash
cd ~/pally-agent/packages/compliance
node dist/cli.js keys generate
node dist/cli.js seed
node dist/cli.js serve
# Listening on port 4000
```

### Start dashboard

```bash
cd ~/pally-agent/packages/dashboard
DASHBOARD_PORT=5000 \
  DASHBOARD_COMPLIANCE_URL=http://localhost:4000 \
  DASHBOARD_WEBSERVICE_URL=http://localhost:3000 \
  DASHBOARD_SESSION_SECRET="$(openssl rand -base64 32)" \
  node dist/cli.js serve
```

On first start, an API key is printed to the console. This is your default login credential (solo mode).

---

## Authentication Modes

The dashboard uses progressive authentication — start simple and add security as your needs grow:

| Mode | Activates when | Login method |
|------|----------------|--------------|
| **Solo** | First start (default) | API key printed to console. No password needed. |
| **Team** | First user created via dashboard | Username + password (bcrypt hashed, stored in dashboard SQLite) |
| **Enterprise** | SSO plugin installed and activated | SSO button on login page (e.g. Azure Entra ID via OIDC) |

All three modes coexist — API key access remains available for programmatic use even after team or enterprise mode activates. Regenerate the API key with `pally-dashboard api-key regenerate`.

See [Enterprise SSO](enterprise-sso.md) for the Azure Entra ID setup guide.

---

## First login

**Solo mode (default):** Open `http://localhost:5000`. The API key printed on first start is accepted automatically — no login form required.

**Team mode:** Open `http://localhost:5000` and log in with the credentials of a user created via the dashboard admin page.

**Enterprise mode:** Open `http://localhost:5000` and click the SSO button for your identity provider.

---

## Run a scan from the UI

1. Click **New Scan** in the sidebar
2. Enter the target URL
3. Select jurisdictions for compliance checking
4. Choose WCAG standard (default: WCAG2AA)
5. Click **Start Scan**

The progress page shows real-time updates via Server-Sent Events. When complete, the browser redirects to the report viewer with the compliance matrix, issue list, and template deduplication.

---

## Managing Plugins

The dashboard supports plugins for authentication (SSO), notifications, storage, and custom scanners. Manage plugins from **Settings > Plugins** in the dashboard UI.

### Installing a plugin

1. Go to **Settings > Plugins**
2. Browse the **Plugin Registry** tab to see available plugins (e.g., Azure Entra ID, Slack Notifications, AWS S3 Storage)
3. Click **Install** on the plugin you want
4. The plugin is downloaded and registered with `inactive` status

### Configuring a plugin

1. Click the installed plugin to open its settings
2. Fill in the configuration fields (e.g., webhook URL, API keys). Secret fields are encrypted with AES-256-GCM before storage.
3. Click **Save**

### Activating and deactivating

- Click **Activate** to start the plugin. The system runs a health check to confirm it is working.
- Click **Deactivate** to stop the plugin without removing it.
- Active plugins are automatically re-activated on server restart.

### Removing a plugin

Click **Remove** to deactivate and uninstall the plugin completely.

### CLI and API alternatives

Plugins can also be managed via CLI (`pally-dashboard plugin install|configure|activate|deactivate|remove`) or REST API (`/api/v1/plugins/*`). See the [CLI reference](../reference/cli-reference.md) and [API reference](../reference/api-reference.md).

---

## Admin features

| Feature | Description |
|---------|-------------|
| **Org-wide accessibility score** | Aggregated 0-100 score across all scanned sites with trend tracking over time. Visible on the executive dashboard. |
| **Scan scheduling** | Configure daily, weekly, or monthly recurring scans from the dashboard UI. Manage at `/admin/schedules`. |
| **Teams** | Create teams at **Admin > Teams**, add/remove members, map IdP groups for SSO sync. Assign issues to teams or individuals. |
| **Issue assignment lifecycle** | Assign issues to users or teams via searchable dropdown. Track through open, assigned, in-progress, fixed, and verified states. Bulk assign with checkboxes. Delete assignments with confirmation. Inline status badges on assigned issues. |
| **Connected repos** | Link GitHub/GitLab repos to receive AI-generated fix proposals (21 suggestion types via MCP/A2A). Manage at `/admin/repos`. |
| **Role-based UX** | Four default personas (admin, developer, user, executive) with tailored navigation and default views. Custom roles supported. |
| **Roles management** | Customizable DB-driven roles with 15 granular permissions across 7 groups. Create custom roles, modify system role permissions. Admin > Roles (`/admin/roles`). |
| **Report comparison** | Side-by-side delta view with regression alerts when new issues appear between scans. |
| **Enhanced manual testing** | Step-by-step guides with annotated good/bad examples for each manual check criterion. |
| **UI polish** | Page transition animations, empty-state illustrations, and skeleton loading placeholders. |
| **User management** | Create, edit, delete Dashboard Users. Assign built-in or custom roles. |
| **Scan history** | Browse all past scans. Filter by URL, date, status. |
| **Report viewer** | Interactive HTML report with compliance matrix. |
| **Self-audit** | Run `pally-dashboard self-audit` to scan the dashboard itself. |
| **Health checks** | `/health` endpoint for load balancer probes. |
| **Trend tracking** | Line charts at `/reports/trends` showing error/warning/notice counts over time. Executive summary cards on the home page. |
| **Print/PDF export** | Print-optimized report view at `/reports/:id/print` for saving as PDF via browser Print dialog. |
| **Manual testing** | 27-item WCAG 2.1 AA checklist at `/reports/:id/manual` with pass/fail/NA recording per scan. |
| **Browser bookmarklet** | Drag-to-install bookmarklet at `/tools/bookmarklet` that pre-fills the scan form with the current page URL. |
| **Runner selection** | Choose between HTML_CodeSniffer and axe-core runners via scan form dropdown or `DASHBOARD_SCANNER_RUNNER` env var. |
| **Incremental scanning** | SHA-256 content hash delta detection — only re-scans pages whose content changed since the last scan. |
| **Multi-worker scaling** | Distribute scans across multiple pa11y webservice instances via `DASHBOARD_WEBSERVICE_URLS`. |
| **REST API** | 5 JSON endpoints for external data consumption (scans, issues, trends, compliance summary). Auth via `X-API-Key` header, rate limited 60/min. |
| **CSV export** | Download scans, issues, and trend data as CSV from the UI or via `/api/v1/export/*` endpoints. |
| **Email reports** | Scheduled email delivery of reports (daily/weekly/monthly) with PDF/CSV attachments, plus event notifications (`scan.complete`, `scan.failed`). Powered by `@pally-agent/plugin-notify-email` — install from **Admin > Plugins**, then create schedules at **Admin > Email Reports**. |
| **Power BI integration** | Connect Power BI to the data API using Web data source with `X-API-Key` header. See [API Reference](../reference/api-reference.md#power-bi-integration). |

---

## Useful commands

```bash
# View logs
docker compose logs -f

# Restart services
docker compose restart

# Stop everything
docker compose down

# Update and rebuild
cd ~/pally-agent && git pull && docker compose up -d --build
```

---

## Organization Management

When multi-tenancy is enabled, the dashboard provides organization management under **Settings > Organizations**.

| Action | How |
|--------|-----|
| **Create an organization** | Go to **Settings > Organizations** and click **New Organization**. Provide a name and optional description. |
| **Manage members** | Click an organization to view its members. Add users by username or email, and remove members from the member list. |
| **Switch organization** | Use the **org switcher** in the sidebar to change your active organization context. All scans, reports, and compliance data are scoped to the selected org. |
| **Data isolation** | Each organization's data is isolated at the query level. Users only see scans, reports, and compliance results belonging to their active organization. System-level seed data (jurisdictions, regulations) remains globally readable. |

For the full multi-tenancy setup guide, including API headers, data lifecycle, and administration, see [Multi-Tenant Guide](multi-tenant.md).

---

## Next steps

- Add regulatory monitoring: [Regulatory monitoring](regulatory-monitoring.md)
- Configure the dashboard: [configuration/dashboard.md](../configuration/dashboard.md)
- Dashboard admin guide: [guides/dashboard-admin.md](../guides/dashboard-admin.md)

---

*See also: [What is Pally Agent?](../getting-started/what-is-pally.md) | [One-line installer](../getting-started/one-line-install.md)*
