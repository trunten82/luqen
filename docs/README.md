# Pally Agent — Documentation Hub

Pally Agent is a site-wide WCAG accessibility scanner with legal compliance mapping. It orchestrates pa11y scanning across entire websites, maps violations to source files, proposes code fixes, and checks every issue against 58 jurisdictions and 62 regulations.

---

## Where to start

| I want to... | Go to |
|--------------|-------|
| Get scanning in 5 minutes | [QUICKSTART.md](QUICKSTART.md) |
| Understand what pally-agent does | [USER-GUIDE.md](USER-GUIDE.md) |
| Install it properly | [Installation guides](#installation) |
| Understand the system design | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Configure a specific package | [Configuration reference](#configuration-reference) |
| Learn how to scan | [guides/scanning.md](guides/scanning.md) |
| Integrate with Claude Code | [integrations/claude-code.md](integrations/claude-code.md) |
| Set up CI/CD | [guides/ci-cd.md](guides/ci-cd.md) |

---

## Installation

| Guide | Description |
|-------|-------------|
| [installation/local.md](installation/local.md) | Node.js installation from source |
| [installation/docker.md](installation/docker.md) | Docker Compose — all services |
| [installation/kubernetes.md](installation/kubernetes.md) | Kubernetes with Kustomize |
| [installation/cloud.md](installation/cloud.md) | AWS (ECS/Lambda) and Azure (Container Apps/Functions) |
| [installation/one-line.md](installation/one-line.md) | One-line curl installer |

---

## Configuration Reference

| Guide | Description |
|-------|-------------|
| [configuration/core.md](configuration/core.md) | `@pally-agent/core` — `.pally-agent.json`, env vars, CLI flags |
| [configuration/compliance.md](configuration/compliance.md) | `@pally-agent/compliance` — `compliance.config.json`, env vars, CLI |
| [configuration/dashboard.md](configuration/dashboard.md) | `@pally-agent/dashboard` — `dashboard.config.json`, env vars, CLI |
| [configuration/monitor.md](configuration/monitor.md) | `@pally-agent/monitor` — env vars, CLI |

---

## How-to Guides

| Guide | Description |
|-------|-------------|
| [guides/scanning.md](guides/scanning.md) | Scan modes, sitemap vs crawl, WAF handling |
| [guides/compliance-check.md](guides/compliance-check.md) | Jurisdictions, reading the matrix, confirmed vs review |
| [guides/fix-proposals.md](guides/fix-proposals.md) | Auto-fixable issues, interactive CLI, MCP flow |
| [guides/reports.md](guides/reports.md) | JSON structure, HTML features, template dedup, hyperlinks |
| [guides/dashboard-admin.md](guides/dashboard-admin.md) | Dashboard user guide and admin reference |
| [guides/ci-cd.md](guides/ci-cd.md) | Pipeline integration, exit codes, fail-on-violations |

---

## Integrations

| Guide | Description |
|-------|-------------|
| [integrations/claude-code.md](integrations/claude-code.md) | MCP server setup for Claude Code — all 4 servers |
| [integrations/power-automate.md](integrations/power-automate.md) | Power Automate custom connector |
| [integrations/n8n.md](integrations/n8n.md) | n8n workflow setup |
| [integrations/api-reference.md](integrations/api-reference.md) | REST API quick reference — all endpoints |

---

## Package Deep Dives

| Package | Full docs |
|---------|-----------|
| `@pally-agent/core` | [This directory](README.md) and [guides/](guides/) |
| `@pally-agent/compliance` | [compliance/README.md](compliance/README.md) |
| `@pally-agent/dashboard` | [dashboard/README.md](dashboard/README.md) |

---

## Other

- [ARCHITECTURE.md](ARCHITECTURE.md) — system design and data flow
- [SECURITY-REVIEW.md](SECURITY-REVIEW.md) — security review findings
- [LICENSING.md](LICENSING.md) — license information

---

*See also: [Root README](../README.md) | [QUICKSTART.md](QUICKSTART.md)*
