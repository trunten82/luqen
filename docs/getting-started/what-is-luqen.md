[Docs](../README.md) > [Getting Started](./) > What is Luqen?

# What is Luqen?

Luqen is a composable accessibility platform that scans websites for WCAG violations, maps every issue to the laws that require you to fix it, proposes source-level code fixes, and tracks regulatory changes across 58 jurisdictions. It supports multiple test runners (HTML_CodeSniffer and axe-core), incremental scanning for changed pages only, trend tracking over time, manual testing checklists, and multi-worker scaling. You install only the tiers you need — from a single CLI command to a full web dashboard with legal monitoring.

---

## Tiered Architecture

```
Tier 0  @luqen/core        Scan, fix, report (CLI + MCP)
Tier 1  @luqen/compliance   Legal compliance engine (API + MCP)
Tier 2  @luqen/dashboard    Web UI for scans, reports, admin
Tier 3  @luqen/monitor      Regulatory change detection (CLI + MCP)
```

Each tier depends only on the tiers below it. Core stands alone. Compliance adds legal mapping. Dashboard adds a browser UI on top of both. Monitor watches legal sources and feeds proposals into compliance.

The dashboard includes a **plugin system** for extending functionality without modifying the core codebase. Plugin types include authentication providers (e.g., Azure Entra ID, Okta, Google), notification channels (Slack, Teams), storage backends (S3, Azure Blob), and custom scanners. Plugins are managed via the dashboard UI, CLI, or REST API.

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

## Known Limitations

### WCAG 2.2 support

Luqen currently tests against **WCAG 2.1** (Levels A, AA, AAA). The underlying pa11y engine and HTML_CodeSniffer ruleset do not yet fully support WCAG 2.2 success criteria (2.4.11 Focus Not Obscured, 2.4.12 Focus Not Obscured (Enhanced), 2.4.13 Focus Appearance, 2.5.7 Dragging Movements, 2.5.8 Target Size, 3.2.6 Consistent Help, 3.3.7 Redundant Entry, 3.3.8 Accessible Authentication, 3.3.9 Accessible Authentication (Enhanced)).

**Impact:** If your compliance requirements reference WCAG 2.2, Luqen will not flag violations specific to the nine new success criteria. Existing WCAG 2.0/2.1 criteria are fully covered.

**Partial workaround:** Switch to the **axe-core runner** (`--runner axe` or `DASHBOARD_SCANNER_RUNNER=axe`), which provides coverage for some WCAG 2.2 criteria (e.g., Target Size 2.5.8). Supplement with manual testing for the remaining WCAG 2.2 criteria — the dashboard's manual testing checklists at `/reports/:id/manual` can help structure this review. See the [W3C What's New in WCAG 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/) guide.

**Status:** Tracking upstream at [pa11y/pa11y#635](https://github.com/pa11y/pa11y/issues/635). When pa11y adds WCAG 2.2 support, Luqen will inherit it automatically.

---

*See also: [Docs home](../README.md) | [User Guide](../USER-GUIDE.md) | [Quickstart](../QUICKSTART.md)*
