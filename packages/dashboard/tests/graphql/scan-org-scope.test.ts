/**
 * Cross-tenant scoping for the GraphQL `scan(id)` and `scanIssues(scanId)`
 * queries.
 *
 * REST rule being mirrored (routes/api/data.ts, GET /api/v1/scans/:id and
 * GET /api/v1/scans/:id/issues): `scan === null || scan.orgId !== orgId`
 * → 404. There is NO admin bypass on those reads, so a scan belonging to
 * another org must resolve exactly as a missing scan does — `null` for
 * `scan`, an empty connection for `scanIssues` — for every caller,
 * including a dashboard admin.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('../../src/version.js', () => ({
  VERSION: '1.0.0-test',
}));

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolvers } from '../../src/graphql/resolvers.js';
import type { GraphQLContext } from '../../src/graphql/resolvers.js';

const mockedReadFile = vi.mocked(readFile);
const mockedExistsSync = vi.mocked(existsSync);

const FABRIKAM_ORG = 'org-fabrikam';
const NORTHWIND_ORG = 'org-northwind';

const NORTHWIND_SCAN = {
  id: 'scan-northwind-1',
  siteUrl: 'https://northwind.example',
  orgId: NORTHWIND_ORG,
  status: 'completed',
  jsonReportPath: '/reports/scan-northwind-1.json',
};

const NORTHWIND_REPORT = {
  pages: [
    {
      url: 'https://northwind.example/',
      issues: [
        { type: 'error', code: 'E1', message: 'secret-ish issue', selector: 'img' },
      ],
    },
  ],
};

function makeCtx(orgId: string, role = 'user'): GraphQLContext {
  return {
    storage: {
      scans: {
        getScan: vi.fn(async (id: string) => (id === NORTHWIND_SCAN.id ? NORTHWIND_SCAN : null)),
      },
    } as unknown as GraphQLContext['storage'],
    user: { id: `user-${orgId}`, username: `user-${orgId}`, role },
    permissions: new Set<string>(),
    orgId,
    brandingOrchestrator: {} as GraphQLContext['brandingOrchestrator'],
  };
}

describe('GraphQL scan org scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedExistsSync.mockReturnValue(true);
    mockedReadFile.mockResolvedValue(JSON.stringify(NORTHWIND_REPORT));
  });

  describe('Query.scan', () => {
    it('returns null for a scan owned by another org (cross-org)', async () => {
      const result = await resolvers.Query.scan({}, { id: NORTHWIND_SCAN.id }, makeCtx(FABRIKAM_ORG));
      expect(result).toBeNull();
    });

    it('returns null for a scan owned by another org even for a dashboard admin (cross-org)', async () => {
      const result = await resolvers.Query.scan(
        {}, { id: NORTHWIND_SCAN.id }, makeCtx(FABRIKAM_ORG, 'admin'),
      );
      expect(result).toBeNull();
    });

    it('returns the scan to a caller in the owning org', async () => {
      const result = await resolvers.Query.scan({}, { id: NORTHWIND_SCAN.id }, makeCtx(NORTHWIND_ORG));
      expect(result).toEqual(NORTHWIND_SCAN);
    });
  });

  describe('Query.scanIssues', () => {
    it('returns an empty connection for a scan owned by another org (cross-org)', async () => {
      const result = await resolvers.Query.scanIssues(
        {}, { scanId: NORTHWIND_SCAN.id }, makeCtx(FABRIKAM_ORG),
      );
      expect(result.nodes).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(mockedReadFile).not.toHaveBeenCalled();
    });

    it('returns an empty connection for another org scan even for a dashboard admin (cross-org)', async () => {
      const result = await resolvers.Query.scanIssues(
        {}, { scanId: NORTHWIND_SCAN.id }, makeCtx(FABRIKAM_ORG, 'admin'),
      );
      expect(result.nodes).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('returns the issues to a caller in the owning org', async () => {
      const result = await resolvers.Query.scanIssues(
        {}, { scanId: NORTHWIND_SCAN.id }, makeCtx(NORTHWIND_ORG),
      );
      expect(result.totalCount).toBe(1);
      expect(result.nodes[0].code).toBe('E1');
    });
  });
});
