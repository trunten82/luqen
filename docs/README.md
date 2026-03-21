# Pally Agent — Documentation Hub

Pally Agent is a site-wide WCAG accessibility scanner with legal compliance mapping. It orchestrates pa11y scanning across entire websites, maps violations to source files, proposes code fixes, and checks every issue against 58 jurisdictions and 62 regulations.

---

## Where to start

| I want to... | Go to |
|--------------|-------|
| Get scanning in 5 minutes | [QUICKSTART.md](QUICKSTART.md) |
| Understand what pally-agent does | [USER-GUIDE.md](USER-GUIDE.md) |
| Install it properly | [Installation guides](#installation) |
| Understand the system design | [contributing/architecture.md](contributing/architecture.md) |
| Configure a specific package | [Configuration reference](#configuration-reference) |
| Learn how to scan | [guides/scanning.md](guides/scanning.md) |
| Integrate with Claude Code | [compliance/integrations/claude-code.md](compliance/integrations/claude-code.md) |
| Set up CI/CD | [guides/ci-cd.md](guides/ci-cd.md) |

---

## Installation

| Guide | Description |
|-------|-------------|
| [getting-started/one-line-install.md](getting-started/one-line-install.md) | Node.js installation from source |
| [deployment/docker.md](deployment/docker.md) | Docker Compose — all services |
| [deployment/kubernetes.md](deployment/kubernetes.md) | Kubernetes with Kustomize |
| [deployment/cloud.md](deployment/cloud.md) | AWS (ECS/Lambda) and Azure (Container Apps/Functions) |
| [getting-started/one-line-install.md](getting-started/one-line-install.md) | One-line curl installer |

---

## Configuration Reference

| Guide | Description |
|-------|-------------|
| [reference/core-config.md](reference/core-config.md) | `@pally-agent/core` — `.pally-agent.json`, env vars, CLI flags |
| [reference/compliance-config.md](reference/compliance-config.md) | `@pally-agent/compliance` — `compliance.config.json`, env vars, CLI |
| [reference/dashboard-config.md](reference/dashboard-config.md) | `@pally-agent/dashboard` — `dashboard.config.json`, env vars, CLI |
| [reference/monitor-config.md](reference/monitor-config.md) | `@pally-agent/monitor` — env vars, CLI |
| [reference/plugin-guide.md](reference/plugin-guide.md) | Plugin configuration — all 6 plugins (auth, notification, storage) with setup guides |

---

## How-to Guides

| Guide | Description |
|-------|-------------|
| [guides/scanning.md](guides/scanning.md) | Scan modes, runner selection, scan scheduling, incremental scanning, WAF handling |
| [guides/compliance-check.md](guides/compliance-check.md) | Jurisdictions, reading the matrix, confirmed vs review |
| [guides/fix-proposals.md](guides/fix-proposals.md) | Auto-fixable issues, interactive CLI, MCP flow |
| [guides/reports.md](guides/reports.md) | JSON structure, HTML features, template dedup, issue assignments, fix proposals, report comparison, manual testing, trends |
| [guides/dashboard-admin.md](guides/dashboard-admin.md) | Dashboard user guide, admin reference, teams, customizable roles & permissions, connected repos, scan scheduling, email reports |
| [guides/ci-cd.md](guides/ci-cd.md) | Pipeline integration, exit codes, fail-on-violations |

---

## Integrations

| Guide | Description |
|-------|-------------|
| [compliance/integrations/claude-code.md](compliance/integrations/claude-code.md) | MCP server setup for Claude Code — all 4 servers |
| [compliance/integrations/power-automate.md](compliance/integrations/power-automate.md) | Power Automate custom connector |
| [compliance/integrations/n8n.md](compliance/integrations/n8n.md) | n8n workflow setup |
| [reference/api-reference.md](reference/api-reference.md) | REST API quick reference — all endpoints, data API, CSV export, Power BI |

---

## Package Deep Dives

| Package | Full docs |
|---------|-----------|
| `@pally-agent/core` | [This directory](README.md) and [guides/](guides/) |
| `@pally-agent/compliance` | [compliance/README.md](compliance/README.md) |
| `@pally-agent/dashboard` | [dashboard/README.md](dashboard/README.md) |

---

## Other

- [contributing/architecture.md](contributing/architecture.md) — system design and data flow
- [SECURITY-REVIEW.md](SECURITY-REVIEW.md) — security review findings
- [LICENSING.md](LICENSING.md) — license information

---

*See also: [Root README](../README.md) | [QUICKSTART.md](QUICKSTART.md)*
