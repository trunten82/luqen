[Docs](README.md) > Quickstart

# Quickstart — Scan a site in 5 minutes

## What you need

- Node.js 18 or later
- A running pa11y webservice (see below if you don't have one)

---

## Step 1 — Install

```bash
git clone https://github.com/your-org/pally-agent.git
cd pally-agent
npm install
npm run build --workspaces
cd packages/core && npm link
```

After linking, `pally-agent` is a global command.

**Don't have a pa11y webservice?** The fastest way is Docker:

```bash
docker run -d -p 3000:3000 pally/webservice:latest
```

---

## Step 2 — Run your first scan

```bash
export PALLY_WEBSERVICE_URL=http://localhost:3000
pally-agent scan https://example.com
```

Output:
```
Discovering URLs from https://example.com...
Found 12 URLs to scan
[1/12] Scanning https://example.com/
[1/12] Done: https://example.com/
...
JSON report written to: ./pally-reports/pally-report-2026-03-18T120000Z.json
```

---

## Step 3 — View results

Open the HTML report:

```bash
pally-agent scan https://example.com --format both
open pally-reports/*.html
```

Or parse the JSON:

```bash
cat pally-reports/*.json | jq '.summary'
```

---

## Optional: Add compliance checking

Annotate every WCAG violation with the legal regulations that require it:

```bash
# 1. Start the compliance service
cd packages/compliance
node dist/cli.js keys generate
node dist/cli.js seed
node dist/cli.js serve &

# 2. Create an OAuth client
node dist/cli.js clients create --name scanner --scope read --grant client_credentials
# → note the client_id and client_secret

# 3. Scan with compliance
pally-agent scan https://example.com \
  --format both \
  --compliance-url http://localhost:4000 \
  --jurisdictions EU,US,UK \
  --compliance-client-id $CLIENT_ID \
  --compliance-client-secret $CLIENT_SECRET
```

The HTML report now shows a per-jurisdiction pass/fail table and regulation badges on every issue.

---

## Next steps

| I want to... | Go to |
|--------------|-------|
| Understand the results | [USER-GUIDE.md](USER-GUIDE.md) |
| Configure scanning options | [configuration/core.md](configuration/core.md) |
| Use with Claude Code | [integrations/claude-code.md](integrations/claude-code.md) |
| Set up in CI/CD | [guides/ci-cd.md](guides/ci-cd.md) |
| Run the dashboard | [guides/dashboard-admin.md](guides/dashboard-admin.md) |

---

*See also: [Docs home](README.md) | [USER-GUIDE.md](USER-GUIDE.md) | [guides/scanning.md](guides/scanning.md)*
