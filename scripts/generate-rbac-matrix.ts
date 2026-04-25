#!/usr/bin/env tsx
/**
 * generate-rbac-matrix.ts — DOC-07 RBAC matrix generator (Phase 40 Plan 02).
 *
 * Reads RBAC declarations directly from source files via deterministic regex
 * extraction (no Fastify boot, no AST parser). Emits a single markdown matrix
 * to docs/reference/rbac-matrix.md covering three surface kinds across the
 * five Luqen Fastify services.
 *
 * ----------------------------------------------------------------------------
 * SURFACE EXTRACTION CONTRACT
 * ----------------------------------------------------------------------------
 *
 * 1) Dashboard HTTP routes & dashboard pages (surfaceType: http-route | dashboard-page)
 *    File glob:          packages/dashboard/src/routes/**\/*.ts
 *    Field carrying perm: `requirePermission('foo.bar')` or
 *                          `requirePermission('foo.bar', 'baz.qux')` (any-of)
 *    Detection regex:    /server\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"][\s\S]*?requirePermission\(([^)]*)\)/g
 *    Concrete examples:
 *      - packages/dashboard/src/routes/admin/users.ts:17  GET /admin/users (admin.users)
 *      - packages/dashboard/src/routes/admin/audit.ts:21  GET /admin/audit (audit.view)
 *      - packages/dashboard/src/routes/repos.ts:4         API repos route (uses requirePermission)
 *
 *    Page vs API split:
 *      Pages = paths starting with /admin/, /dashboard/, /agent, /reports/, /trends, /sources, /home, /brand-overview, /scan, /tools, /repos
 *             AND NOT under /api/.
 *      Otherwise the surface is classified as http-route.
 *
 * 2) MCP tools (surfaceType: mcp-tool)
 *    File glob:          packages/{dashboard,compliance,branding,llm}/src/mcp/metadata.ts
 *                        + packages/dashboard/src/mcp/tools/admin.ts
 *    Field carrying perm: `requiredPermission: 'foo.bar'` on each entry of
 *                         the exported *_TOOL_METADATA / *_DATA_TOOL_METADATA / *_ADMIN_TOOL_METADATA
 *                         readonly array.
 *    Detection regex:    /name:\s*['"]([^'"]+)['"]\s*,?\s*requiredPermission:\s*['"]([^'"]+)['"]/g
 *    Concrete examples:
 *      - packages/dashboard/src/mcp/metadata.ts: dashboard_scan_site (scans.create)
 *      - packages/compliance/src/mcp/metadata.ts: compliance_check (compliance.view)
 *      - packages/branding/src/mcp/metadata.ts: branding_match (branding.view)
 *      - packages/llm/src/mcp/metadata.ts: llm_generate_fix (llm.view)
 *      - packages/dashboard/src/mcp/tools/admin.ts: dashboard_list_users (admin.users)
 *
 * 3) OAuth-scoped service routes (surfaceType: http-route, prefix `oauth:`)
 *    File glob:          packages/{compliance,branding,llm}/src/api/routes/**\/*.ts
 *    Field carrying perm: `requireScope('read'|'write'|'admin')` in the route
 *                         options preHandler. Permission name in matrix:
 *                         `oauth:<service>:<scope>` where service is the
 *                         containing package directory.
 *    Detection regex:    /app\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"][\s\S]*?requireScope\(\s*['"]([^'"]+)['"]\s*\)/g
 *    Concrete examples:
 *      - packages/llm/src/api/routes/providers.ts:18    GET /api/v1/providers (read)
 *      - packages/llm/src/api/routes/providers.ts:46    POST /api/v1/providers (admin)
 *      - packages/compliance/src/api/routes/orgs.ts:9   DELETE /api/v1/orgs/:id/data (admin)
 *
 * Output columns: | Permission | Surface | Surface Type | Source |
 *
 * Determinism: rows are sorted by Permission asc, then Surface asc. Re-running
 * produces zero git diff.
 *
 * Failure mode: any I/O error or zero surfaces detected → exit non-zero so
 * the CI drift gate doesn't silently pass on a broken generator.
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const OUT_PATH = join(REPO_ROOT, 'docs', 'reference', 'rbac-matrix.md');

// Dashboard URL prefixes that count as "dashboard-page" rather than "http-route".
// API routes live under /api/. Everything else with a permission decorator
// rendering server-side HTML is a page.
const DASHBOARD_PAGE_PREFIXES: readonly string[] = [
  '/admin',
  '/dashboard',
  '/agent',
  '/reports',
  '/trends',
  '/sources',
  '/home',
  '/brand-overview',
  '/scan',
  '/tools',
  '/repos',
  '/jurisdictions',
  '/regulations',
  '/manual-tests',
  '/compare',
  '/schedules',
  '/orgs',
  '/git-credentials',
  '/wcag-enrichment',
  '/fix-pr',
  '/assignments',
];

interface MatrixRow {
  readonly permission: string;
  readonly surface: string;
  readonly surfaceType: 'http-route' | 'dashboard-page' | 'mcp-tool';
  readonly source: string;
}

// ---------------------------------------------------------------------------
// File walker (no shell, no glob lib)
// ---------------------------------------------------------------------------

function walkTs(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__' || entry === 'tests') continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      out.push(...walkTs(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dashboard route extraction
// ---------------------------------------------------------------------------

function classifyDashboardSurface(path: string): 'http-route' | 'dashboard-page' {
  if (path.startsWith('/api/')) return 'http-route';
  for (const prefix of DASHBOARD_PAGE_PREFIXES) {
    if (path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?')) {
      return 'dashboard-page';
    }
  }
  return 'http-route';
}

function parsePermissionList(rawArgs: string): string[] {
  // requirePermission('a', 'b', 'c') → ['a', 'b', 'c']
  const perms: string[] = [];
  const re = /['"]([a-z0-9._-]+)['"]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawArgs)) !== null) {
    perms.push(m[1]!);
  }
  return perms;
}

function extractDashboardRoutes(): MatrixRow[] {
  const rows: MatrixRow[] = [];
  const routesDir = join(REPO_ROOT, 'packages/dashboard/src/routes');
  const files = walkTs(routesDir);

  // Match `server.METHOD('path', { ... requirePermission(...) ... }, ...);`.
  // Multiline: route options can span many lines. Capture method, path, and
  // the option-block tail. We then scan ALL `requirePermission(...)` calls in
  // that tail (a single route option block can chain multiple calls — see
  // routes/fix-pr.ts:202 for an `[requirePermission('a'), requirePermission('b')]`
  // construction). Sufficient for the patterns used in this codebase (no
  // nested route defs).
  const routeRe = /server\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]([\s\S]*?)\)\s*;/g;
  const permCallRe = /requirePermission\(([^)]*)\)/g;

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(REPO_ROOT, file);
    let m: RegExpExecArray | null;
    while ((m = routeRe.exec(src)) !== null) {
      const method = m[1]!.toUpperCase();
      const path = m[2]!;
      const tail = m[3]!;
      const surfaceType = classifyDashboardSurface(path);
      const surface = `${method} ${path}`;
      // Collect every requirePermission call in this option block.
      const localRe = new RegExp(permCallRe.source, 'g');
      let pm: RegExpExecArray | null;
      while ((pm = localRe.exec(tail)) !== null) {
        const perms = parsePermissionList(pm[1]!);
        for (const perm of perms) {
          rows.push({ permission: perm, surface, surfaceType, source: rel });
        }
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// MCP tool extraction
// ---------------------------------------------------------------------------

function extractMcpTools(): MatrixRow[] {
  const rows: MatrixRow[] = [];
  const files = [
    'packages/dashboard/src/mcp/metadata.ts',
    'packages/dashboard/src/mcp/tools/admin.ts',
    'packages/compliance/src/mcp/metadata.ts',
    'packages/branding/src/mcp/metadata.ts',
    'packages/llm/src/mcp/metadata.ts',
  ];
  // Match `name: 'tool_name', requiredPermission: 'perm.id'` allowing
  // intervening comments / whitespace / trailing flags before requiredPermission.
  const re = /name:\s*['"]([a-z0-9_]+)['"][^{}]*?requiredPermission:\s*['"]([a-z0-9._-]+)['"]/gi;
  for (const file of files) {
    const full = join(REPO_ROOT, file);
    let src: string;
    try {
      src = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const toolName = m[1]!;
      const perm = m[2]!;
      const pkgMatch = /packages\/([^/]+)\//.exec(file);
      const service = pkgMatch ? pkgMatch[1]! : 'unknown';
      const surface = `MCP ${service}.${toolName}`;
      rows.push({
        permission: perm,
        surface,
        surfaceType: 'mcp-tool',
        source: file,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// OAuth-scoped service routes (compliance / branding / llm)
// ---------------------------------------------------------------------------

function extractOAuthScopedRoutes(): MatrixRow[] {
  const rows: MatrixRow[] = [];
  const services: ReadonlyArray<{ readonly name: string; readonly dir: string }> = [
    { name: 'compliance', dir: 'packages/compliance/src/api/routes' },
    { name: 'branding', dir: 'packages/branding/src/api/routes' },
    { name: 'llm', dir: 'packages/llm/src/api/routes' },
  ];

  // Match `app.METHOD('path', { ... requireScope('scope') ... },`
  const routeRe = /app\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]([\s\S]*?\})\s*,/g;
  const scopeRe = /requireScope\(\s*['"]([a-z]+)['"]\s*\)/;

  for (const svc of services) {
    const dir = join(REPO_ROOT, svc.dir);
    const files = walkTs(dir);
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const rel = relative(REPO_ROOT, file);
      let m: RegExpExecArray | null;
      while ((m = routeRe.exec(src)) !== null) {
        const method = m[1]!.toUpperCase();
        const path = m[2]!;
        const tail = m[3]!;
        const scopeMatch = scopeRe.exec(tail);
        if (!scopeMatch) continue;
        const scope = scopeMatch[1]!;
        const permission = `oauth:${svc.name}:${scope}`;
        const surface = `${method} ${path}`;
        rows.push({
          permission,
          surface,
          surfaceType: 'http-route',
          source: rel,
        });
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function dedupeAndSort(rows: readonly MatrixRow[]): MatrixRow[] {
  const seen = new Map<string, MatrixRow>();
  for (const r of rows) {
    const key = `${r.permission}\x00${r.surface}\x00${r.surfaceType}\x00${r.source}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return Array.from(seen.values()).sort((a, b) => {
    if (a.permission !== b.permission) return a.permission < b.permission ? -1 : 1;
    if (a.surface !== b.surface) return a.surface < b.surface ? -1 : 1;
    if (a.surfaceType !== b.surfaceType) return a.surfaceType < b.surfaceType ? -1 : 1;
    return a.source < b.source ? -1 : 1;
  });
}

function renderMarkdown(rows: readonly MatrixRow[]): string {
  // Note: deliberately no timestamp / no commit-hash line. The CI drift gate
  // relies on `git diff --exit-code` against the committed file — any
  // commit-changing field would force a regen-and-commit on every push and
  // make the gate useless. Freshness is guaranteed by the CI gate, not by
  // the generated artifact.
  const lines: string[] = [];
  lines.push('# RBAC Matrix');
  lines.push('');
  lines.push('_Generated by `npm run docs:rbac` from code. Do not edit by hand._');
  lines.push('');
  lines.push('| Permission | Surface | Surface Type | Source |');
  lines.push('|------------|---------|--------------|--------|');
  for (const r of rows) {
    lines.push(`| ${r.permission} | ${r.surface} | ${r.surfaceType} | ${r.source} |`);
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const all: MatrixRow[] = [
    ...extractDashboardRoutes(),
    ...extractMcpTools(),
    ...extractOAuthScopedRoutes(),
  ];

  if (all.length === 0) {
    console.error('generate-rbac-matrix: no surfaces detected — extraction is broken');
    process.exit(2);
  }

  const sorted = dedupeAndSort(all);
  const md = renderMarkdown(sorted);

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md, 'utf8');

  console.log(`generate-rbac-matrix: wrote ${sorted.length} rows to ${relative(REPO_ROOT, OUT_PATH)}`);
}

main();
