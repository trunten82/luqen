# Luqen — Documentation Hub

Luqen is a site-wide WCAG accessibility scanner with legal compliance mapping, an LLM-powered fix and analysis engine, per-service Streamable HTTP MCP endpoints, and an in-dashboard agent companion. It orchestrates pa11y scanning across entire websites, maps violations to source files, proposes code fixes, and checks every issue against 58 jurisdictions and 62 regulations.

> **v3.1.0** — Agent history, multi-step tool use, streaming UX + share permalinks, and multi-org context switching. v3.0.0 shipped Streamable HTTP MCP endpoints + OAuth 2.1 + PKCE + DCR on every service plus the in-dashboard agent companion.

---

## Where to start

| I want to... | Go to |
|--------------|-------|
| Get scanning in 5 minutes | [QUICKSTART.md](QUICKSTART.md) |
| Understand what Luqen does | [USER-GUIDE.md](USER-GUIDE.md) |
| Install it properly | [getting-started/installation.md](getting-started/installation.md) |
| Understand the system design | [contributing/architecture.md](contributing/architecture.md) |
| Configure a specific package | [Configuration reference](#reference) |
| Learn how to scan | [guides/scanning.md](guides/scanning.md) |
| Use the agent companion | [guides/agent-companion.md](guides/agent-companion.md) |
| Connect an external MCP client | [guides/mcp-integration.md](guides/mcp-integration.md) |
| Set up CI/CD | [guides/ci-cd.md](guides/ci-cd.md) |

---

## Getting started

| Guide | Description |
|-------|-------------|
| [QUICKSTART.md](QUICKSTART.md) | Get a first scan running in 5 minutes |
| [getting-started/installation.md](getting-started/installation.md) | End-to-end v3.1.0 install walkthrough — Linux / macOS / Windows / Docker |
| [getting-started/quick-scan.md](getting-started/quick-scan.md) | Single-page scan from the CLI |
| [getting-started/what-is-luqen.md](getting-started/what-is-luqen.md) | Conceptual overview |
| [getting-started/one-line-install.md](getting-started/one-line-install.md) | One-line `curl … | bash` installer |

---

## Guides

Narrative how-to guides under `guides/`. v3.1.0 surface guides have explicit `## For end users` and `## For admins` audience subsections.

| Guide | Description |
|-------|-------------|
| [guides/agent-companion.md](guides/agent-companion.md) | In-dashboard conversational agent — drawer UX, streaming, tool calls, history, share permalinks, multi-org switching |
| [guides/agent-history.md](guides/agent-history.md) | Stacked AI-titled history panel with debounced search, infinite scroll, resume, soft-delete, audit (Phase 35) |
| [guides/ci-cd.md](guides/ci-cd.md) | Pipeline integration, exit codes, fail-on-violations |
| [guides/compliance-check.md](guides/compliance-check.md) | Jurisdictions, reading the matrix, confirmed vs review |
| [guides/dashboard-admin.md](guides/dashboard-admin.md) | Dashboard user + admin reference; teams, roles, repos, schedules, email reports |
| [guides/fix-proposals.md](guides/fix-proposals.md) | Auto-fixable issues, interactive CLI, MCP flow |
| [guides/mcp-integration.md](guides/mcp-integration.md) | External MCP client setup over OAuth 2.1 + PKCE + DCR (Claude Desktop, Cursor, Windsurf, custom clients) |
| [guides/multi-org-switching.md](guides/multi-org-switching.md) | Native `<select>` org switcher, force-new-conversation, JWT-driven `ToolContext.orgId` (Phase 38) |
| [guides/multi-step-tools.md](guides/multi-step-tools.md) | Parallel-dispatch tool calls, shared 3-retry budget, 5-step iteration cap, chip-strip UI (Phase 36) |
| [guides/powerbi.md](guides/powerbi.md) | Power Query M custom connector for the Data API |
| [guides/prompt-templates.md](guides/prompt-templates.md) | LLM prompt templates with locked-section fences, validator (422 envelope), reset-to-default |
| [guides/reports.md](guides/reports.md) | JSON structure, HTML features, template dedup, assignments, comparison, manual testing, trends |
| [guides/scanning.md](guides/scanning.md) | Scan modes, runner selection, scheduling, incremental scanning, WAF handling |
| [guides/security-administration.md](guides/security-administration.md) | Secrets, key rotation, RBAC administration |
| [guides/streaming-share-links.md](guides/streaming-share-links.md) | Stop / retry / edit-and-resend, copy-as-markdown, `/agent/share/:shareId` permalinks (Phase 37) |

---

## Reference

Matrices and specs under `reference/`. These are generated from code and policed by CI drift gates — never hand-edit.

| File | Description |
|------|-------------|
| [reference/api-reference.md](reference/api-reference.md) | REST API quick reference — all endpoints, data API, Excel export, Power BI |
| [reference/cli-reference.md](reference/cli-reference.md) | CLI flags + subcommands across `luqen`, `luqen-compliance`, `luqen-branding`, `luqen-dashboard`, `luqen-llm`, `luqen-monitor` |
| [reference/compliance-config.md](reference/compliance-config.md) | `@luqen/compliance` — `compliance.config.json`, env vars, CLI |
| [reference/core-config.md](reference/core-config.md) | `@luqen/core` — `.luqen.json`, env vars, CLI flags |
| [reference/dashboard-config.md](reference/dashboard-config.md) | `@luqen/dashboard` — `dashboard.config.json`, env vars, CLI |
| [reference/git-host-plugins.md](reference/git-host-plugins.md) | Git host plugin configuration (GitHub, GitLab, Azure DevOps) |
| [reference/graphql-schema.md](reference/graphql-schema.md) | GraphQL schema reference |
| [reference/mcp-tools.md](reference/mcp-tools.md) | Catalogue of MCP tools exposed by each service |
| [reference/monitor-config.md](reference/monitor-config.md) | `@luqen/monitor` — env vars, CLI |
| [reference/openapi/](reference/openapi/) | Per-service OpenAPI 3.x snapshots — `compliance.json`, `branding.json`, `llm.json`, `dashboard.json`, `mcp.json`. Live Swagger UI at `/docs` per service. CI drift gate: `.github/workflows/openapi-drift.yml` |
| [reference/plugin-development.md](reference/plugin-development.md) | Plugin authoring — manifest, lifecycle, tarball flow |
| [reference/plugin-guide.md](reference/plugin-guide.md) | Plugin configuration — all 11 plugins (auth, notification, storage) |
| [reference/rbac-matrix.md](reference/rbac-matrix.md) | Generated RBAC matrix — 332 (permission × surface) pairs across dashboard pages, HTTP routes, MCP tools. CI drift gate: `.github/workflows/rbac-drift.yml` |

---

## Deployment

| Guide | Description |
|-------|-------------|
| [deployment/docker.md](deployment/docker.md) | Docker Compose — all services |
| [deployment/kubernetes.md](deployment/kubernetes.md) | Kubernetes with Kustomize |
| [deployment/cloud.md](deployment/cloud.md) | AWS (ECS / Lambda) and Azure (Container Apps / Functions) |
| [deployment/installer-env-vars.md](deployment/installer-env-vars.md) | Alphabetical env-var reference for `install.sh` / `install.command` / `install.ps1` |
| [deployment/installer-changelog.md](deployment/installer-changelog.md) | Per-version installer changelog (v2.12.0 → v3.0.0 → v3.1.0) |
| [getting-started/installation.md](getting-started/installation.md) | End-to-end install guide referencing both files above |

---

## Integrations

| Guide | Description |
|-------|-------------|
| [compliance/integrations/power-automate.md](compliance/integrations/power-automate.md) | Power Automate custom connector |
| [compliance/integrations/n8n.md](compliance/integrations/n8n.md) | n8n workflow setup |
| [reference/api-reference.md](reference/api-reference.md) | REST API quick reference — all endpoints, data API, exports, Power BI |
| [guides/mcp-integration.md](guides/mcp-integration.md) | External MCP clients (Claude Desktop, Cursor, Windsurf, custom) |

---

## Package deep dives

| Package | Full docs |
|---------|-----------|
| `@luqen/core` | [reference/core-config.md](reference/core-config.md) and [guides/](guides/) |
| `@luqen/compliance` | [compliance/README.md](compliance/README.md) |
| `@luqen/branding` | [branding/README.md](branding/README.md) |
| `@luqen/dashboard` | [dashboard/README.md](dashboard/README.md) |
| `@luqen/llm` | [../packages/llm/README.md](../packages/llm/README.md) |
| `@luqen/monitor` | [reference/monitor-config.md](reference/monitor-config.md) |
| Plugins | [plugins/README.md](plugins/README.md) |

---

## Other

- [contributing/architecture.md](contributing/architecture.md) — system design and data flow
- [SECURITY-REVIEW.md](SECURITY-REVIEW.md) — security review findings
- [LICENSING.md](LICENSING.md) — license information

---

*See also: [Root README](../README.md) | [QUICKSTART.md](QUICKSTART.md) | [USER-GUIDE.md](USER-GUIDE.md)*
