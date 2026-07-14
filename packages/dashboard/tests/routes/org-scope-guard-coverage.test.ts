/**
 * Org-scope guard coverage gate.
 *
 * The recurring bug class of 2026 (manual-tests 2026-05-15; report.pdf +
 * issues.xlsx exports and assignments/fixes/repos sub-pages 2026-07-14):
 * a /reports/:id sub-surface enforces
 *     scan.orgId !== orgId && scan.orgId !== 'system'  → 404
 * WITHOUT the `request.user?.role !== 'admin'` bypass that the report page
 * itself applies — so an admin sees the link but the target 404s.
 *
 * This gate scans every route file for the guard expression and fails when
 * the admin bypass (or an `isAdmin` check within two lines above) is missing.
 * Service-layer scoping (e.g. scan-service.getScanForOrg, used by org-scoped
 * MCP tokens where no role bypass may apply) is intentionally out of scope.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTES_DIR = join(__dirname, '../../src/routes');

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('org-scope guards in routes', () => {
  it("every scan.orgId guard carries the admin bypass (role !== 'admin' or isAdmin)", () => {
    const missing: string[] = [];
    for (const file of collectTsFiles(ROUTES_DIR)) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        if (!line.includes("scan.orgId !== orgId && scan.orgId !== 'system'")) return;
        const context = lines.slice(Math.max(0, i - 2), i + 1).join('\n');
        const hasBypass =
          context.includes("role !== 'admin'") || context.includes('isAdmin');
        if (!hasBypass) {
          missing.push(`${relative(ROUTES_DIR, file)}:${i + 1}`);
        }
      });
    }
    expect(
      missing,
      `Org-scope guards missing the admin bypass (admin sees the link, target 404s):\n${missing.join('\n')}`,
    ).toEqual([]);
  });
});
