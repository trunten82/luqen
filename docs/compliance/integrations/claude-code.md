# Claude Code Integration

Use the Pally Compliance Service as an MCP server in Claude Code to check accessibility compliance, look up regulations, and manage the compliance database directly from your AI assistant.

## Setup

### Step 1: Build the compliance package

```bash
cd /path/to/pally-agent
npm install
cd packages/compliance
npm run build
```

### Step 2: Configure Claude Code

Add to `~/.claude/settings.json` (global) or `.claude/settings.json` (project-level):

```json
{
  "mcpServers": {
    "pally-compliance": {
      "command": "node",
      "args": ["/absolute/path/to/pally-agent/packages/compliance/dist/cli.js", "mcp"],
      "env": {
        "COMPLIANCE_DB_PATH": "/absolute/path/to/pally-agent/packages/compliance/compliance.db"
      }
    }
  }
}
```

Replace `/absolute/path/to/pally-agent` with the actual path on your system.

**Important:** Use absolute paths. Relative paths will not work because Claude Code's working directory is not guaranteed.

### Step 3: Seed baseline data (first time)

After connecting Claude Code, use the `compliance_seed` tool:

```
Use the compliance_seed tool to load the baseline compliance dataset.
```

Or seed via CLI before starting Claude Code:

```bash
cd /path/to/pally-agent/packages/compliance
node dist/cli.js seed
```

### Step 4: Restart Claude Code

MCP servers are connected at startup. Restart Claude Code after adding the server config.

Verify the tools are available: in Claude Code, the `pally-compliance` MCP server should appear in the tools list.

## Available tools

The compliance service exposes 11 MCP tools:

| Tool | Purpose |
|------|---------|
| `compliance_check` | Check pa11y issues against jurisdictions |
| `compliance_list_jurisdictions` | List jurisdictions with filters |
| `compliance_list_regulations` | List regulations with filters |
| `compliance_list_requirements` | List requirements with filters |
| `compliance_get_regulation` | Get regulation + requirements by ID |
| `compliance_propose_update` | Submit a proposed rule change |
| `compliance_get_pending` | List pending proposals |
| `compliance_approve_update` | Approve and apply a proposal |
| `compliance_list_sources` | List monitored legal sources |
| `compliance_add_source` | Add a source to monitor |
| `compliance_seed` | Load baseline dataset (idempotent) |

## Example conversations

### Check compliance for a website scan

```
You: I ran pa11y on https://example.com and got these issues. Check them against EU and US compliance requirements:

[paste pa11y JSON issues]

Use the compliance_check tool with jurisdictions: ["EU", "US"]
```

Claude will call `compliance_check` and explain:
- Which jurisdictions pass or fail
- Which specific regulations are violated
- The obligation level (mandatory/recommended/optional) of each violation
- Enforcement dates so you know which violations are actively enforced

### Look up regulations for a jurisdiction

```
You: What accessibility regulations apply in Germany?

Use compliance_list_jurisdictions to find Germany's ID, then compliance_list_regulations
filtered by jurisdictionId.
```

### Research a specific regulation

```
You: Tell me about the European Accessibility Act and what WCAG criteria it requires.

Use compliance_get_regulation with id "EU-EAA"
```

### Propose a regulation update

```
You: I found that the UK updated PSBAR to require WCAG 2.2 AA as of January 2026.
Please propose this change using compliance_propose_update.
```

Claude will structure the proposal:
```json
{
  "source": "https://www.legislation.gov.uk/...",
  "type": "amendment",
  "summary": "PSBAR updated to require WCAG 2.2 AA from January 2026",
  "proposedChanges": {
    "action": "update",
    "entityType": "requirement",
    "entityId": "...",
    "before": { "wcagVersion": "2.1" },
    "after": { "wcagVersion": "2.2", "wcagLevel": "AA" }
  },
  "affectedRegulationId": "UK-PSBAR"
}
```

### Review and approve pending proposals

```
You: Show me all pending compliance update proposals and let's review them together.

First use compliance_get_pending, then we can discuss each one and I'll approve or
reject as appropriate.
```

After reviewing:
```
You: Approve proposal <id>. I've verified this change is correct.
```

### Add a monitored legal source

```
You: Add the W3C WAI policies page as a weekly-monitored source so we track
regulatory changes automatically.

Use compliance_add_source with:
- name: "W3C WAI Web Accessibility Laws & Policies"
- url: "https://www.w3.org/WAI/policies/"
- type: "html"
- schedule: "weekly"
```

## Workflow: full accessibility audit with legal context

A complete audit workflow using both `pally-agent` and `pally-compliance` MCP servers:

```
1. Scan the site:
   pally_scan { "url": "https://example.com", "standard": "WCAG2AA" }

2. Get the issues:
   pally_get_issues { "reportPath": "...", "severity": "error" }

3. Check legal compliance:
   compliance_check {
     "jurisdictions": ["EU", "US", "UK"],
     "issues": <issues from step 2>
   }

4. Propose fixes for the mandatory violations:
   pally_propose_fixes { "reportPath": "...", "repoPath": "/path/to/repo" }

5. Prioritize: fix mandatory violations first (they're legal requirements),
   then recommended, then optional
```

## Authentication note

When running as an MCP server via `pally-compliance mcp`, the server runs in **local mode** with full admin access. No OAuth tokens are needed. This is appropriate for single-user Claude Code setups where the user controls the compliance database.

For multi-user or remote compliance service access, set the MCP server config to authenticate via OAuth:

```json
{
  "mcpServers": {
    "pally-compliance": {
      "command": "node",
      "args": ["/path/to/compliance/dist/cli.js", "mcp"],
      "env": {
        "COMPLIANCE_MCP_CLIENT_ID": "your-client-id",
        "COMPLIANCE_MCP_CLIENT_SECRET": "your-client-secret",
        "COMPLIANCE_MCP_SCOPES": "read write"
      }
    }
  }
}
```

## Troubleshooting

**"Tool not found" or MCP server not listed:**
- Verify the path in `settings.json` is absolute and points to the compiled `dist/cli.js`
- Run `npm run build` in `packages/compliance` if the `dist/` directory is missing
- Restart Claude Code after config changes

**"Database not found" errors:**
- Ensure `COMPLIANCE_DB_PATH` is an absolute path
- Run `node dist/cli.js seed` to initialize and seed the database

**Empty results from compliance_check:**
- Seed the baseline data first using `compliance_seed`
- Verify `compliance_list_jurisdictions` returns results
