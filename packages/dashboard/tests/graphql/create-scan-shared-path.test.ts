/**
 * GraphQL createScan runs through the SAME service function as the scan form.
 *
 * Every test calls resolvers.Mutation.createScan directly with a context that
 * carries a REAL ScanService over a mock storage and an orchestrator stub, so a
 * result here is a statement about the shared path, not about a mock of it.
 * Org ids and hosts are placeholders (Fabrikam / Northwind, *.example,
 * documentation addresses).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Hermetic DNS for the start-URL SSRF check: every host resolves to a public
// documentation address; no real DNS lookups.
vi.mock('../../src/services/host-resolver.js', () => ({
  systemHostResolver: async (): Promise<readonly string[]> => ['93.184.215.14'],
}));

import { resolvers } from '../../src/graphql/resolvers.js';
import type { GraphQLContext } from '../../src/graphql/resolvers.js';
import { ScanService, PRIVATE_TARGET_ERROR } from '../../src/services/scan-service.js';
import type { DashboardConfig } from '../../src/config.js';
import type { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import { makeOrgCtx, FABRIKAM_ORG, NORTHWIND_ORG } from './helpers/org-ctx.js';

const SRC_ROOT = join(__dirname, '..', '..', 'src');
const COMPLIANCE_TOKEN = 'ctx-compliance-token';

function makeStorage() {
  return {
    scans: {
      createScan: vi.fn().mockImplementation((input: Record<string, unknown>) =>
        Promise.resolve({ ...input, status: 'queued' })),
    },
    organizations: {
      getDeepScanDefault: vi.fn().mockResolvedValue(false),
    },
  };
}

function makeConfig(overrides: Partial<DashboardConfig> = {}): DashboardConfig {
  return {
    maxConcurrentScans: 2,
    maxPages: 100,
    runner: 'htmlcs',
    complianceUrl: 'http://compliance.invalid',
    allowPrivateScanTargets: false,
    ...overrides,
  } as unknown as DashboardConfig;
}

interface Harness {
  readonly storage: ReturnType<typeof makeStorage>;
  readonly startScan: ReturnType<typeof vi.fn>;
  readonly ctx: GraphQLContext;
}

function build(opts: {
  readonly config?: Partial<DashboardConfig>;
  readonly permissions?: readonly string[];
  readonly resolveHost?: () => Promise<readonly string[]>;
} = {}): Harness {
  const storage = makeStorage();
  const startScan = vi.fn();
  const orchestrator = { startScan } as unknown as ScanOrchestrator;
  const scanService = new ScanService(
    storage as never,
    orchestrator,
    makeConfig(opts.config),
    opts.resolveHost,
  );
  const base = makeOrgCtx(storage, { permissions: opts.permissions ?? ['scans.create'] });
  const ctx = { ...base, scanService, complianceToken: COMPLIANCE_TOKEN } as GraphQLContext;
  return { storage, startScan, ctx };
}

function createScan(ctx: GraphQLContext, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return (resolvers.Mutation.createScan as (r: unknown, a: unknown, c: GraphQLContext) => Promise<Record<string, unknown>>)(
    {},
    { input },
    ctx,
  );
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      out.push(...walkTs(abs));
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(abs);
    }
  }
  return out;
}

describe('graphql createScan shares the scan form path', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('SCAN-01 graphql createScan hands the new scan to the orchestrator', async () => {
    const { ctx, storage, startScan } = build();
    const result = await createScan(ctx, { siteUrl: 'https://example.com' });

    expect(startScan).toHaveBeenCalledTimes(1);
    const [startedId, config] = startScan.mock.calls[0] as [string, Record<string, unknown>];
    expect(storage.scans.createScan).toHaveBeenCalledTimes(1);
    const stored = storage.scans.createScan.mock.calls[0]![0] as Record<string, unknown>;
    expect(startedId).toBe(result['id']);
    expect(startedId).toBe(stored['id']);
    expect(config['siteUrl']).toBe('https://example.com/');
    expect(config['orgId']).toBe(ctx.orgId);
    expect(stored['createdBy']).toBe(ctx.user!.username);
    expect(result['status']).toBe('queued');
  });

  it('SCAN-02 graphql createScan refuses a loopback target like scan new', async () => {
    const { ctx, storage, startScan } = build({ config: { allowPrivateScanTargets: false } });
    await expect(createScan(ctx, { siteUrl: 'http://127.0.0.1/' })).rejects.toThrow(
      new Error(PRIVATE_TARGET_ERROR),
    );
    expect(storage.scans.createScan).not.toHaveBeenCalled();
    expect(startScan).not.toHaveBeenCalled();
  });

  it('SCAN-02 graphql createScan refuses a name that resolves to a private address', async () => {
    const { ctx, storage, startScan } = build({ resolveHost: async () => ['10.0.0.5'] });
    await expect(createScan(ctx, { siteUrl: 'https://intranet.fabrikam.example/' })).rejects.toThrow(
      new Error(PRIVATE_TARGET_ERROR),
    );
    expect(storage.scans.createScan).not.toHaveBeenCalled();
    expect(startScan).not.toHaveBeenCalled();
  });

  it('SCAN-02 graphql createScan honours allowPrivateScanTargets like scan new', async () => {
    const { ctx, startScan } = build({ config: { allowPrivateScanTargets: true } });
    await createScan(ctx, { siteUrl: 'http://127.0.0.1:8080/' });

    expect(startScan).toHaveBeenCalledTimes(1);
    const config = startScan.mock.calls[0]![1] as Record<string, unknown>;
    expect(config['siteUrl']).toBe('http://127.0.0.1:8080/');
  });

  it('SCAN-02 graphql createScan refuses a caller without the scan create permission', async () => {
    const { ctx, storage, startScan } = build({ permissions: [] });
    await expect(createScan(ctx, { siteUrl: 'https://example.com' })).rejects.toThrow(
      new Error('Forbidden: requires scans.create'),
    );
    expect(storage.scans.createScan).not.toHaveBeenCalled();
    expect(startScan).not.toHaveBeenCalled();
  });

  it('SCAN-02 graphql createScan takes the org from the context never the input', async () => {
    const { ctx, storage, startScan } = build();
    expect(ctx.orgId).toBe(FABRIKAM_ORG);
    await createScan(ctx, { siteUrl: 'https://example.com', orgId: NORTHWIND_ORG });

    const stored = storage.scans.createScan.mock.calls[0]![0] as Record<string, unknown>;
    const started = startScan.mock.calls[0]![1] as Record<string, unknown>;
    expect(stored['orgId']).toBe(FABRIKAM_ORG);
    expect(started['orgId']).toBe(FABRIKAM_ORG);

    const schema = readFileSync(join(SRC_ROOT, 'graphql', 'schema.ts'), 'utf8');
    const block = /input CreateScanInput \{([^}]*)\}/.exec(schema);
    expect(block, 'CreateScanInput block must be found in schema.ts').not.toBeNull();
    expect(block![1]).not.toMatch(/org/i);
  });

  it('SCAN-02 graphql createScan caps jurisdictions at fifty like scan new', async () => {
    const { ctx, storage, startScan } = build();
    const jurisdictions = Array.from({ length: 51 }, (_v, i) => `J${i}`);
    await expect(createScan(ctx, { siteUrl: 'https://example.com', jurisdictions })).rejects.toThrow(
      new Error('Maximum 50 jurisdictions per scan'),
    );
    expect(storage.scans.createScan).not.toHaveBeenCalled();
    expect(startScan).not.toHaveBeenCalled();
  });

  it('SCAN-02 graphql createScan rejects an invalid standard like scan new', async () => {
    const { ctx, storage, startScan } = build();
    await expect(createScan(ctx, { siteUrl: 'https://example.com', standard: 'WCAG3' })).rejects.toThrow(
      new Error('standard must be one of: WCAG2A, WCAG2AA, WCAG2AAA'),
    );
    expect(storage.scans.createScan).not.toHaveBeenCalled();
    expect(startScan).not.toHaveBeenCalled();
  });

  it('SCAN-02 graphql createScan applies includeWarnings and includeNotices', async () => {
    const { ctx, startScan } = build();
    await createScan(ctx, { siteUrl: 'https://example.com', includeWarnings: false, includeNotices: false });

    const config = startScan.mock.calls[0]![1] as Record<string, unknown>;
    expect(config['includeWarnings']).toBe(false);
    expect(config['includeNotices']).toBe(false);
  });

  /*
   * Single-row-creator guard. Scan rows are created in exactly these places:
   *   - services/scan-service.ts: ScanService.initiateScan, the one shared
   *     function behind the scan form, GraphQL createScan (through
   *     initiateScanAuthorized) and the MCP dashboard_scan_site tool.
   *   - scheduler.ts: the recurring-schedule runner.
   *   - db/migrate-data.ts: storage-to-storage data migration.
   * The MCP dashboard_scan_site tool creates its row through initiateScan
   * (validation shared) but deliberately NOT through initiateScanAuthorized:
   * the in-app agent bridge stamps an empty permission set for org users and
   * the tool is gated by tool metadata instead.
   * Any new creator must be added here consciously.
   */
  it('SCAN-02 no source file outside the shared path creates a scan row', () => {
    const ALLOWED = new Set([
      ['services', 'scan-service.ts'].join(sep),
      'scheduler.ts',
      ['db', 'migrate-data.ts'].join(sep),
    ]);
    const matched: string[] = [];
    for (const abs of walkTs(SRC_ROOT)) {
      const lines = readFileSync(abs, 'utf8').split('\n');
      if (lines.some((line) => !isCommentLine(line) && /\.scans\.createScan\(/.test(line))) {
        matched.push(relative(SRC_ROOT, abs));
      }
    }
    expect(matched, 'the walker must be able to match the shared creator').toContain(
      ['services', 'scan-service.ts'].join(sep),
    );
    const offenders = matched.filter((rel) => !ALLOWED.has(rel));
    expect(offenders).toEqual([]);
  });

  it('SCAN-02 graphql createScan refuses an anonymous caller', async () => {
    const { ctx, storage, startScan } = build();
    const anon = { ...ctx, user: undefined } as GraphQLContext;
    await expect(createScan(anon, { siteUrl: 'https://example.com' })).rejects.toThrow(
      new Error('Authentication required'),
    );
    expect(storage.scans.createScan).not.toHaveBeenCalled();
    expect(startScan).not.toHaveBeenCalled();
  });
});
