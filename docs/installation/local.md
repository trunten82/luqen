[Docs](../README.md) > [Installation](./) > Local (Node.js)

# Local Installation — Node.js

Full step-by-step guide for installing pally-agent from source.

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 18 or later | 20+ recommended |
| npm | 9 or later | Bundled with Node.js 20 |
| Git | Any recent version | |
| pa11y webservice | Any | See below |

### pa11y webservice

pally-agent scans sites via a running pa11y webservice instance. The fastest way to start one:

```bash
docker run -d -p 3000:3000 pally/webservice:latest
```

Or follow the [pa11y-webservice](https://github.com/pa11y/pa11y-webservice) setup guide for a non-Docker install.

---

## Install pally-agent/core

```bash
# 1. Clone the monorepo
git clone https://github.com/your-org/pally-agent.git
cd pally-agent

# 2. Install all dependencies
npm install

# 3. Build all packages
npm run build --workspaces

# 4. Link core CLI globally (optional)
cd packages/core && npm link
```

After linking, `pally-agent` is available as a global command from any directory.

### Verify

```bash
pally-agent --version
# or without linking:
node packages/core/dist/cli.js --version
```

---

## Install compliance service (optional)

```bash
cd packages/compliance

# 1. Generate JWT signing keys (required before first start)
node dist/cli.js keys generate

# 2. Start the server
node dist/cli.js serve --port 4000

# 3. In a separate terminal: seed baseline data
node dist/cli.js seed

# 4. Create an OAuth client for pally-agent
node dist/cli.js clients create \
  --name "pally-agent" \
  --scope "read" \
  --grant client_credentials
```

Link the CLI globally:

```bash
npm link   # from packages/compliance
```

---

## Install dashboard (optional)

```bash
cd packages/dashboard

# 1. Create config
cat > dashboard.config.json << 'EOF'
{
  "port": 5000,
  "complianceUrl": "http://localhost:4000",
  "sessionSecret": "replace-with-random-32-byte-value",
  "complianceClientId": "YOUR_CLIENT_ID",
  "complianceClientSecret": "YOUR_CLIENT_SECRET"
}
EOF

# 2. Register dashboard OAuth client in compliance service
cd ../compliance
node dist/cli.js clients create --name "dashboard" --scope "admin" --grant password

# 3. Run database migration
cd ../dashboard
node dist/cli.js migrate

# 4. Start the server
node dist/cli.js serve
```

Open `http://localhost:5000`.

---

## Install monitor agent (optional)

```bash
cd packages/monitor

npm run build

export COMPLIANCE_URL=http://localhost:4000
export COMPLIANCE_CLIENT_ID=<client-id>
export COMPLIANCE_CLIENT_SECRET=<client-secret>

# Run a one-off source scan
node dist/cli.js scan

# Check status
node dist/cli.js status
```

---

## Config file locations

| Package | Default config file | Lookup behaviour |
|---------|-------------------|------------------|
| core | `.pally-agent.json` | Walks up from CWD to filesystem root |
| compliance | `compliance.config.json` | CWD only |
| dashboard | `dashboard.config.json` | CWD only |

See [configuration/core.md](../configuration/core.md) for all config fields.

---

## Running tests

```bash
# All packages
npm test --workspaces

# Single package
npm test --workspace=packages/core

# With coverage
npm run test:coverage --workspaces
```

---

*See also: [installation/docker.md](docker.md) | [configuration/core.md](../configuration/core.md) | [QUICKSTART.md](../QUICKSTART.md)*
