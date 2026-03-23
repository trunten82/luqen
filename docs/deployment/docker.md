[Docs](../README.md) > [Installation](./) > Docker

# Docker Installation

Run all luqen services with Docker Compose.

---

## Prerequisites

- Docker 24+ or Docker Desktop
- Docker Compose v2

---

## Quick start

The monorepo `docker-compose.yml` starts the compliance service and dashboard together:

```bash
# Set the required session secret
export SESSION_SECRET="$(openssl rand -base64 32)"

# Start all services
docker compose up -d
```

Services:
- `compliance` on port **4000** (REST API + MCP)
- `dashboard` on port **5000** (Web UI)

The compliance container automatically generates JWT keys and seeds baseline data on first start. The scanner uses the pa11y library directly inside the container — no external pa11y-webservice is needed.

If you have an existing pa11y-webservice you want to use instead, set `PA11Y_URL` in your environment or `.env` file for backward compatibility:

```bash
PA11Y_URL=http://your-pa11y:3000 docker compose up -d
```

---

## Environment variables

Create a `.env` file in the monorepo root:

```bash
# Required
SESSION_SECRET=<min 32 random bytes>

# Compliance service (optional overrides)
# COMPLIANCE_PORT=4000

# Dashboard (optional overrides)
# DASHBOARD_PORT=5000

# Optional: external pa11y-webservice (only if you have an existing one)
# PA11Y_URL=http://host.docker.internal:3000

# Optional: test runner (htmlcs or axe)
# DASHBOARD_SCANNER_RUNNER=htmlcs

# Optional: max pages per full-site scan (1-1000, default 50)
# DASHBOARD_MAX_PAGES=50
```

The `docker-compose.yml` handles inter-service wiring automatically (the dashboard connects to the compliance service at `http://compliance:4000`). No `LUQEN_WEBSERVICE_URL` or `DASHBOARD_WEBSERVICE_URL` is needed unless you are using an external pa11y-webservice.

---

## Storage

The dashboard uses **SQLite** as its default storage adapter. All dashboard data (scans, users, roles, plugins, etc.) is stored in a single file at `DASHBOARD_DB_PATH` (default: `/app/data/dashboard.db` inside the container). No external database is required.

For production Docker deployments, ensure the SQLite database file is on a persistent volume (see below). PostgreSQL and MongoDB storage adapters are planned as plugins (`@luqen/plugin-storage-postgres`, `@luqen/plugin-storage-mongodb`) for deployments that need a shared database across multiple containers.

---

## Volumes

| Volume | Mount path | Purpose |
|--------|------------|---------|
| `compliance-data` | `/data` | Compliance SQLite database and JWT keys |
| `dashboard-data` | `/app/data` | Dashboard SQLite database (`dashboard.db`) — persistent mount recommended |
| `dashboard-reports` | `/app/reports` | Generated scan reports |

Ensure volumes are persisted across restarts. For production, use named volumes or bind mounts to a backed-up directory.

---

## Compliance service Dockerfile

If building the compliance image from source (`packages/compliance`):

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/compliance/package.json ./packages/compliance/
RUN npm ci --workspace=packages/compliance

COPY packages/compliance/ ./packages/compliance/
COPY tsconfig.base.json ./

WORKDIR /app/packages/compliance
RUN npm run build

FROM node:20-alpine

WORKDIR /app
RUN addgroup -S compliance && adduser -S compliance -G compliance

COPY --from=builder /app/packages/compliance/dist ./dist
COPY --from=builder /app/packages/compliance/src/seed ./src/seed
COPY --from=builder /app/packages/compliance/node_modules ./node_modules
COPY --from=builder /app/packages/compliance/package.json ./package.json

RUN mkdir -p /data /keys && chown -R compliance:compliance /data /keys /app
USER compliance

VOLUME ["/data", "/keys"]
EXPOSE 4000

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["serve"]
```

---

## First-run setup

On first start, seed the compliance data:

```bash
# Wait for the compliance service to be healthy
docker compose exec compliance node dist/cli.js seed

# Create a dashboard OAuth client
docker compose exec compliance node dist/cli.js clients create \
  --name "dashboard" --scope "admin" --grant password

# Create a user to log into the dashboard
docker compose exec compliance node dist/cli.js users create \
  --username admin --role admin --password "your-password"
```

---

## Health checks

```bash
# Compliance service
curl http://localhost:4000/api/v1/health

# Dashboard (redirects to login when healthy)
curl -I http://localhost:5000
```

---

## SMTP access for email reports

If the dashboard is behind a firewall, ensure outbound access to your SMTP server's port (typically 587 or 465). No inbound ports are needed — the dashboard initiates the connection. When using Docker, the default bridge network allows outbound traffic; no extra `docker-compose.yml` changes are required unless your host firewall blocks outgoing SMTP.

---

## Reverse proxy

For production behind nginx, add to your server block:

```nginx
location /compliance/ {
    proxy_pass http://localhost:4000/;
    proxy_set_header Host $host;
}

location / {
    proxy_pass http://localhost:5000;
    proxy_set_header Host $host;

    # Required for SSE progress streaming
    proxy_buffering off;
    add_header X-Accel-Buffering no;
}
```

---

*See also: [installation/kubernetes.md](kubernetes.md) | [installation/cloud.md](cloud.md) | [configuration/compliance.md](../configuration/compliance.md) | [configuration/dashboard.md](../configuration/dashboard.md)*
