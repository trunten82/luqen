# @luqen/monitor

Regulatory monitoring agent that scans web sources for accessibility law changes and submits update proposals to the Luqen compliance service. It detects when legal pages, RSS feeds, or API endpoints have changed, analyses the differences, and creates structured proposals for human review.

## Installation

```bash
npm install @luqen/monitor
```

Or within the monorepo:

```bash
npm run build -w packages/monitor
```

## Setup

The monitor connects to a running Luqen compliance service via OAuth2. Configure it with environment variables (see below) and then run a scan.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MONITOR_COMPLIANCE_URL` | `http://localhost:4000` | Base URL of the compliance service |
| `MONITOR_CLIENT_ID` | _(empty)_ | OAuth2 client ID for the compliance service |
| `MONITOR_CLIENT_SECRET` | _(empty)_ | OAuth2 client secret |
| `MONITOR_CHECK_INTERVAL` | `manual` | Cron expression or `manual` for on-demand scans |
| `MONITOR_USER_AGENT` | `luqen-monitor/<version>` | User-Agent string sent when fetching legal sources |
| `MONITOR_ORG_ID` | _(unset)_ | Organisation ID for multi-tenant scoping |
| `MONITOR_URL` | `http://localhost:4200` | Public URL for the A2A agent card |

## CLI Commands

### scan

Run one full scan cycle over all monitored legal sources.

```bash
luqen-monitor scan
luqen-monitor scan --sources-file ./my-sources.json
luqen-monitor scan --org-id org-42
```

For each source the agent fetches the current content, computes a SHA-256 hash, and compares it to the previously stored hash. When a change is detected it analyses the diff (added, removed, and modified sections) and creates an `UpdateProposal` in the compliance service.

### status

Show current monitor status: number of monitored sources, pending proposals count, and last scan time.

```bash
luqen-monitor status
```

### mcp

Start an MCP (Model Context Protocol) server on stdio for use with Claude Code or other MCP clients.

```bash
luqen-monitor mcp
```

Exposes three tools: `monitor_scan_sources`, `monitor_status`, and `monitor_add_source`.

### serve

Start an HTTP server with an A2A (Agent-to-Agent) endpoint serving the agent card.

```bash
luqen-monitor serve --port 4200
```

Endpoints:
- `GET /.well-known/agent.json` -- agent card
- `GET /health` -- health check

## Local Sources File

When the compliance service is unavailable or you want to run in standalone mode, provide a local sources file. The default lookup order is:

1. Explicit path via `--sources-file`
2. `.luqen-monitor.json` in the current directory
3. `~/.luqen-monitor.json`

Format:

```json
{
  "sources": [
    {
      "name": "EU European Accessibility Act",
      "url": "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32019L0882",
      "type": "html",
      "schedule": "weekly"
    },
    {
      "name": "W3C WAI Policies Feed",
      "url": "https://www.w3.org/WAI/policies/feed.xml",
      "type": "rss",
      "schedule": "daily"
    }
  ]
}
```

Each source requires `name`, `url`, and `type` (`html`, `rss`, or `api`). The `schedule` field defaults to `daily`.

## Content Cache

The monitor stores fetched content in `~/.luqen-monitor/cache/` so that subsequent scans can produce meaningful diffs showing what actually changed between checks, rather than only detecting that something changed.

## MCP Integration with Claude Code

Add the monitor as an MCP server in your Claude Code configuration (`.claude.json` or project settings):

```json
{
  "mcpServers": {
    "luqen-monitor": {
      "command": "npx",
      "args": ["luqen-monitor", "mcp"],
      "env": {
        "MONITOR_COMPLIANCE_URL": "http://localhost:4000",
        "MONITOR_CLIENT_ID": "your-client-id",
        "MONITOR_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

Claude can then invoke:
- **monitor_scan_sources** -- trigger a full scan and review results
- **monitor_status** -- check how many sources are monitored and pending proposals
- **monitor_add_source** -- register a new legal source URL for monitoring

## Example Usage

```bash
# Set credentials
export MONITOR_COMPLIANCE_URL=https://compliance.example.com
export MONITOR_CLIENT_ID=monitor-agent
export MONITOR_CLIENT_SECRET=secret

# Run a scan
luqen-monitor scan

# Check status
luqen-monitor status

# Standalone scan with local sources
luqen-monitor scan --sources-file ./sources.json

# Start MCP server for Claude Code
luqen-monitor mcp
```

## License

MIT
