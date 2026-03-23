import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-1234'),
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

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<GraphQLContext> = {}): GraphQLContext {
  return {
    storage: makeStorage(),
    user: { id: 'user-1', username: 'testuser', role: 'admin' },
    permissions: new Set(['scans.create', 'reports.delete', 'issues.assign', 'trends.view',
      'users.create', 'users.delete', 'users.activate', 'users.reset_password', 'users.roles',
      'audit.view']),
    orgId: 'org-1',
    ...overrides,
  };
}

function makeUnauthCtx(): GraphQLContext {
  return {
    storage: makeStorage(),
    user: undefined,
    permissions: new Set(),
    orgId: 'org-1',
  };
}

function makeStorage(): any {
  return {
    scans: {
      listScans: vi.fn().mockResolvedValue([]),
      getScan: vi.fn().mockResolvedValue(null),
      createScan: vi.fn().mockImplementation((input: any) => Promise.resolve({ ...input, status: 'queued' })),
      deleteScan: vi.fn().mockResolvedValue(undefined),
      getTrendData: vi.fn().mockResolvedValue([]),
    },
    assignments: {
      listAssignments: vi.fn().mockResolvedValue([]),
      getAssignment: vi.fn().mockResolvedValue(null),
      createAssignment: vi.fn().mockImplementation((input: any) => Promise.resolve({ ...input, status: 'open' })),
      updateAssignment: vi.fn().mockResolvedValue(undefined),
      deleteAssignment: vi.fn().mockResolvedValue(undefined),
    },
    users: {
      listUsers: vi.fn().mockResolvedValue([]),
      getUserById: vi.fn().mockResolvedValue(null),
      createUser: vi.fn().mockImplementation((u: string, _p: string, r: string) =>
        Promise.resolve({ id: 'new-user-id', username: u, role: r, active: true, createdAt: '2024-01-01' })),
      deleteUser: vi.fn().mockResolvedValue(true),
      activateUser: vi.fn().mockResolvedValue(undefined),
      deactivateUser: vi.fn().mockResolvedValue(undefined),
      updatePassword: vi.fn().mockResolvedValue(undefined),
    },
    teams: {
      listTeams: vi.fn().mockResolvedValue([]),
      getTeam: vi.fn().mockResolvedValue(null),
    },
    organizations: {
      listOrgs: vi.fn().mockResolvedValue([]),
    },
    roles: {
      listRoles: vi.fn().mockResolvedValue([]),
    },
    audit: {
      query: vi.fn().mockResolvedValue({ entries: [], total: 0 }),
    },
  };
}

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

