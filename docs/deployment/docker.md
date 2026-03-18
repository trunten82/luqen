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
export DASHBOARD_SESSION_SECRET="$(openssl rand -base64 32)"

# Start all services
docker compose up -d
```

Services:
- `luqen-compliance` on port **4000** (REST API + MCP)
- `luqen-dashboard` on port **5000** (Web UI)

The dashboard container runs `luqen-dashboard migrate` automatically on first start.

For pa11y webservice, run it separately and point `LUQEN_WEBSERVICE_URL` at it:

```bash
docker run -d --name pa11y-webservice -p 3000:3000 luqen/webservice:latest
```

---

## Environment variables

Create a `.env` file in the monorepo root:

```bash
# Pa11y webservice
LUQEN_WEBSERVICE_URL=http://host.docker.internal:3000

# Compliance service
COMPLIANCE_DB_PATH=/data/compliance.db
COMPLIANCE_PORT=4000

# Dashboard
DASHBOARD_PORT=5000
DASHBOARD_COMPLIANCE_URL=http://compliance:4000
DASHBOARD_WEBSERVICE_URL=http://host.docker.internal:3000
DASHBOARD_REPORTS_DIR=/app/reports
DASHBOARD_DB_PATH=/app/data/dashboard.db
DASHBOARD_SESSION_SECRET=<min 32 random bytes>
DASHBOARD_COMPLIANCE_CLIENT_ID=dashboard
DASHBOARD_COMPLIANCE_CLIENT_SECRET=<client secret>

# Optional: multi-worker scaling (comma-separated additional webservice URLs)
# DASHBOARD_WEBSERVICE_URLS=http://pa11y-2:3000,http://pa11y-3:3000

# Optional: test runner (htmlcs or axe)
# DASHBOARD_SCANNER_RUNNER=htmlcs

# Optional: max pages per full-site scan (1-1000, default 50)
# DASHBOARD_MAX_PAGES=50
```

Note: use the Docker Compose service name (`compliance`) instead of `localhost` for inter-service communication.

---

## Volumes

| Volume | Mount path | Purpose |
|--------|------------|---------|
| `compliance-data` | `/data` | Compliance SQLite database and JWT keys |
| `dashboard-data` | `/app/data` | Dashboard SQLite database |
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
