# Docker Deployment — Luqen

This guide covers deploying the Luqen using Docker and Docker Compose.

---

## Prerequisites

- Docker 24+ and Docker Compose v2
- The monorepo cloned locally: `git clone https://github.com/trunten82/luqen.git`
- A pa11y webservice instance (external — not provided by this compose file). [pa11y-webservice on Docker Hub](https://hub.docker.com/r/pa11y/pa11y-webservice).

---

## Quick Start

```bash
cd /path/to/luqen

# Generate a session secret (required)
export DASHBOARD_SESSION_SECRET="$(openssl rand -base64 32)"

# Start compliance service and dashboard
docker compose up -d
```

Services started:

| Service | Container | Port |
|---------|-----------|------|
| Compliance service | `luqen-compliance` | 4000 |
| Dashboard | `luqen-dashboard` | 5000 |

Open `http://localhost:5000` and log in with a user account registered in the compliance service.

---

## docker-compose.yml

The root `docker-compose.yml` defines both services:

```yaml
services:
  compliance:
    build:
      context: .
      dockerfile: packages/compliance/Dockerfile
    container_name: luqen-compliance
    ports:
      - "4000:4000"
    volumes:
      - compliance-data:/app/data
      - compliance-keys:/app/keys
    environment:
      - COMPLIANCE_PORT=4000
      - COMPLIANCE_DB_PATH=/app/data/compliance.db
      - COMPLIANCE_JWT_PRIVATE_KEY=/app/keys/private.pem
      - COMPLIANCE_JWT_PUBLIC_KEY=/app/keys/public.pem
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider",
             "http://localhost:4000/api/v1/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  dashboard:
    build:
      context: .
      dockerfile: packages/dashboard/Dockerfile
    container_name: luqen-dashboard
    ports:
      - "5000:5000"
    volumes:
      - dashboard-data:/app/data
      - dashboard-reports:/app/reports
    environment:
      - DASHBOARD_PORT=5000
      - DASHBOARD_COMPLIANCE_URL=http://compliance:4000
      - DASHBOARD_WEBSERVICE_URL=${LUQEN_WEBSERVICE_URL:-http://host.docker.internal:3000}
      - DASHBOARD_REPORTS_DIR=/app/reports
      - DASHBOARD_DB_PATH=/app/data/dashboard.db
      - DASHBOARD_SESSION_SECRET=${DASHBOARD_SESSION_SECRET}
    depends_on:
      compliance:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider",
             "http://localhost:5000/health"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  compliance-data:
  compliance-keys:
  dashboard-data:
  dashboard-reports:
```

The dashboard container waits for the compliance service to pass its health check before starting (`depends_on: condition: service_healthy`).

---

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `DASHBOARD_SESSION_SECRET` | Cookie signing secret. **Minimum 32 bytes. Must be set.** Generate with `openssl rand -base64 32`. |

### Optional with defaults

| Variable | Default | Description |
|----------|---------|-------------|
| `DASHBOARD_PORT` | `5000` | Port inside the container |
| `DASHBOARD_COMPLIANCE_URL` | `http://compliance:4000` | Internal service name — do not change for compose deployments |
| `DASHBOARD_WEBSERVICE_URL` | `http://host.docker.internal:3000` | URL of your pa11y webservice |
| `DASHBOARD_REPORTS_DIR` | `/app/reports` | Report storage — backed by the `dashboard-reports` volume |
| `DASHBOARD_DB_PATH` | `/app/data/dashboard.db` | SQLite path — backed by the `dashboard-data` volume |
| `DASHBOARD_MAX_CONCURRENT_SCANS` | `2` | Max parallel scans |
| `DASHBOARD_COMPLIANCE_CLIENT_ID` | — | OAuth2 client ID for the dashboard |
| `DASHBOARD_COMPLIANCE_CLIENT_SECRET` | — | OAuth2 client secret |

### Using a `.env` file

Create a `.env` file at the repo root (never commit this file):

```dotenv
DASHBOARD_SESSION_SECRET=your-random-secret-here-must-be-32-bytes
LUQEN_WEBSERVICE_URL=http://my-pa11y-webservice:3000
DASHBOARD_COMPLIANCE_CLIENT_ID=dashboard
DASHBOARD_COMPLIANCE_CLIENT_SECRET=your-client-secret
```

Docker Compose automatically loads `.env` from the same directory as `docker-compose.yml`.

---

## Volumes

| Volume | Mount point | Contents |
|--------|-------------|---------|
| `compliance-data` | `/app/data` (compliance) | Compliance SQLite database |
| `compliance-keys` | `/app/keys` (compliance) | JWT signing key pair |
| `dashboard-data` | `/app/data` (dashboard) | Dashboard SQLite database |
| `dashboard-reports` | `/app/reports` (dashboard) | Generated JSON and HTML scan reports |

**Important:** Do not delete these volumes between restarts. The compliance service JWT keys must persist; if `compliance-keys` is deleted, all existing sessions become invalid.

---

## Dockerfile

The dashboard uses a multi-stage build to keep the production image small:

```
Stage 1 (builder): node:20-slim
  - Install workspace dependencies
  - Compile TypeScript
  - Copy views and static assets to dist/

Stage 2 (production): node:20-slim
  - Copy dist/ from builder
  - Copy node_modules from builder
  - EXPOSE 5000
  - CMD: migrate then serve
```

The container entrypoint runs `luqen-dashboard migrate` before starting the server, so schema updates apply automatically on container restart.

---

## First-Time Setup

On first startup the compliance service database is empty. Run these commands once after `docker compose up -d`:

```bash
# Wait for compliance service to be healthy
docker compose ps

# Generate JWT signing keys (one-time)
docker exec luqen-compliance node dist/cli.js keys generate

# Seed baseline data: 58 jurisdictions, 62 regulations
docker exec luqen-compliance node dist/cli.js seed

# Create an admin user
docker exec -it luqen-compliance node dist/cli.js users create \
  --username admin \
  --role admin

# Register the dashboard as an OAuth2 client
docker exec luqen-compliance node dist/cli.js clients create \
  --name dashboard \
  --scope admin \
  --grant password
# Note the client ID and secret printed — set them in your .env file
```

After updating `.env` with the client credentials, restart the dashboard:

```bash
docker compose restart dashboard
```

---

## Connecting to an External Pa11y Webservice

The dashboard uses the pa11y webservice for scanning. If you have an existing webservice, set `LUQEN_WEBSERVICE_URL` in your `.env`:

```dotenv
LUQEN_WEBSERVICE_URL=http://my-pa11y-host:3000
```

To run pa11y webservice in Docker alongside luqen services, add it to your `docker-compose.override.yml`:

```yaml
services:
  pa11y-webservice:
    image: pa11y/pa11y-webservice:latest
    ports:
      - "3000:3000"

  dashboard:
    environment:
      - DASHBOARD_WEBSERVICE_URL=http://pa11y-webservice:3000
```

---

## Production Considerations

### Reverse proxy

Run behind nginx or Caddy for TLS termination. Example nginx config:

```nginx
server {
    listen 443 ssl;
    server_name dashboard.example.com;

    ssl_certificate /etc/ssl/certs/dashboard.crt;
    ssl_certificate_key /etc/ssl/private/dashboard.key;

    location / {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # Required for SSE (scan progress)
        proxy_buffering off;
        proxy_read_timeout 3600s;
        add_header X-Accel-Buffering no;
    }
}
```

The `proxy_buffering off` directive is essential for SSE-based scan progress to work correctly.

### Secure cookies

In production the session cookie is set with `Secure: true` (HTTPS only). Ensure the dashboard is accessed via HTTPS at all times. For local development over HTTP you may set:

```dotenv
DASHBOARD_COOKIE_SECURE=false
```

### Scaling

The dashboard is single-tenant and not designed for horizontal scaling (the SQLite database and report files are local). For high availability, use a single instance with a robust volume backend (e.g. AWS EFS, Azure Files).

### Backup

Back up these volumes regularly:
- `compliance-data` — jurisdiction, regulation, user, and OAuth client data
- `compliance-keys` — JWT signing keys (loss invalidates all sessions)
- `dashboard-data` — scan history
- `dashboard-reports` — generated report files

Example backup command:

```bash
docker run --rm \
  -v luqen_dashboard-reports:/source \
  -v $(pwd)/backups:/dest \
  alpine tar czf /dest/reports-$(date +%Y%m%d).tar.gz -C /source .
```

---

## Updating

```bash
git pull origin master
docker compose build --no-cache
docker compose up -d
```

Schema migrations run automatically on container startup via the `migrate` command in the Dockerfile entrypoint.

---

## Troubleshooting

### Dashboard container exits immediately

Check logs:

```bash
docker compose logs dashboard
```

Common causes:
- `DASHBOARD_SESSION_SECRET` not set or shorter than 32 bytes.
- `DASHBOARD_COMPLIANCE_URL` unreachable (compliance container still starting).

### SSE progress page shows no updates behind a proxy

Add `proxy_buffering off;` to the nginx location block and ensure `X-Accel-Buffering: no` is sent. See the reverse proxy section above.

### Reports not visible after upgrade

If you changed `DASHBOARD_REPORTS_DIR` between deployments, the old report files are on the previous volume. The scan records in SQLite still reference the old paths. Mount the old volume at the new path, or re-scan the affected sites.

### Compliance service health check failing

```bash
docker compose logs compliance
docker exec luqen-compliance node dist/cli.js keys generate
docker exec luqen-compliance node dist/cli.js seed
docker compose restart compliance
```