describe('GraphQL resolvers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Authentication / Authorization helpers ──────────────────────────
  describe('authentication and authorization', () => {
    it('throws when user is not authenticated (scans query)', async () => {
      const ctx = makeUnauthCtx();
      await expect(resolvers.Query.scans({}, {}, ctx)).rejects.toThrow('Authentication required');
    });

    it('throws when user lacks required permission (trends query)', async () => {
      const ctx = makeCtx({ permissions: new Set() });
      await expect(resolvers.Query.trends({}, { siteUrl: 'http://x.com' }, ctx))
        .rejects.toThrow('Forbidden: requires trends.view');
    });

    it('throws when user is not authenticated for permission-gated query', async () => {
      const ctx = makeUnauthCtx();
      await expect(resolvers.Query.trends({}, { siteUrl: 'http://x.com' }, ctx))
        .rejects.toThrow('Authentication required');
    });
  });

  // ── Query.scans ─────────────────────────────────────────────────────
  describe('Query.scans', () => {
    it('returns paginated scans', async () => {
      const ctx = makeCtx();
      const scans = [
        { id: '1', siteUrl: 'http://a.com', createdAt: '2024-01-01' },
        { id: '2', siteUrl: 'http://b.com', createdAt: '2024-01-02' },
        { id: '3', siteUrl: 'http://c.com', createdAt: '2024-01-03' },
      ];
      ctx.storage.scans.listScans.mockResolvedValue(scans);

      const result = await resolvers.Query.scans({}, { limit: 2, offset: 0 }, ctx);

      expect(result.nodes).toHaveLength(2);
      expect(result.totalCount).toBe(3);
      expect(result.pageInfo.hasNextPage).toBe(true);
      expect(result.pageInfo.limit).toBe(2);
      expect(result.pageInfo.offset).toBe(0);
    });

    it('filters scans by date range', async () => {
      const ctx = makeCtx();
      const scans = [
        { id: '1', siteUrl: 'http://a.com', createdAt: '2024-01-01' },
        { id: '2', siteUrl: 'http://a.com', createdAt: '2024-06-15' },
        { id: '3', siteUrl: 'http://a.com', createdAt: '2024-12-31' },
      ];
      ctx.storage.scans.listScans.mockResolvedValue(scans);

      const result = await resolvers.Query.scans({}, {
        from: '2024-03-01',
        to: '2024-09-01',
      }, ctx);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('2');
    });

    it('passes siteUrl filter to storage', async () => {
      const ctx = makeCtx();
      ctx.storage.scans.listScans.mockResolvedValue([]);

      await resolvers.Query.scans({}, { siteUrl: 'http://test.com' }, ctx);

      expect(ctx.storage.scans.listScans).toHaveBeenCalledWith({
        siteUrl: 'http://test.com',
        orgId: 'org-1',
      });
    });

    it('clamps limit to valid range', async () => {
      const ctx = makeCtx();
      ctx.storage.scans.listScans.mockResolvedValue([]);

      const result = await resolvers.Query.scans({}, { limit: 5000 }, ctx);
      expect(result.pageInfo.limit).toBe(1000);
    });

    it('uses default limit when not specified', async () => {
      const ctx = makeCtx();
      ctx.storage.scans.listScans.mockResolvedValue([]);

      const result = await resolvers.Query.scans({}, {}, ctx);
      expect(result.pageInfo.limit).toBe(100);
    });

    it('clamps limit below minimum to 1', async () => {
      const ctx = makeCtx();
      ctx.storage.scans.listScans.mockResolvedValue([]);

      const result = await resolvers.Query.scans({}, { limit: -5 }, ctx);
      expect(result.pageInfo.limit).toBe(1);
    });

    it('clamps offset to 0 minimum', async () => {
      const ctx = makeCtx();
      ctx.storage.scans.listScans.mockResolvedValue([]);

      const result = await resolvers.Query.scans({}, { offset: -10 }, ctx);
      expect(result.pageInfo.offset).toBe(0);
    });

    it('uses default offset of 0 when not specified', async () => {
      const ctx = makeCtx();
      ctx.storage.scans.listScans.mockResolvedValue([]);

      const result = await resolvers.Query.scans({}, {}, ctx);
      expect(result.pageInfo.offset).toBe(0);
    });

    it('hasNextPage is false when all results fit', async () => {
      const ctx = makeCtx();
      ctx.storage.scans.listScans.mockResolvedValue([
        { id: '1', siteUrl: 'http://a.com', createdAt: '2024-01-01' },
      ]);

      const result = await resolvers.Query.scans({}, { limit: 10 }, ctx);
      expect(result.pageInfo.hasNextPage).toBe(false);
    });
  });

  // ── Query.scan ──────────────────────────────────────────────────────
  describe('Query.scan', () => {
    it('returns a scan when found', async () => {
      const ctx = makeCtx();
      const scan = { id: 'scan-1', siteUrl: 'http://test.com' };
      ctx.storage.scans.getScan.mockResolvedValue(scan);

      const result = await resolvers.Query.scan({}, { id: 'scan-1' }, ctx);
      expect(result).toEqual(scan);
    });

    it('returns null when scan is not found', async () => {
      const ctx = makeCtx();
      ctx.storage.scans.getScan.mockResolvedValue(null);

      const result = await resolvers.Query.scan({}, { id: 'nonexistent' }, ctx);
      expect(result).toBeNull();
    });

    it('requires authentication', async () => {
      const ctx = makeUnauthCtx();
      await expect(resolvers.Query.scan({}, { id: '1' }, ctx))
        .rejects.toThrow('Authentication required');
    });
  });

  // ── Query.scanIssues ────────────────────────────────────────────────
  describe('Query.scanIssues', () => {
    it('returns empty when scan is not found', async () => {
      const ctx = makeCtx();

      const result = await resolvers.Query.scanIssues({}, { scanId: 'nope' }, ctx);
      expect(result.nodes).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('returns empty when report file does not exist', async () => {
      const ctx = makeCtx();
      ctx.storage.scans.getScan.mockResolvedValue({ id: '1', jsonReportPath: '/tmp/nope.json' });
      mockedExistsSync.mockReturnValue(false);

      const result = await resolvers.Query.scanIssues({}, { scanId: '1' }, ctx);
      expect(result.nodes).toEqual([]);
    });

    it('returns empty when scan has no jsonReportPath', async () => {
      const ctx = makeCtx();
      ctx.storage.scans.getScan.mockResolvedValue({ id: '1' });

      const result = await resolvers.Query.scanIssues({}, { scanId: '1' }, ctx);
      expect(result.nodes).toEqual([]);
    });

    it('flattens issues from all pages in the report', async () => {
      const ctx = makeCtx();
      const reportPath = '/tmp/report.json';
      ctx.storage.scans.getScan.mockResolvedValue({ id: '1', jsonReportPath: reportPath });
      mockedExistsSync.mockReturnValue(true);

      const report = {
        pages: [
          { url: 'http://a.com', issues: [
            { type: 'error', code: 'E1', message: 'msg1', selector: 'div' },
          ]},
          { url: 'http://b.com', issues: [
            { type: 'warning', code: 'W1', message: 'msg2', selector: 'span' },
            { type: 'error', code: 'E2', message: 'msg3', selector: 'p', wcagCriterion: '1.1.1' },
          ]},
        ],
      };
      mockedReadFile.mockResolvedValue(JSON.stringify(report));

      const result = await resolvers.Query.scanIssues({}, { scanId: '1' }, ctx);
      expect(result.totalCount).toBe(3);
      expect(result.nodes).toHaveLength(3);
      expect(result.nodes[0].pageUrl).toBe('http://a.com');
      expect(result.nodes[2].pageUrl).toBe('http://b.com');
    });

    it('filters issues by severity', async () => {
      const ctx = makeCtx();
      const reportPath = '/tmp/report.json';
      ctx.storage.scans.getScan.mockResolvedValue({ id: '1', jsonReportPath: reportPath });
      mockedExistsSync.mockReturnValue(true);

      const report = {
        pages: [
          { url: 'http://a.com', issues: [
            { type: 'error', code: 'E1', message: 'msg1', selector: 'div' },
            { type: 'warning', code: 'W1', message: 'msg2', selector: 'span' },
          ]},
        ],
      };
      mockedReadFile.mockResolvedValue(JSON.stringify(report));

      const result = await resolvers.Query.scanIssues({}, { scanId: '1', severity: 'error' }, ctx);
      expect(result.totalCount).toBe(1);
      expect(result.nodes[0].type).toBe('error');
    });

    it('filters issues by WCAG criterion', async () => {
      const ctx = makeCtx();
      const reportPath = '/tmp/report.json';
      ctx.storage.scans.getScan.mockResolvedValue({ id: '1', jsonReportPath: reportPath });
      mockedExistsSync.mockReturnValue(true);

      const report = {
        pages: [
          { url: 'http://a.com', issues: [
            { type: 'error', code: 'E1', message: 'msg1', selector: 'div', wcagCriterion: '1.1.1' },
            { type: 'error', code: 'E2', message: 'msg2', selector: 'span', wcagCriterion: '2.1.1' },
          ]},
        ],
      };
      mockedReadFile.mockResolvedValue(JSON.stringify(report));

      const result = await resolvers.Query.scanIssues({}, { scanId: '1', criterion: '1.1.1' }, ctx);
      expect(result.totalCount).toBe(1);
      expect(result.nodes[0].wcagCriterion).toBe('1.1.1');
    });

    it('paginates issue results', async () => {
      const ctx = makeCtx();
      const reportPath = '/tmp/report.json';
      ctx.storage.scans.getScan.mockResolvedValue({ id: '1', jsonReportPath: reportPath });
      mockedExistsSync.mockReturnValue(true);

      const issues = Array.from({ length: 5 }, (_, i) => ({
        type: 'error', code: `E${i}`, message: `msg${i}`, selector: `sel${i}`,
      }));
      const report = { pages: [{ url: 'http://a.com', issues }] };
      mockedReadFile.mockResolvedValue(JSON.stringify(report));

      const result = await resolvers.Query.scanIssues({}, { scanId: '1', limit: 2, offset: 1 }, ctx);
      expect(result.nodes).toHaveLength(2);
      expect(result.totalCount).toBe(5);
      expect(result.pageInfo.hasNextPage).toBe(true);
    });

    it('returns empty when report has no pages key', async () => {
      const ctx = makeCtx();
      const reportPath = '/tmp/report.json';
      ctx.storage.scans.getScan.mockResolvedValue({ id: '1', jsonReportPath: reportPath });
      mockedExistsSync.mockReturnValue(true);
      mockedReadFile.mockResolvedValue(JSON.stringify({}));

      const result = await resolvers.Query.scanIssues({}, { scanId: '1' }, ctx);
      expect(result.nodes).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('returns empty when readFile throws', async () => {
      const ctx = makeCtx();
      const reportPath = '/tmp/report.json';
      ctx.storage.scans.getScan.mockResolvedValue({ id: '1', jsonReportPath: reportPath });
      mockedExistsSync.mockReturnValue(true);
      mockedReadFile.mockRejectedValue(new Error('Read error'));

      const result = await resolvers.Query.scanIssues({}, { scanId: '1' }, ctx);
      expect(result.nodes).toEqual([]);
      expect(result.totalCount).toBe(0);
    });
  });

  // ── Query.assignments ───────────────────────────────────────────────
  describe('Query.assignments', () => {
    it('passes filter args to storage', async () => {
      const ctx = makeCtx();
      await resolvers.Query.assignments({}, { scanId: 's1', status: 'open', assignedTo: 'bob' }, ctx);

      expect(ctx.storage.assignments.listAssignments).toHaveBeenCalledWith({
        scanId: 's1',
        status: 'open',
        assignedTo: 'bob',
        orgId: 'org-1',
      });
    });

    it('handles undefined optional filters', async () => {
      const ctx = makeCtx();
      await resolvers.Query.assignments({}, {}, ctx);

      expect(ctx.storage.assignments.listAssignments).toHaveBeenCalledWith({
        scanId: undefined,
        status: undefined,
        assignedTo: undefined,
        orgId: 'org-1',
      });
    });

    it('requires authentication', async () => {
      const ctx = makeUnauthCtx();
      await expect(resolvers.Query.assignments({}, {}, ctx))
        .rejects.toThrow('Authentication required');
    });
  });

  // ── Query.trends ────────────────────────────────────────────────────
  describe('Query.trends', () => {
    it('returns trend data for matching site URL', async () => {
      const ctx = makeCtx();
      const trendData = [
        { id: '1', siteUrl: 'http://a.com', createdAt: '2024-01-01', completedAt: '2024-01-01T01:00:00', totalIssues: 10, errors: 3, warnings: 5, notices: 2 },
        { id: '2', siteUrl: 'http://b.com', createdAt: '2024-01-02', completedAt: '2024-01-02T01:00:00', totalIssues: 5, errors: 1, warnings: 2, notices: 2 },
        { id: '3', siteUrl: 'http://a.com', createdAt: '2024-02-01', completedAt: '2024-02-01T01:00:00', totalIssues: 8, errors: 2, warnings: 4, notices: 2 },
      ];
      ctx.storage.scans.getTrendData.mockResolvedValue(trendData);

      const result = await resolvers.Query.trends({}, { siteUrl: 'http://a.com' }, ctx);
      expect(result).toHaveLength(2);
      expect(result[0].scanId).toBe('1');
      expect(result[1].scanId).toBe('3');
    });

    it('uses createdAt as fallback when completedAt is missing', async () => {
      const ctx = makeCtx();
      ctx.storage.scans.getTrendData.mockResolvedValue([
        { id: '1', siteUrl: 'http://a.com', createdAt: '2024-01-01', totalIssues: 5, errors: 1, warnings: 2, notices: 2 },
      ]);

      const result = await resolvers.Query.trends({}, { siteUrl: 'http://a.com' }, ctx);
      expect(result[0].completedAt).toBe('2024-01-01');
    });

    it('defaults numeric fields to 0 when undefined', async () => {
      const ctx = makeCtx();
      ctx.storage.scans.getTrendData.mockResolvedValue([
        { id: '1', siteUrl: 'http://a.com', createdAt: '2024-01-01' },
      ]);

      const result = await resolvers.Query.trends({}, { siteUrl: 'http://a.com' }, ctx);
      expect(result[0].totalIssues).toBe(0);
      expect(result[0].errors).toBe(0);
      expect(result[0].warnings).toBe(0);
      expect(result[0].notices).toBe(0);
    });

    it('requires trends.view permission', async () => {
      const ctx = makeCtx({ permissions: new Set(['scans.create']) });
      await expect(resolvers.Query.trends({}, { siteUrl: 'http://a.com' }, ctx))
        .rejects.toThrow('Forbidden');
    });
  });

  // ── Query.complianceSummary ─────────────────────────────────────────
  describe('Query.complianceSummary', () => {
    it('returns one entry per site with the latest scan', async () => {
      const ctx = makeCtx();
      ctx.storage.scans.getTrendData.mockResolvedValue([
        { id: '1', siteUrl: 'http://a.com', createdAt: '2024-01-01', completedAt: '2024-01-01', totalIssues: 10, errors: 3, warnings: 5, notices: 2 },
        { id: '2', siteUrl: 'http://a.com', createdAt: '2024-06-01', completedAt: '2024-06-01', totalIssues: 5, errors: 1, warnings: 2, notices: 2 },
        { id: '3', siteUrl: 'http://b.com', createdAt: '2024-03-01', completedAt: '2024-03-01', totalIssues: 8, errors: 2, warnings: 4, notices: 2 },
      ]);

      const result = await resolvers.Query.complianceSummary({}, {}, ctx);
      expect(result).toHaveLength(2);

      const siteA = result.find((e: any) => e.siteUrl === 'http://a.com');
      expect(siteA.latestScanId).toBe('2'); // later createdAt
      expect(siteA.totalIssues).toBe(5);
    });

    it('defaults numeric fields to 0 when undefined', async () => {
      const ctx = makeCtx();
      ctx.storage.scans.getTrendData.mockResolvedValue([
        { id: '1', siteUrl: 'http://a.com', createdAt: '2024-01-01' },
      ]);

      const result = await resolvers.Query.complianceSummary({}, {}, ctx);
      expect(result[0].totalIssues).toBe(0);
      expect(result[0].errors).toBe(0);
    });

    it('uses createdAt as fallback for completedAt', async () => {
      const ctx = makeCtx();
      ctx.storage.scans.getTrendData.mockResolvedValue([
        { id: '1', siteUrl: 'http://a.com', createdAt: '2024-01-01' },
      ]);

      const result = await resolvers.Query.complianceSummary({}, {}, ctx);
      expect(result[0].completedAt).toBe('2024-01-01');
    });

    it('requires authentication', async () => {
      const ctx = makeUnauthCtx();
      await expect(resolvers.Query.complianceSummary({}, {}, ctx))
        .rejects.toThrow('Authentication required');
    });
  });

  // ── Query.dashboardUsers ────────────────────────────────────────────
  describe('Query.dashboardUsers', () => {
    it('returns users list when authorized', async () => {
      const ctx = makeCtx();
      const users = [{ id: '1', username: 'admin', role: 'admin', active: true }];
      ctx.storage.users.listUsers.mockResolvedValue(users);

      const result = await resolvers.Query.dashboardUsers({}, {}, ctx);
      expect(result).toEqual(users);
    });

    it('requires a users.* permission', async () => {
      const ctx = makeCtx({ permissions: new Set(['scans.create']) });
      await expect(resolvers.Query.dashboardUsers({}, {}, ctx))
        .rejects.toThrow('Forbidden');
    });
  });

  // ── Query.teams ─────────────────────────────────────────────────────
  describe('Query.teams', () => {
    it('returns teams for the org', async () => {
      const ctx = makeCtx();
      const teams = [{ id: 't1', name: 'Team A' }];
      ctx.storage.teams.listTeams.mockResolvedValue(teams);

      const result = await resolvers.Query.teams({}, {}, ctx);
      expect(result).toEqual(teams);
      expect(ctx.storage.teams.listTeams).toHaveBeenCalledWith('org-1');
    });
  });

  // ── Query.team ──────────────────────────────────────────────────────
  describe('Query.team', () => {
    it('returns a team when found', async () => {
      const ctx = makeCtx();
      const team = { id: 't1', name: 'Team A' };
      ctx.storage.teams.getTeam.mockResolvedValue(team);

      const result = await resolvers.Query.team({}, { id: 't1' }, ctx);
      expect(result).toEqual(team);
    });

    it('returns null when team is not found', async () => {
      const ctx = makeCtx();
      const result = await resolvers.Query.team({}, { id: 'nope' }, ctx);
      expect(result).toBeNull();
    });
  });

  // ── Query.organizations ─────────────────────────────────────────────
  describe('Query.organizations', () => {
    it('returns orgs list', async () => {
      const ctx = makeCtx();
      const orgs = [{ id: 'o1', name: 'Org A', slug: 'org-a' }];
      ctx.storage.organizations.listOrgs.mockResolvedValue(orgs);

      const result = await resolvers.Query.organizations({}, {}, ctx);
      expect(result).toEqual(orgs);
    });
  });

  // ── Query.roles ─────────────────────────────────────────────────────
  describe('Query.roles', () => {
    it('returns roles for the org', async () => {
      const ctx = makeCtx();
      const roles = [{ id: 'r1', name: 'Admin' }];
      ctx.storage.roles.listRoles.mockResolvedValue(roles);

      const result = await resolvers.Query.roles({}, {}, ctx);
      expect(result).toEqual(roles);
      expect(ctx.storage.roles.listRoles).toHaveBeenCalledWith('org-1');
    });
  });

  // ── Query.auditLog ──────────────────────────────────────────────────
  describe('Query.auditLog', () => {
    it('returns paginated audit entries', async () => {
      const ctx = makeCtx();
      const entries = [{ id: 'a1', action: 'login', actor: 'admin' }];
      ctx.storage.audit.query.mockResolvedValue({ entries, total: 1 });

      const result = await resolvers.Query.auditLog({}, {}, ctx);
      expect(result.nodes).toEqual(entries);
      expect(result.totalCount).toBe(1);
      expect(result.pageInfo.limit).toBe(50); // default
    });

    it('passes all filter args to storage', async () => {
      const ctx = makeCtx();
      ctx.storage.audit.query.mockResolvedValue({ entries: [], total: 0 });

      await resolvers.Query.auditLog({}, {
        actor: 'bob',
        action: 'login',
        resourceType: 'scan',
        from: '2024-01-01',
        to: '2024-12-31',
        limit: 25,
        offset: 10,
      }, ctx);

      expect(ctx.storage.audit.query).toHaveBeenCalledWith({
        actor: 'bob',
        action: 'login',
        resourceType: 'scan',
        from: '2024-01-01',
        to: '2024-12-31',
        orgId: 'org-1',
        limit: 25,
        offset: 10,
      });
    });

    it('clamps limit to valid range (max 200)', async () => {
      const ctx = makeCtx();
      ctx.storage.audit.query.mockResolvedValue({ entries: [], total: 0 });

      const result = await resolvers.Query.auditLog({}, { limit: 500 }, ctx);
      expect(result.pageInfo.limit).toBe(200);
    });

    it('requires audit.view permission', async () => {
      const ctx = makeCtx({ permissions: new Set(['scans.create']) });
      await expect(resolvers.Query.auditLog({}, {}, ctx))
        .rejects.toThrow('Forbidden');
    });
  });

  // ── Query.health ────────────────────────────────────────────────────
  describe('Query.health', () => {
    it('returns status and version', () => {
      const result = resolvers.Query.health();
      expect(result.status).toBe('ok');
      expect(result.version).toBe('1.0.0-test');
    });
  });

  // =========================================================================
  // Mutation resolvers
  // =========================================================================

  // ── Mutation.createScan ─────────────────────────────────────────────
  describe('Mutation.createScan', () => {
    it('creates a scan with defaults', async () => {
      const ctx = makeCtx();
      const result = await resolvers.Mutation.createScan({}, {
        input: { siteUrl: 'http://test.com' },
      }, ctx);

      expect(ctx.storage.scans.createScan).toHaveBeenCalledWith(expect.objectContaining({
        id: 'test-uuid-1234',
        siteUrl: 'http://test.com',
        standard: 'WCAG2AA',
        jurisdictions: [],
        createdBy: 'testuser',
        orgId: 'org-1',
      }));
      expect(result.status).toBe('queued');
    });

    it('uses provided standard and jurisdictions', async () => {
      const ctx = makeCtx();
      await resolvers.Mutation.createScan({}, {
        input: { siteUrl: 'http://test.com', standard: 'WCAG2A', jurisdictions: ['EU', 'US'] },
      }, ctx);

      expect(ctx.storage.scans.createScan).toHaveBeenCalledWith(expect.objectContaining({
        standard: 'WCAG2A',
        jurisdictions: ['EU', 'US'],
      }));
    });

    it('requires scans.create permission', async () => {
      const ctx = makeCtx({ permissions: new Set() });
      await expect(resolvers.Mutation.createScan({}, { input: { siteUrl: 'http://x.com' } }, ctx))
        .rejects.toThrow('Forbidden');
    });
  });

  // ── Mutation.deleteScan ─────────────────────────────────────────────
  describe('Mutation.deleteScan', () => {
    it('deletes a scan when found', async () => {
      const ctx = makeCtx();
      ctx.storage.scans.getScan.mockResolvedValue({ id: 'scan-1' });

      const result = await resolvers.Mutation.deleteScan({}, { id: 'scan-1' }, ctx);
      expect(result).toBe(true);
      expect(ctx.storage.scans.deleteScan).toHaveBeenCalledWith('scan-1');
    });

    it('throws when scan is not found', async () => {
      const ctx = makeCtx();
      await expect(resolvers.Mutation.deleteScan({}, { id: 'nope' }, ctx))
        .rejects.toThrow('Scan not found: nope');
    });

    it('requires reports.delete permission', async () => {
      const ctx = makeCtx({ permissions: new Set() });
      await expect(resolvers.Mutation.deleteScan({}, { id: '1' }, ctx))
        .rejects.toThrow('Forbidden');
    });
  });

  // ── Mutation.assignIssue ────────────────────────────────────────────
  describe('Mutation.assignIssue', () => {
    it('creates an assignment', async () => {
      const ctx = makeCtx();
      const input = {
        scanId: 's1',
        issueFingerprint: 'fp1',
        severity: 'error',
        message: 'Missing alt',
        wcagCriterion: '1.1.1',
        wcagTitle: 'Non-text Content',
        selector: 'img',
        pageUrl: 'http://a.com',
        assignedTo: 'bob',
        notes: 'Fix this',
      };

      const result = await resolvers.Mutation.assignIssue({}, { input }, ctx);

      expect(ctx.storage.assignments.createAssignment).toHaveBeenCalledWith(expect.objectContaining({
        id: 'test-uuid-1234',
        scanId: 's1',
        issueFingerprint: 'fp1',
        severity: 'error',
        message: 'Missing alt',
        createdBy: 'testuser',
        orgId: 'org-1',
      }));
      expect(result.status).toBe('open');
    });

    it('requires issues.assign permission', async () => {
      const ctx = makeCtx({ permissions: new Set() });
      await expect(resolvers.Mutation.assignIssue({}, {
        input: { scanId: 's1', issueFingerprint: 'fp1', severity: 'error', message: 'msg' },
      }, ctx)).rejects.toThrow('Forbidden');
    });
  });

  // ── Mutation.updateAssignment ───────────────────────────────────────
  describe('Mutation.updateAssignment', () => {
    it('updates an existing assignment', async () => {
      const ctx = makeCtx();
      const existing = { id: 'a1', status: 'open' };
      const updated = { id: 'a1', status: 'fixed' };
      ctx.storage.assignments.getAssignment
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(updated);

      const result = await resolvers.Mutation.updateAssignment({}, {
        id: 'a1', status: 'fixed', assignedTo: 'alice', notes: 'Done',
      }, ctx);

      expect(ctx.storage.assignments.updateAssignment).toHaveBeenCalledWith('a1', {
        status: 'fixed',
        assignedTo: 'alice',
        notes: 'Done',
      });
      expect(result).toEqual(updated);
    });

    it('throws when assignment is not found', async () => {
      const ctx = makeCtx();
      await expect(resolvers.Mutation.updateAssignment({}, { id: 'nope' }, ctx))
        .rejects.toThrow('Assignment not found: nope');
    });

    it('throws when assignment disappears after update', async () => {
      const ctx = makeCtx();
      ctx.storage.assignments.getAssignment
        .mockResolvedValueOnce({ id: 'a1' })
        .mockResolvedValueOnce(null);

      await expect(resolvers.Mutation.updateAssignment({}, { id: 'a1', status: 'fixed' }, ctx))
        .rejects.toThrow('Assignment not found after update: a1');
    });
  });

  // ── Mutation.deleteAssignment ───────────────────────────────────────
  describe('Mutation.deleteAssignment', () => {
    it('deletes an existing assignment', async () => {
      const ctx = makeCtx();
      ctx.storage.assignments.getAssignment.mockResolvedValue({ id: 'a1' });

      const result = await resolvers.Mutation.deleteAssignment({}, { id: 'a1' }, ctx);
      expect(result).toBe(true);
      expect(ctx.storage.assignments.deleteAssignment).toHaveBeenCalledWith('a1');
    });

    it('throws when assignment is not found', async () => {
      const ctx = makeCtx();
      await expect(resolvers.Mutation.deleteAssignment({}, { id: 'nope' }, ctx))
        .rejects.toThrow('Assignment not found: nope');
    });
  });

  // ── Mutation.createUser ─────────────────────────────────────────────
  describe('Mutation.createUser', () => {
    it('creates a user with default role', async () => {
      const ctx = makeCtx();
      const result = await resolvers.Mutation.createUser({}, {
        username: 'newuser', password: 'Pass123!x',
      }, ctx);

      expect(ctx.storage.users.createUser).toHaveBeenCalledWith('newuser', 'Pass123!x', 'user');
      expect(result.username).toBe('newuser');
    });

    it('creates a user with specified role', async () => {
      const ctx = makeCtx();
      await resolvers.Mutation.createUser({}, {
        username: 'admin2', password: 'Pass123!x', role: 'admin',
      }, ctx);

      expect(ctx.storage.users.createUser).toHaveBeenCalledWith('admin2', 'Pass123!x', 'admin');
    });

    it('requires users.create permission', async () => {
      const ctx = makeCtx({ permissions: new Set() });
      await expect(resolvers.Mutation.createUser({}, { username: 'u', password: 'p' }, ctx))
        .rejects.toThrow('Forbidden');
    });
  });

  // ── Mutation.deleteUser ─────────────────────────────────────────────
  describe('Mutation.deleteUser', () => {
    it('deletes a user when found', async () => {
      const ctx = makeCtx();
      ctx.storage.users.getUserById.mockResolvedValue({ id: 'u1' });

      const result = await resolvers.Mutation.deleteUser({}, { id: 'u1' }, ctx);
      expect(result).toBe(true);
    });

    it('throws when user is not found', async () => {
      const ctx = makeCtx();
      await expect(resolvers.Mutation.deleteUser({}, { id: 'nope' }, ctx))
        .rejects.toThrow('User not found: nope');
    });
  });

  // ── Mutation.activateUser ───────────────────────────────────────────
  describe('Mutation.activateUser', () => {
    it('activates a user and returns updated record', async () => {
      const ctx = makeCtx();
      const user = { id: 'u1', username: 'bob', active: false };
      const activated = { id: 'u1', username: 'bob', active: true };
      ctx.storage.users.getUserById
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce(activated);

      const result = await resolvers.Mutation.activateUser({}, { id: 'u1' }, ctx);
      expect(ctx.storage.users.activateUser).toHaveBeenCalledWith('u1');
      expect(result.active).toBe(true);
    });

    it('throws when user is not found', async () => {
      const ctx = makeCtx();
      await expect(resolvers.Mutation.activateUser({}, { id: 'nope' }, ctx))
        .rejects.toThrow('User not found: nope');
    });

    it('throws when user disappears after activation', async () => {
      const ctx = makeCtx();
      ctx.storage.users.getUserById
        .mockResolvedValueOnce({ id: 'u1' })
        .mockResolvedValueOnce(null);

      await expect(resolvers.Mutation.activateUser({}, { id: 'u1' }, ctx))
        .rejects.toThrow('User not found after activation: u1');
    });
  });

  // ── Mutation.deactivateUser ─────────────────────────────────────────
  describe('Mutation.deactivateUser', () => {
    it('deactivates a user and returns updated record', async () => {
      const ctx = makeCtx();
      const user = { id: 'u1', username: 'bob', active: true };
      const deactivated = { id: 'u1', username: 'bob', active: false };
      ctx.storage.users.getUserById
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce(deactivated);

      const result = await resolvers.Mutation.deactivateUser({}, { id: 'u1' }, ctx);
      expect(ctx.storage.users.deactivateUser).toHaveBeenCalledWith('u1');
      expect(result.active).toBe(false);
    });

    it('throws when user is not found', async () => {
      const ctx = makeCtx();
      await expect(resolvers.Mutation.deactivateUser({}, { id: 'nope' }, ctx))
        .rejects.toThrow('User not found: nope');
    });

    it('throws when user disappears after deactivation', async () => {
      const ctx = makeCtx();
      ctx.storage.users.getUserById
        .mockResolvedValueOnce({ id: 'u1' })
        .mockResolvedValueOnce(null);

      await expect(resolvers.Mutation.deactivateUser({}, { id: 'u1' }, ctx))
        .rejects.toThrow('User not found after deactivation: u1');
    });
  });

  // ── Mutation.resetPassword ──────────────────────────────────────────
  describe('Mutation.resetPassword', () => {
    it('resets password and returns true', async () => {
      const ctx = makeCtx();
      ctx.storage.users.getUserById.mockResolvedValue({ id: 'u1' });

      const result = await resolvers.Mutation.resetPassword({}, { id: 'u1', newPassword: 'NewPass1!a' }, ctx);
      expect(result).toBe(true);
      expect(ctx.storage.users.updatePassword).toHaveBeenCalledWith('u1', 'NewPass1!a');
    });

    it('throws when user is not found', async () => {
      const ctx = makeCtx();
      await expect(resolvers.Mutation.resetPassword({}, { id: 'nope', newPassword: 'x' }, ctx))
        .rejects.toThrow('User not found: nope');
    });

    it('requires users.reset_password permission', async () => {
      const ctx = makeCtx({ permissions: new Set() });
      await expect(resolvers.Mutation.resetPassword({}, { id: 'u1', newPassword: 'x' }, ctx))
        .rejects.toThrow('Forbidden');
    });
  });
});

// ---------------------------------------------------------------------------
// Schema export
// ---------------------------------------------------------------------------

describe('GraphQL schema', () => {
  it('exports a non-empty SDL string', async () => {
    const { schema } = await import('../../src/graphql/schema.js');
    expect(typeof schema).toBe('string');
    expect(schema.length).toBeGreaterThan(100);
    expect(schema).toContain('type Query');
    expect(schema).toContain('type Mutation');
  });

  it('defines all expected types', async () => {
    const { schema } = await import('../../src/graphql/schema.js');
    const expectedTypes = [
      'PageInfo', 'Scan', 'ScanConnection', 'Issue', 'IssueConnection',
      'Assignment', 'TrendPoint', 'ComplianceEntry', 'DashboardUser',
      'Team', 'Organization', 'Role', 'AuditEntry', 'AuditConnection', 'HealthStatus',
    ];
    for (const typeName of expectedTypes) {
      expect(schema).toContain(`type ${typeName}`);
    }
  });

  it('defines input types', async () => {
    const { schema } = await import('../../src/graphql/schema.js');
    expect(schema).toContain('input CreateScanInput');
    expect(schema).toContain('input AssignIssueInput');
  });
});
