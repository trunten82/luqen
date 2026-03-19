# All-in-One: Running pally-agent + Compliance Service Together

Run both services in a single Docker Compose stack for a complete accessibility scanning and compliance checking environment.

## Architecture

```
User / CI Pipeline
      │
      ├── pally-agent (MCP + CLI)     → scans websites with pa11y
      │         │
      │         └── compliance-check  → annotates issues with legal context
      │
      └── compliance service (REST + MCP + A2A)
                │
                └── SQLite database
```

pally-agent calls the compliance service over the internal Docker network. Each service can also be accessed directly.

## Docker Compose

```yaml
version: "3.9"

services:
  # ---- Compliance Service ----
  compliance:
    build:
      context: .
      dockerfile: packages/compliance/Dockerfile
    image: pally-compliance:latest
    container_name: pally-compliance
    restart: unless-stopped
    ports:
      - "4000:4000"
    volumes:
      - compliance-data:/data
      - compliance-keys:/keys
    environment:
      COMPLIANCE_PORT: "4000"
      COMPLIANCE_HOST: "0.0.0.0"
      COMPLIANCE_DB_ADAPTER: "sqlite"
      COMPLIANCE_DB_PATH: "/data/compliance.db"
      COMPLIANCE_JWT_PRIVATE_KEY: "/keys/private.pem"
      COMPLIANCE_JWT_PUBLIC_KEY: "/keys/public.pem"
      COMPLIANCE_CORS_ORIGIN: "http://localhost:3000"
      COMPLIANCE_URL: "http://compliance:4000"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:4000/api/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # ---- Pally Agent ----
  pally-agent:
    build:
      context: .
      dockerfile: Dockerfile
    image: pally-agent:latest
    container_name: pally-agent
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - pally-reports:/reports
    environment:
      PALLY_WEBSERVICE_URL: "http://pa11y-webservice:3000"
      PALLY_COMPLIANCE_URL: "http://compliance:4000"
      PALLY_COMPLIANCE_CLIENT_ID: "${PALLY_COMPLIANCE_CLIENT_ID}"
      PALLY_COMPLIANCE_CLIENT_SECRET: "${PALLY_COMPLIANCE_CLIENT_SECRET}"
    depends_on:
      compliance:
        condition: service_healthy
      pa11y-webservice:
        condition: service_started

  # ---- Pa11y Webservice ----
  pa11y-webservice:
    image: ghcr.io/pa11y/pa11y-webservice:latest
    container_name: pa11y-webservice
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      PORT: "3000"
      DATABASE: "mongodb://mongo:27017/pa11y"
    depends_on:
      - mongo

  # ---- MongoDB for Pa11y ----
  mongo:
    image: mongo:7
    restart: unless-stopped
    volumes:
      - mongo-data:/data/db

volumes:
  compliance-data:
  compliance-keys:
  pally-reports:
  mongo-data:
```

## First-time setup

### Step 1: Generate JWT keys

```bash
# Run key generation inside the compliance container
docker compose run --rm compliance node dist/cli.js keys generate

# The keys are written to the compliance-keys volume
```

### Step 2: Start the stack

```bash
docker compose up -d
```

### Step 3: Seed compliance baseline

```bash
docker compose exec compliance node dist/cli.js seed
```

### Step 4: Create an OAuth client for pally-agent

```bash
docker compose exec compliance node dist/cli.js clients create \
  --name "pally-agent" \
  --scope "read" \
  --grant client_credentials
```

Copy the output `client_id` and `client_secret`.

### Step 5: Create the .env file

```bash
cat > .env <<EOF
PALLY_COMPLIANCE_CLIENT_ID=<client_id_from_step_4>
PALLY_COMPLIANCE_CLIENT_SECRET=<client_secret_from_step_4>
EOF
```

### Step 6: Verify

```bash
# Check compliance service
curl http://localhost:4000/api/v1/health

# Check pally-agent
curl http://localhost:3001/health

# Check pa11y webservice
curl http://localhost:3000/
```

## Pally-agent configuration

Create `.pally-agent.json` (mounted into the pally-agent container or in the project root):

```json
{
  "webserviceUrl": "http://pa11y-webservice:3000",
  "standard": "WCAG2AA",
  "concurrency": 3,
  "compliance": {
    "url": "http://compliance:4000",
    "clientId": "${PALLY_COMPLIANCE_CLIENT_ID}",
    "clientSecret": "${PALLY_COMPLIANCE_CLIENT_SECRET}",
    "jurisdictions": ["EU", "US", "UK"],
    "sectors": []
  }
}
```

The `compliance` section tells pally-agent to call the compliance service after each scan, enriching results with legal context.

## Accessing services

| Service | Internal URL | External URL |
|---------|-------------|-------------|
| Compliance REST API | `http://compliance:4000/api/v1` | `http://localhost:4000/api/v1` |
| Compliance Swagger UI | `http://compliance:4000/api/v1/docs` | `http://localhost:4000/api/v1/docs` |
| Compliance A2A card | `http://compliance:4000/.well-known/agent.json` | `http://localhost:4000/.well-known/agent.json` |
| Pa11y webservice | `http://pa11y-webservice:3000` | `http://localhost:3000` |
| Pally-agent API | `http://pally-agent:3001` | `http://localhost:3001` |

## Claude Code MCP config

To use both pally-agent and compliance MCP servers in Claude Code, add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "pally-agent": {
      "command": "node",
      "args": ["/absolute/path/pally-agent/dist/mcp.js"]
    },
    "pally-compliance": {
      "command": "node",
      "args": ["/absolute/path/pally-agent/packages/compliance/dist/cli.js", "mcp"],
      "env": {
        "COMPLIANCE_DB_PATH": "/absolute/path/pally-agent/packages/compliance/compliance.db"
      }
    }
  }
}
```

Note: The MCP servers run directly on your host machine (not in Docker), connecting to the local SQLite database. This is the recommended setup for Claude Code development workflows.

## Stopping the stack

```bash
# Stop all services
docker compose down

# Stop and remove volumes (deletes all data)
docker compose down -v
```
