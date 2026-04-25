# Phase 40: Documentation Sweep & Installer Refresh - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-25
**Phase:** 40-documentation-sweep
**Areas discussed:** Installer verification approach, OpenAPI spec strategy, RBAC matrix generation, New docs structure & audience

---

## Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Installer verification approach | How to prove DOC-03 succeeds | ✓ |
| OpenAPI spec strategy | Generate vs hand-write specs | ✓ |
| RBAC matrix generation | Hand vs script vs HTML | ✓ |
| New docs structure & audience | Layout + audience split | ✓ |

---

## Installer Verification Approach

### Q1: How to prove installer deploys v3.1.0 cleanly?
| Option | Description | Selected |
|--------|-------------|----------|
| Fresh container dry-run | Clean LXC/Docker, run install.sh, smoke checks | ✓ |
| Static audit + checklist | Grep installer for new env vars/migrations/RBAC | |
| Hybrid: static → fix → single fresh install at end | Cheap pass then one acceptance install | |

### Q2: Scope of installer changes vs verification only?
| Option | Description | Selected |
|--------|-------------|----------|
| Patch gaps as we find them | Installer SCRIPT fixes in-scope for Phase 40 | ✓ |
| Document gaps only, defer fixes | Installer SCRIPT fixes deferred | |
| You decide | Decide based on what's found | |

### Q3: Migration baseline?
| Option | Description | Selected |
|--------|-------------|----------|
| Up to 061 (current head) | Installer migrates fresh DB all the way to 061 | ✓ |
| Up to v3.0.0 head + run-rest-on-first-boot | Baseline at v3.0.0 head, app finishes on first boot | |

---

## OpenAPI Spec Strategy

### Q1: How to produce/refresh specs across 5 services?
| Option | Description | Selected |
|--------|-------------|----------|
| Auto-generate from Fastify schemas via @fastify/swagger | Code is single source of truth | ✓ |
| Hand-write/update YAML files | Curate by hand | |
| Hybrid: generated baseline + curated overlay | Generated + small overlay | |

### Q2: How to enforce "every shipped route appears"?
| Option | Description | Selected |
|--------|-------------|----------|
| Test that diffs Fastify routes vs spec | CI test enumerates routes, asserts presence | ✓ |
| Manual route audit checklist | Cross-reference by hand | |
| You decide | Choose based on existing tooling | |

### Q3: Where served / stored?
| Option | Description | Selected |
|--------|-------------|----------|
| Live /docs endpoint per service + committed JSON snapshot in docs/reference/openapi/ | Runtime UI plus git diff signal | ✓ |
| Live endpoint only (no committed snapshot) | Runtime is source of truth | |
| Committed snapshot only (no live endpoint) | Static files only | |

---

## RBAC Matrix Generation

### Q1: How produced and kept honest?
| Option | Description | Selected |
|--------|-------------|----------|
| Script-generated markdown from code | Build script enumerates routes/pages/MCP tools | ✓ |
| Hand-maintained markdown table | Author once, update by hand | |
| Interactive HTML page in dashboard | Live admin page introspects perms | |

### Q2: Rows/columns?
| Option | Description | Selected |
|--------|-------------|----------|
| Permissions × (HTTP routes + dashboard pages + MCP tools) | Single matrix covering all three | ✓ |
| One matrix per surface | Three separate docs | |
| You decide | Decide based on cardinality | |

### Q3: Where script lives and runs?
| Option | Description | Selected |
|--------|-------------|----------|
| Standalone script in scripts/ + npm script + CI gate | scripts/generate-rbac-matrix.ts; CI fails on diff | ✓ |
| Inline in dashboard app boot (writes file on startup) | App writes docs on each boot | |

---

## New Docs Structure & Audience

### Q1: Where do new v3.1.0 docs live?
| Option | Description | Selected |
|--------|-------------|----------|
| docs/guides/ for narrative + docs/reference/ for matrices/specs | Predictable, matches existing layout | ✓ |
| Feature-rooted (docs/agent/, docs/mcp/, docs/installer/) | Group by feature area | |
| Flat under docs/ | Drop at docs/ root | |

### Q2: Audience handling for cross-audience surfaces?
| Option | Description | Selected |
|--------|-------------|----------|
| Single guide per surface with explicit "For end users" / "For admins" sub-sections | Fewer files, clear navigation | ✓ |
| Split files: end-user-* and admin-* per surface | Separate files per audience | |
| Single combined doc, audience tags inline | No structural separation | |

### Q3: Which v3.1.0 surfaces need a NEW dedicated doc page?
| Option | Description | Selected |
|--------|-------------|----------|
| Agent history (search, resume, soft-delete) | Phase 35 surface | ✓ |
| Multi-step tool use (parallel dispatch, retry budget, transparency UI) | Phase 36 surface | ✓ |
| Streaming UX + share permalinks | Phase 37 surface | ✓ |
| Multi-org context switching | Phase 38 surface | ✓ |

---

## Claude's Discretion

- README rewrite scope (DOC-01) — incremental vs full restructure left to planner.
- Additional doc-accuracy checks (link-check, code-grep) beyond what's locked — planner may add if low-cost.
- Tone/voice for new end-user guides and prompt-template authoring guide.
- MCP-specific JSON-RPC spec additions beyond @fastify/swagger output.

## Deferred Ideas

- Full README restructure (deferred to planner unless audit demands it).
- Interactive in-dashboard RBAC matrix page (rejected; markdown sufficient).
- Token-cost dashboard per org/user (already deferred to v3.2.0 in REQUIREMENTS.md).
- Linux/macOS/Windows installer parity testing, env-var validation, rollback (covered implicitly by fresh-container dry-run; raise if surfaced).
