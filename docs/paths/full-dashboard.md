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
git clone https://github.com/alanna82/pally-agent.git ~/pally-agent
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

### Seed and create OAuth client

```bash
# Seed baseline data (58 jurisdictions, 62 regulations)
docker exec pally-compliance node dist/cli.js seed

# Create an OAuth client for the dashboard
docker exec pally-compliance node dist/cli.js clients create \
  --name pally-dashboard --scope "read write"
```

Save the `client_id` and `client_secret` output.

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
git clone https://github.com/alanna82/pally-agent.git ~/pally-agent
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

### Create OAuth client

```bash
cd ~/pally-agent/packages/compliance
node dist/cli.js clients create --name pally-dashboard --scope "read write"
# Save client_id and client_secret
```

### Start dashboard

```bash
cd ~/pally-agent/packages/dashboard
DASHBOARD_PORT=5000 \
  DASHBOARD_COMPLIANCE_URL=http://localhost:4000 \
  DASHBOARD_WEBSERVICE_URL=http://localhost:3000 \
  DASHBOARD_COMPLIANCE_CLIENT_ID=$CLIENT_ID \
  DASHBOARD_COMPLIANCE_CLIENT_SECRET=$CLIENT_SECRET \
  DASHBOARD_SESSION_SECRET="$(openssl rand -base64 32)" \
  node dist/cli.js serve
```

---

## Create an admin user

The dashboard authenticates against the compliance service OAuth2 system. Create a user with the `admin` role:

```bash
cd ~/pally-agent/packages/compliance
node dist/cli.js users create --username admin --role admin
```

Or in Docker:
```bash
docker exec pally-compliance node dist/cli.js users create --username admin --role admin
```

---

## First login

1. Open `http://localhost:5000`
2. Log in with the admin credentials created above
3. The dashboard home shows recent scans and system status

---

## Run a scan from the UI

1. Click **New Scan** in the sidebar
2. Enter the target URL
3. Select jurisdictions for compliance checking
4. Choose WCAG standard (default: WCAG2AA)
5. Click **Start Scan**

The progress page shows real-time updates via Server-Sent Events. When complete, the browser redirects to the report viewer with the compliance matrix, issue list, and template deduplication.

---

## Admin features

| Feature | Description |
|---------|-------------|
| **User management** | Create, edit, delete users. Assign roles (admin, user). |
| **Scan history** | Browse all past scans. Filter by URL, date, status. |
| **Report viewer** | Interactive HTML report with compliance matrix. |
| **Self-audit** | Run `pally-dashboard self-audit` to scan the dashboard itself. |
| **Health checks** | `/health` endpoint for load balancer probes. |

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

## Next steps

- Add regulatory monitoring: [Regulatory monitoring](regulatory-monitoring.md)
- Configure the dashboard: [configuration/dashboard.md](../configuration/dashboard.md)
- Dashboard admin guide: [guides/dashboard-admin.md](../guides/dashboard-admin.md)

---

*See also: [What is Pally Agent?](../getting-started/what-is-pally.md) | [One-line installer](../getting-started/one-line-install.md)*
