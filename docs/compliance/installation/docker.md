# Docker Installation

Run the Luqen Compliance Service in Docker with SQLite (single container) or with an external database.

## Prerequisites

- Docker 24+ or Docker Desktop
- Docker Compose v2

## Dockerfile

Create `Dockerfile` in `packages/compliance`:

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json ./
COPY packages/compliance/package.json ./packages/compliance/

# Install dependencies
RUN npm ci --workspace=packages/compliance

# Copy source
COPY packages/compliance/ ./packages/compliance/
COPY tsconfig.base.json ./

# Build
WORKDIR /app/packages/compliance
RUN npm run build

# ---- Runtime image ----
FROM node:20-alpine

WORKDIR /app

# Create non-root user
RUN addgroup -S compliance && adduser -S compliance -G compliance

# Copy built artifacts and production dependencies
COPY --from=builder /app/packages/compliance/dist ./dist
COPY --from=builder /app/packages/compliance/src/seed ./src/seed
COPY --from=builder /app/packages/compliance/node_modules ./node_modules
COPY --from=builder /app/packages/compliance/package.json ./package.json

# Create directories for data and keys
RUN mkdir -p /data /keys && chown -R compliance:compliance /data /keys /app

USER compliance

EXPOSE 4000

# Default: generate keys if missing, then serve
CMD ["node", "dist/cli.js", "serve"]
```

## docker-compose.yml

```yaml
version: "3.9"

services:
  compliance:
    build:
      context: .
      dockerfile: packages/compliance/Dockerfile
    image: luqen-compliance:latest
    container_name: luqen-compliance
    restart: unless-stopped
    ports:
      - "4000:4000"
    volumes:
      # SQLite database file persisted on host
      - compliance-data:/data
      # JWT key pair — generate with: docker run --rm -v ./keys:/keys luqen-compliance keys generate
      - ./keys:/keys:ro
    environment:
      COMPLIANCE_PORT: "4000"
      COMPLIANCE_HOST: "0.0.0.0"
      COMPLIANCE_DB_ADAPTER: "sqlite"
      COMPLIANCE_DB_PATH: "/data/compliance.db"
      COMPLIANCE_JWT_PRIVATE_KEY: "/keys/private.pem"
      COMPLIANCE_JWT_PUBLIC_KEY: "/keys/public.pem"
      COMPLIANCE_CORS_ORIGIN: "http://localhost:3000,https://your-frontend.example.com"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:4000/api/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

volumes:
  compliance-data:
```

## First-time setup

### Step 1: Generate JWT keys

```bash
# Create the keys directory
mkdir -p ./keys

# Generate keys using the container image
docker run --rm \
  -v "$(pwd)/keys:/app/keys" \
  luqen-compliance:latest \
  node dist/cli.js keys generate
```

The keys are written to `./keys/private.pem` and `./keys/public.pem`.

### Step 2: Build and start

```bash
docker compose up -d
```

### Step 3: Seed baseline data

```bash
# Create an admin OAuth client
docker compose exec compliance node dist/cli.js clients create \
  --name "setup" \
  --scope "read write admin" \
  --grant client_credentials
```

Note the `client_secret` from the output, then obtain a token and seed:

```bash
# Get admin token
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d "{\"grant_type\":\"client_credentials\",\"client_id\":\"REPLACE_CLIENT_ID\",\"client_secret\":\"REPLACE_SECRET\",\"scope\":\"admin\"}" \
  | jq -r '.access_token')

# Seed baseline
curl -X POST http://localhost:4000/api/v1/seed \
  -H "Authorization: Bearer $TOKEN"
```

Or seed directly via CLI:

```bash
docker compose exec compliance node dist/cli.js seed
```

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `COMPLIANCE_PORT` | HTTP port | `4000` |
| `COMPLIANCE_HOST` | Bind address | `0.0.0.0` |
| `COMPLIANCE_DB_ADAPTER` | Database: `sqlite`, `mongodb`, `postgres` | `sqlite` |
| `COMPLIANCE_DB_PATH` | SQLite file path | `./compliance.db` |
| `COMPLIANCE_DB_URL` | MongoDB/PostgreSQL connection string | — |
| `COMPLIANCE_JWT_PRIVATE_KEY` | Path to RS256 private key PEM | `./keys/private.pem` |
| `COMPLIANCE_JWT_PUBLIC_KEY` | Path to RS256 public key PEM | `./keys/public.pem` |
| `COMPLIANCE_CORS_ORIGIN` | Comma-separated allowed origins | `http://localhost:3000` |
| `COMPLIANCE_URL` | Public URL (for A2A agent card) | `http://localhost:4000` |

## Volume mounts

| Mount | Purpose | Permissions |
|-------|---------|-------------|
| `/data` | SQLite database storage | Read/write by `compliance` user |
| `/keys` | JWT key pair PEM files | Read-only in production |

## Using with MongoDB

Replace the `compliance` service environment in `docker-compose.yml`:

```yaml
services:
  mongo:
    image: mongo:7
    restart: unless-stopped
    volumes:
      - mongo-data:/data/db
    environment:
      MONGO_INITDB_DATABASE: compliance

  compliance:
    environment:
      COMPLIANCE_DB_ADAPTER: "mongodb"
      COMPLIANCE_DB_URL: "mongodb://mongo:27017/compliance"
      # Remove COMPLIANCE_DB_PATH
    depends_on:
      - mongo

volumes:
  mongo-data:
```

## Logs and health

```bash
# View logs
docker compose logs -f compliance

# Check health
curl http://localhost:4000/api/v1/health

# Exec into container
docker compose exec compliance sh
```

## Image tags and updates

```bash
# Rebuild after code changes
docker compose build compliance

# Restart with new image
docker compose up -d compliance
```
