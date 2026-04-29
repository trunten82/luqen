/**
 * Phase 33-02 + Phase 44 Plan 01 (AGENT-04) — context-hints unit tests.
 *
 * Covers:
 *   - existing scans + brands + org identity collection (Phase 33)
 *   - new section helpers added in Phase 44:
 *       buildProposalsSection, buildJurisdictionSection,
 *       buildRegulationsSection, buildRoleHintsSection
 *   - integration: collectContextHints + formatContextHints render every
 *     section in the documented order, and silently omit any empty section.
 *
 * Compliance HTTP calls are stubbed via global.fetch — the helpers reach into
 * compliance-client which uses the global `fetch`, so a per-test fetch mock
 * exercises the real client code path without spinning up the service.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildProposalsSection,
  buildJurisdictionSection,
  buildRegulationsSection,
  buildRoleHintsSection,
  collectContextHints,
  formatContextHints,
  RECENT_PROPOSALS_CAP,
  ACTIVE_REGULATIONS_CAP,
  type ComplianceAccess,
  type ContextHints,
} from '../../src/agent/context-hints.js';
import { PERMISSION_LABELS, formatRoleHints } from '../../src/agent/permission-labels.js';
import type { StorageAdapter } from '../../src/db/index.js';

// ---------------------------------------------------------------------------
// Storage stubs — only the repos that fetch* uses are wired; everything else
// is left undefined and would throw on access (which we want — surface drift
// loudly).
// ---------------------------------------------------------------------------

function makeStorage(opts: {
  scans?: unknown[];
  brands?: unknown[];
  org?: { id: string; name: string } | null;
  scansThrows?: boolean;
  brandsThrows?: boolean;
  orgThrows?: boolean;
} = {}): StorageAdapter {
  return {
    scans: {
      listScans: async () => {
        if (opts.scansThrows === true) throw new Error('boom');
        return (opts.scans ?? []) as never;
      },
    },
    branding: {
      listGuidelines: async () => {
        if (opts.brandsThrows === true) throw new Error('boom');
        return (opts.brands ?? []) as never;
      },
    },
    organizations: {
      getOrg: async () => {
        if (opts.orgThrows === true) throw new Error('boom');
        return opts.org ?? null;
      },
    },
  } as unknown as StorageAdapter;
}

// ---------------------------------------------------------------------------
// Fetch mock helpers — emulate the compliance HTTP API
// ---------------------------------------------------------------------------

interface FetchRoute {
  readonly match: (url: string) => boolean;
  readonly response: () => Response;
}

function installFetch(routes: FetchRoute[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      const route = routes.find((r) => r.match(url));
      if (route === undefined) {
        return new Response('not stubbed', { status: 500 });
      }
      return route.response();
    }),
  );
}

const ACCESS: ComplianceAccess = async () => ({
  baseUrl: 'http://compliance.test',
  token: 'tok-xyz',
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// permission-labels
// ---------------------------------------------------------------------------

describe('permission-labels.formatRoleHints', () => {
  it('maps curated permission ids to friendly labels in declaration order', () => {
    const result = formatRoleHints(new Set(['scans.create', 'compliance.manage']));
    // declaration order: compliance.manage before scans.create
    expect(result).toBe('manage regulations & proposals, run accessibility scans');
  });

  it('returns null when no curated permission matches', () => {
    expect(formatRoleHints(new Set(['unknown.perm', 'scans.schedule']))).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(formatRoleHints(new Set())).toBeNull();
  });

  it('keeps the curated label set small (5-8 entries) per CONTEXT specifics', () => {
    const count = Object.keys(PERMISSION_LABELS).length;
    expect(count).toBeGreaterThanOrEqual(5);
    expect(count).toBeLessThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// buildProposalsSection
// ---------------------------------------------------------------------------

describe('buildProposalsSection', () => {
  it('returns up to 5 pending proposals when access succeeds', async () => {
    const data = Array.from({ length: 7 }, (_, i) => ({
      id: `p-${i}`,
      status: 'pending',
      source: 'auto',
      type: 'wcag-update',
      summary: `proposal ${i}`,
      detectedAt: '2026-04-20T00:00:00Z',
    }));
    installFetch([
      {
        match: (u) => u.includes('/api/v1/updates'),
        response: () => new Response(JSON.stringify({ data }), { status: 200 }),
      },
    ]);
    const result = await buildProposalsSection('org-1', ACCESS);
    expect(result).not.toBeNull();
    expect(result!).toHaveLength(RECENT_PROPOSALS_CAP);
    expect(result![0]).toMatchObject({ id: 'p-0', type: 'wcag-update' });
  });

  it('returns [] when the compliance API returns an empty list', async () => {
    installFetch([
      {
        match: (u) => u.includes('/api/v1/updates'),
        response: () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
      },
    ]);
    const result = await buildProposalsSection('org-1', ACCESS);
    expect(result).toEqual([]);
  });

  it('returns null when access factory yields null (compliance unconfigured)', async () => {
    const noAccess: ComplianceAccess = async () => null;
    const result = await buildProposalsSection('org-1', noAccess);
    expect(result).toBeNull();
  });

  it('returns null when access is undefined (no opt-in)', async () => {
    const result = await buildProposalsSection('org-1', undefined);
    expect(result).toBeNull();
  });

  it('returns null on fetch error (never throws)', async () => {
    installFetch([
      {
        match: (u) => u.includes('/api/v1/updates'),
        response: () => new Response('oops', { status: 500 }),
      },
    ]);
    const result = await buildProposalsSection('org-1', ACCESS);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildJurisdictionSection
// ---------------------------------------------------------------------------

describe('buildJurisdictionSection', () => {
  it('returns only jurisdictions whose orgId matches the caller org', async () => {
    installFetch([
      {
        match: (u) => u.includes('/api/v1/jurisdictions'),
        response: () =>
          new Response(
            JSON.stringify({
              data: [
                { id: 'EU', name: 'European Union', type: 'region' }, // system
                { id: 'org-x', name: 'Custom X', type: 'custom', orgId: 'org-1', iso3166: 'X' },
                { id: 'org-y', name: 'Custom Y', type: 'custom', orgId: 'org-2' },
              ],
            }),
            { status: 200 },
          ),
      },
    ]);
    const result = await buildJurisdictionSection('org-1', ACCESS);
    expect(result).toEqual([
      { id: 'org-x', name: 'Custom X', type: 'custom', iso3166: 'X' },
    ]);
  });

  it('returns [] when the org has no custom jurisdictions', async () => {
    installFetch([
      {
        match: (u) => u.includes('/api/v1/jurisdictions'),
        response: () =>
          new Response(
            JSON.stringify({
              data: [{ id: 'EU', name: 'European Union', type: 'region' }],
            }),
            { status: 200 },
          ),
      },
    ]);
    const result = await buildJurisdictionSection('org-1', ACCESS);
    expect(result).toEqual([]);
  });

  it('returns null in cross-org admin mode (orgId === "")', async () => {
    const result = await buildJurisdictionSection('', ACCESS);
    expect(result).toBeNull();
  });

  it('returns null on error', async () => {
    installFetch([
      {
        match: (u) => u.includes('/api/v1/jurisdictions'),
        response: () => new Response('boom', { status: 500 }),
      },
    ]);
    const result = await buildJurisdictionSection('org-1', ACCESS);
    expect(result).toBeNull();
  });

  it('returns null when access undefined', async () => {
    expect(await buildJurisdictionSection('org-1', undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildRegulationsSection
// ---------------------------------------------------------------------------

describe('buildRegulationsSection', () => {
  it('truncates active regulations at 10', async () => {
    const data = Array.from({ length: 14 }, (_, i) => ({
      id: `r-${i}`,
      name: `Reg ${i}`,
      shortName: `R${i}`,
      jurisdictionId: 'EU',
      enforcementDate: '2025-01-01',
      status: 'active',
      scope: 'public',
    }));
    installFetch([
      {
        match: (u) => u.includes('/api/v1/regulations'),
        response: () => new Response(JSON.stringify({ data }), { status: 200 }),
      },
    ]);
    const result = await buildRegulationsSection('org-1', ACCESS);
    expect(result).not.toBeNull();
    expect(result!).toHaveLength(ACTIVE_REGULATIONS_CAP);
  });

  it('filters out non-active statuses', async () => {
    installFetch([
      {
        match: (u) => u.includes('/api/v1/regulations'),
        response: () =>
          new Response(
            JSON.stringify({
              data: [
                { id: 'a', name: 'Active', shortName: 'A', jurisdictionId: 'EU', enforcementDate: '2024', status: 'active', scope: 'public' },
                { id: 'b', name: 'Retired', shortName: 'B', jurisdictionId: 'EU', enforcementDate: '2024', status: 'retired', scope: 'public' },
                { id: 'c', name: 'In-force', shortName: 'C', jurisdictionId: 'EU', enforcementDate: '2024', status: 'in-force', scope: 'public' },
              ],
            }),
            { status: 200 },
          ),
      },
    ]);
    const result = await buildRegulationsSection('org-1', ACCESS);
    expect(result?.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('returns null on error', async () => {
    installFetch([
      {
        match: (u) => u.includes('/api/v1/regulations'),
        response: () => new Response('nope', { status: 500 }),
      },
    ]);
    const result = await buildRegulationsSection('org-1', ACCESS);
    expect(result).toBeNull();
  });

  it('returns null when access undefined', async () => {
    expect(await buildRegulationsSection('org-1', undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildRoleHintsSection
// ---------------------------------------------------------------------------

describe('buildRoleHintsSection', () => {
  it('maps perms via formatRoleHints', () => {
    expect(buildRoleHintsSection(new Set(['admin.system']))).toBe('system admin (all orgs)');
  });

  it('returns null on undefined perms', () => {
    expect(buildRoleHintsSection(undefined)).toBeNull();
  });

  it('returns null when no curated match', () => {
    expect(buildRoleHintsSection(new Set(['scans.schedule']))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// collectContextHints + formatContextHints integration
// ---------------------------------------------------------------------------

describe('collectContextHints + formatContextHints', () => {
  beforeEach(() => {
    installFetch([
      {
        match: (u) => u.includes('/api/v1/updates'),
        response: () =>
          new Response(
            JSON.stringify({
              data: [
                { id: 'p-1', status: 'pending', source: 'auto', type: 'wcag', summary: 'New WCAG 2.2 criterion', detectedAt: '2026-04-20' },
              ],
            }),
            { status: 200 },
          ),
      },
      {
        match: (u) => u.includes('/api/v1/jurisdictions'),
        response: () =>
          new Response(
            JSON.stringify({
              data: [{ id: 'j-1', name: 'Custom J', type: 'custom', orgId: 'org-1' }],
            }),
            { status: 200 },
          ),
      },
      {
        match: (u) => u.includes('/api/v1/regulations'),
        response: () =>
          new Response(
            JSON.stringify({
              data: [
                { id: 'reg-1', name: 'Reg One', shortName: 'R1', jurisdictionId: 'EU', enforcementDate: '2024', status: 'active', scope: 'public' },
              ],
            }),
            { status: 200 },
          ),
      },
    ]);
  });

  it('renders every section in order when all data present', async () => {
    const storage = makeStorage({
      scans: [{ id: 's-1', siteUrl: 'https://a.test', status: 'completed', totalIssues: 3, createdAt: '2026-04-25' }],
      brands: [{ id: 'b-1', name: 'House Style' }],
      org: { id: 'org-1', name: 'Acme Inc' },
    });
    const hints = await collectContextHints(storage, {
      userId: 'u-1',
      orgId: 'org-1',
      complianceAccess: ACCESS,
      permissions: new Set(['compliance.manage', 'scans.create']),
    });
    const text = formatContextHints(hints);

    // Order: scans → brands → proposals → jurisdictions → regulations → role hints
    const idxScans = text.indexOf('Recent scans');
    const idxBrands = text.indexOf('Active brand guidelines');
    const idxProposals = text.indexOf('Recent proposals awaiting your action');
    const idxJur = text.indexOf('Org-defined jurisdictions');
    const idxRegs = text.indexOf('Active regulations');
    const idxRole = text.indexOf('Your role hints');

    expect(idxScans).toBeGreaterThan(-1);
    expect(idxBrands).toBeGreaterThan(idxScans);
    expect(idxProposals).toBeGreaterThan(idxBrands);
    expect(idxJur).toBeGreaterThan(idxProposals);
    expect(idxRegs).toBeGreaterThan(idxJur);
    expect(idxRole).toBeGreaterThan(idxRegs);

    expect(text).toContain('New WCAG 2.2 criterion');
    expect(text).toContain('Custom J');
    expect(text).toContain('Reg One');
    expect(text).toContain('manage regulations & proposals');
  });

  it('omits empty sections silently — no orphan headings or blank lines for missing data', async () => {
    vi.unstubAllGlobals(); // turn off compliance fetch
    const storage = makeStorage({ org: { id: 'org-1', name: 'Acme' } });
    const hints: ContextHints = await collectContextHints(storage, {
      userId: 'u-1',
      orgId: 'org-1',
      // no complianceAccess, no permissions → all Phase 44 sections empty
    });
    const text = formatContextHints(hints);
    expect(text).not.toContain('Recent proposals awaiting your action');
    expect(text).not.toContain('Org-defined jurisdictions');
    expect(text).not.toContain('Active regulations');
    expect(text).not.toContain('Your role hints');
    // Existing scans + brands sections still emitted with "(none)"
    expect(text).toContain('Recent scans');
    expect(text).toContain('  - (none)');
  });

  it('renders only the populated subset when partial data is present', async () => {
    const storage = makeStorage({ org: { id: 'org-1', name: 'Acme' } });
    const hints = await collectContextHints(storage, {
      userId: 'u-1',
      orgId: 'org-1',
      // No complianceAccess so proposals/jur/regs all empty.
      permissions: new Set(['admin.system']),
    });
    const text = formatContextHints(hints);
    expect(text).not.toContain('Recent proposals awaiting your action');
    expect(text).not.toContain('Org-defined jurisdictions');
    expect(text).not.toContain('Active regulations');
    expect(text).toContain('Your role hints — you can: system admin (all orgs).');
  });
});
