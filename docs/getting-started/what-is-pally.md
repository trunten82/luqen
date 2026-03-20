[Docs](../README.md) > [Getting Started](./) > What is Pally Agent?

# What is Pally Agent?

Pally Agent is a composable accessibility platform that scans websites for WCAG violations, maps every issue to the laws that require you to fix it, proposes source-level code fixes, and tracks regulatory changes across 58 jurisdictions. You install only the tiers you need — from a single CLI command to a full web dashboard with legal monitoring.

---

## Tiered Architecture

```
Tier 0  @pally-agent/core        Scan, fix, report (CLI + MCP)
Tier 1  @pally-agent/compliance   Legal compliance engine (API + MCP)
Tier 2  @pally-agent/dashboard    Web UI for scans, reports, admin
Tier 3  @pally-agent/monitor      Regulatory change detection (CLI + MCP)
```

Each tier depends only on the tiers below it. Core stands alone. Compliance adds legal mapping. Dashboard adds a browser UI on top of both. Monitor watches legal sources and feeds proposals into compliance.

---

## Composition Paths

| # | Path | Persona | Components | Prerequisites | Effort |
|---|------|---------|------------|---------------|--------|
| 1 | Quick scan | Any developer | core | Node.js 20+, pa11y webservice | 2 min |
| 2 | IDE integration | Developer with AI IDE | core (MCP) | Node.js 20+, pa11y webservice, MCP-capable IDE | 5 min |
| 3 | CI/CD gate | DevOps / team lead | core (CLI) | Node.js 20+, pa11y webservice, CI runner | 15 min |
| 4 | Compliance scan | Legal / compliance officer | core + compliance | Node.js 20+, pa11y webservice | 20 min |
| 5 | Compliance API only | Integrator / backend dev | compliance | Node.js 20+ | 10 min |
| 6 | Full dashboard | Team / organization | core + compliance + dashboard | Node.js 20+ or Docker, pa11y webservice | 30 min |
| 7 | Regulatory monitoring | Compliance team | monitor + compliance | Node.js 20+ | 15 min |
| 8 | Standalone monitor | Individual researcher | monitor | Node.js 20+ | 5 min |

---

## Which path is right for me?

**I just want to scan a URL and see results.**
Start with [Path 1: Quick scan](quick-scan.md). You can run your first scan in under 60 seconds.

**I want my AI coding assistant to scan and fix for me.**
Go to [Path 2: IDE integration](../paths/ide-integration.md). Works with VS Code, Cursor, Windsurf, JetBrains, and Neovim.

**I want to fail CI builds on accessibility issues.**
Follow [Path 3: CI/CD gate](../paths/developer-cli.md#cicd-integration). Add a single step to GitHub Actions or Azure DevOps.

**I need to know which laws my site violates.**
Use [Paths 4-5: Compliance checking](../paths/compliance-checking.md). Scans are enriched with jurisdiction-specific legal requirements.

**My team needs a shared UI for scans and reports.**
Deploy [Path 6: Full dashboard](../paths/full-dashboard.md). Docker Compose brings up everything in one command.

**I need to track changes in accessibility law.**
Set up [Path 7: Regulatory monitoring](../paths/regulatory-monitoring.md). The monitor watches legal sources and creates update proposals.

**I just want to watch legal sources without a compliance server.**
Use [Path 8: Standalone monitor](../paths/regulatory-monitoring.md#standalone-mode). Configure sources in a local JSON file.

---

## Next steps

| Guide | What it covers |
|-------|---------------|
| [Quick scan in 60 seconds](quick-scan.md) | Scan a URL right now |
| [One-line installer](one-line-install.md) | Install the full platform with one command |
| [Developer CLI guide](../paths/developer-cli.md) | Scans, CI/CD, fix proposals |
| [IDE integration](../paths/ide-integration.md) | MCP setup for all major editors |
| [Compliance checking](../paths/compliance-checking.md) | Legal compliance scanning |
| [Full dashboard](../paths/full-dashboard.md) | Web UI deployment |
| [Regulatory monitoring](../paths/regulatory-monitoring.md) | Legal change tracking |

---

*See also: [Docs home](../README.md) | [User Guide](../USER-GUIDE.md) | [Quickstart](../QUICKSTART.md)*
