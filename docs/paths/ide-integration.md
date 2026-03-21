[Docs](../README.md) > [Paths](./) > IDE Integration

# IDE Integration — MCP Setup

Use pally-agent as an MCP (Model Context Protocol) server inside your AI-powered editor. Your coding assistant gets 6 accessibility tools to scan, filter, fix, and test — without leaving the IDE.

---

## Prerequisites

- Node.js 20+
- pa11y webservice running
- pally-agent installed from source (the MCP server runs from the built JS files)

```bash
git clone https://github.com/trunten82/pally-agent.git ~/pally-agent
cd ~/pally-agent && npm install && npm run build --workspaces
```

---

## VS Code (Claude Code extension)

Add to `.claude/settings.json` (project-level) or `~/.claude/settings.json` (global):

```json
{
  "mcpServers": {
    "pally-agent": {
      "command": "node",
      "args": ["~/pally-agent/packages/core/dist/mcp.js"]
    },
    "pally-compliance": {
      "command": "node",
      "args": ["~/pally-agent/packages/compliance/dist/cli.js", "mcp"],
      "env": {
        "COMPLIANCE_DB_PATH": "~/pally-agent/packages/compliance/compliance.db"
      }
    }
  }
}
```

Restart VS Code. The tools appear in Claude Code's chat.

---

## Cursor

1. Open **Settings > MCP Servers**
2. Add a server:
   - Name: `pally-agent`
   - Command: `node`
   - Args: `~/pally-agent/packages/core/dist/mcp.js`
3. Add a second server for compliance:
   - Name: `pally-compliance`
   - Command: `node`
   - Args: `~/pally-agent/packages/compliance/dist/cli.js mcp`
4. Tools appear automatically in Cursor's AI chat

---

## Windsurf

1. Open **Settings > MCP**
2. Add the same server commands as Cursor above
3. Use in Cascade: "Run an accessibility audit on our staging site"

---

## JetBrains IDEs (IntelliJ, WebStorm, PyCharm)

Requires the [AI Assistant plugin](https://plugins.jetbrains.com/plugin/22282-ai-assistant):

1. **Settings > AI Assistant > MCP Servers**
2. Add server — command: `node`, args: `["~/pally-agent/packages/core/dist/mcp.js"]`
3. Use in the AI chat panel

---

## Neovim

For Neovim with an MCP-compatible plugin (e.g., avante.nvim):

```lua
{
  servers = {
    ["pally-agent"] = {
      command = "node",
      args = { os.getenv("HOME") .. "/pally-agent/packages/core/dist/mcp.js" },
    },
    ["pally-compliance"] = {
      command = "node",
      args = {
        os.getenv("HOME") .. "/pally-agent/packages/compliance/dist/cli.js",
        "mcp",
      },
      env = {
        COMPLIANCE_DB_PATH = os.getenv("HOME") .. "/pally-agent/packages/compliance/compliance.db",
      },
    },
  },
}
```

---

## Available MCP tools

### Core tools (6)

| Tool | Description |
|------|-------------|
| `pally_scan` | Scan a website for WCAG issues (full site discovery + scan) |
| `pally_get_issues` | Read and filter issues from a JSON report |
| `pally_propose_fixes` | Generate code fix proposals from a scan report |
| `pally_apply_fix` | Apply a single fix to a source file |
| `pally_raw` | Single-page scan with raw pa11y output |
| `pally_raw_batch` | Batch scan multiple URLs with raw pa11y output |

### Compliance tools (11)

| Tool | Description |
|------|-------------|
| `compliance_check` | Check issues against jurisdiction requirements |
| `compliance_list_jurisdictions` | List all jurisdictions |
| `compliance_list_regulations` | List regulations with filters |
| `compliance_list_requirements` | List requirements with filters |
| `compliance_get_regulation` | Get regulation details and requirements |
| `compliance_propose_update` | Submit a rule database change proposal |
| `compliance_get_pending` | List pending update proposals |
| `compliance_approve_update` | Approve and apply an update proposal |
| `compliance_list_sources` | List monitored legal sources |
| `compliance_add_source` | Add a monitored source URL |
| `compliance_seed` | Load baseline compliance data |

### Monitor tools (3)

| Tool | Description |
|------|-------------|
| `monitor_scan_sources` | Scan all monitored legal sources for changes |
| `monitor_status` | Show monitor status and pending proposals |
| `monitor_add_source` | Add a legal source to monitor |

---

## Example prompts

Once connected, try these in your AI chat:

- "Scan https://staging.example.com for accessibility issues"
- "Show me all errors from the last scan report"
- "Propose fixes for the missing alt text issues"
- "Check which EU regulations these violations break"
- "Fix the missing lang attribute in index.html"

---

## Next steps

- Learn the CLI: [Developer CLI guide](developer-cli.md)
- Add compliance: [Compliance checking](compliance-checking.md)
- Full MCP reference: [Claude Code integration](../integrations/claude-code.md)

---

*See also: [What is Pally Agent?](../getting-started/what-is-pally.md) | [Quickstart IDE section](../QUICKSTART.md#ide-integration)*
