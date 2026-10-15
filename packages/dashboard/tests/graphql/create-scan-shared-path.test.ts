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
import {
  ScanService,
  PRIVATE_TARGET_ERROR,
  SCAN_RATE_LIMIT_ERROR,
  createScanStartLimiter,
  type ScanStartLimiter,
} from '../../src/services/scan-service.js';
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

interface CallerOverrides {
  readonly user?: NonNullable<GraphQLContext['user']> & { apiKeyId?: string };
  readonly orgId?: string;
  readonly permissions?: readonly string[];
  readonly clientIp?: string;
}

function build(opts: {
  readonly config?: Partial<DashboardConfig>;
  readonly permissions?: readonly string[];
  readonly resolveHost?: () => Promise<readonly string[]>;
  readonly limiter?: ScanStartLimiter;
} & CallerOverrides = {}): Harness {
  const storage = makeStorage();
  const startScan = vi.fn();
  const orchestrator = { startScan } as unknown as ScanOrchestrator;
  const scanService = new ScanService(
    storage as never,
    orchestrator,
    makeConfig(opts.config),
    opts.resolveHost,
    opts.limiter,
  );
  const base = makeOrgCtx(storage, { permissions: opts.permissions ?? ['scans.create'] });
  const ctx = {
    ...base,
    ...(opts.user !== undefined ? { user: opts.user } : {}),
    ...(opts.orgId !== undefined ? { orgId: opts.orgId } : {}),
    ...(opts.clientIp !== undefined ? { clientIp: opts.clientIp } : {}),
    scanService,
    complianceToken: COMPLIANCE_TOKEN,
  } as GraphQLContext;
  return { storage, startScan, ctx };
}

/** A context for another caller that shares the harness's scan service. */
function as(base: GraphQLContext, caller: CallerOverrides): GraphQLContext {
  return {
    ...base,
    ...(caller.user !== undefined ? { user: caller.user } : {}),
    ...(caller.orgId !== undefined ? { orgId: caller.orgId } : {}),
    ...(caller.permissions !== undefined ? { permissions: new Set(caller.permissions) } : {}),
    ...(caller.clientIp !== undefined ? { clientIp: caller.clientIp } : {}),
  } as GraphQLContext;
}

/** A limiter whose clock never moves: every start in one test is inside one window. */
function frozenLimiter(): ScanStartLimiter {
  return createScanStartLimiter({ now: () => 1_000_000 });
}

async function startMany(ctx: GraphQLContext, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await createScan(ctx, { siteUrl: 'https://example.com' });
  }
}

const IP_A = '203.0.113.7';
const IP_B = '198.51.100.7';

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
   *     ScanService.startScheduledScan creates the row for a due schedule.
   *   - db/migrate-data.ts: storage-to-storage data migration (copies rows
   *     between storages; it does not start scans).
   * The MCP dashboard_scan_site tool creates its row through initiateScan
   * (validation shared) but deliberately NOT through initiateScanAuthorized:
   * the in-app agent bridge stamps an empty permission set for org users and
   * the tool is gated by tool metadata instead.
   * Any new creator must be added here consciously.
   */
  it('SCAN-02 no source file outside the shared path creates a scan row', () => {
    const ALLOWED = new Set([
      ['services', 'scan-service.ts'].join(sep),
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

  /*
   * Start-site guard. Every scan row is created and every scan is started by the scan
   * service: calls that hand a scan to the orchestrator live in services/scan-service.ts and
   * services/scan-lifecycle.ts only; db/migrate-data.ts copies rows between storages.
   */
  it('HARD-14 only the scan service starts scans', () => {
    const lifecycle = ['services', 'scan-lifecycle.ts'].join(sep);
    const ALLOWED = new Set([
      ['services', 'scan-service.ts'].join(sep),
      lifecycle,
    ]);
    const matched: string[] = [];
    for (const abs of walkTs(SRC_ROOT)) {
      const lines = readFileSync(abs, 'utf8').split('\n');
      if (lines.some((line) => !isCommentLine(line) && /\.startScan\(/.test(line))) {
        matched.push(relative(SRC_ROOT, abs));
      }
    }
    expect(matched, 'the walker must be able to match the lifecycle start call').toContain(lifecycle);
    const offenders = matched.filter((rel) => !ALLOWED.has(rel));
    expect(offenders).toEqual([]);
  });

  /*
   * Call-site guard for the two entry points. Exactly two source files call
   * initiateScan directly: the service itself (inside initiateScanAuthorized)
   * and the MCP dashboard_scan_site tool, a documented exception (D-90-02):
   * the in-app agent bridge stamps an empty permission set for org users, so
   * that tool is gated by tool metadata and cannot carry a request permission
   * set. The scan form route and the GraphQL resolver call
   * initiateScanAuthorized, and the POST /scan/new registration carries no
   * route-level permission guard that would refuse before the shared function
   * runs (it would hide a broken shared check).
   */
  it('SCAN-02 only the authorized shared path and the documented MCP exception call initiateScan', () => {
    const ALLOWED = new Set([
      ['services', 'scan-service.ts'].join(sep),
      ['mcp', 'tools', 'data.ts'].join(sep),
    ]);
    const matched: string[] = [];
    for (const abs of walkTs(SRC_ROOT)) {
      const lines = readFileSync(abs, 'utf8').split('\n');
      if (lines.some((line) => !isCommentLine(line) && /\.initiateScan\(/.test(line))) {
        matched.push(relative(SRC_ROOT, abs));
      }
    }
    expect(matched, 'the walker must be able to match the MCP tool call').toContain(
      ['mcp', 'tools', 'data.ts'].join(sep),
    );
    expect(matched.filter((rel) => !ALLOWED.has(rel))).toEqual([]);

    const codeOf = (rel: string[]): string =>
      readFileSync(join(SRC_ROOT, ...rel), 'utf8')
        .split('\n')
        .filter((line) => !isCommentLine(line))
        .join('\n');
    const routeCode = codeOf(['routes', 'scan.ts']);
    expect(routeCode).toMatch(/initiateScanAuthorized\(/);
    expect(codeOf(['graphql', 'resolvers.ts'])).toMatch(/initiateScanAuthorized\(/);

    const start = routeCode.indexOf("server.post(\n    '/scan/new'");
    expect(start, 'the POST /scan/new registration must be found').toBeGreaterThanOrEqual(0);
    const rest = routeCode.slice(start + 1);
    const nextReg = rest.search(/server\.(get|post)\(/);
    const region = nextReg === -1 ? rest : rest.slice(0, nextReg);
    expect(region.length).toBeGreaterThan(200);
    expect(region).not.toMatch(/requirePermission\(/);
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

describe('graphql createScan scan start rate limit', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('SCAN-02 graphql createScan refuses the 31st start in ten minutes with the shared rate limit message', async () => {
    const { ctx, storage, startScan } = build({ limiter: frozenLimiter(), clientIp: IP_A });
    await startMany(ctx, 30);
    expect(startScan).toHaveBeenCalledTimes(30);
    expect(storage.scans.createScan).toHaveBeenCalledTimes(30);

    await expect(createScan(ctx, { siteUrl: 'https://example.com' })).rejects.toThrow(
      new Error(SCAN_RATE_LIMIT_ERROR),
    );
    expect(startScan).toHaveBeenCalledTimes(30);
    expect(storage.scans.createScan).toHaveBeenCalledTimes(30);
  });

  it('SCAN-02 graphql createScan rate limit refuses one user and still lets a different user start', async () => {
    const { ctx, startScan } = build({
      limiter: frozenLimiter(),
      clientIp: IP_A,
      user: { id: 'user-a', username: 'user-a', role: 'user', currentOrgId: FABRIKAM_ORG },
    });
    await startMany(ctx, 30);
    await expect(createScan(ctx, { siteUrl: 'https://example.com' })).rejects.toThrow(
      new Error(SCAN_RATE_LIMIT_ERROR),
    );
    expect(startScan).toHaveBeenCalledTimes(30);

    const other = as(ctx, {
      user: { id: 'user-b', username: 'user-b', role: 'user', currentOrgId: FABRIKAM_ORG },
    });
    await createScan(other, { siteUrl: 'https://example.com' });
    expect(startScan).toHaveBeenCalledTimes(31);
  });

  it('SCAN-02 graphql createScan rate limit is not reset by switching org or by the admin role', async () => {
    const fabrikam = build({
      limiter: frozenLimiter(),
      clientIp: IP_A,
      orgId: FABRIKAM_ORG,
      permissions: ['scans.create'],
      user: { id: 'user-shared', username: 'shared', role: 'user', currentOrgId: FABRIKAM_ORG },
    });
    const system = as(fabrikam.ctx, {
      orgId: 'system',
      permissions: ['scans.create', 'admin.system'],
      user: { id: 'user-shared', username: 'shared', role: 'admin', currentOrgId: 'system' },
    });
    const northwind = as(fabrikam.ctx, {
      orgId: NORTHWIND_ORG,
      permissions: ['scans.create'],
      user: { id: 'user-shared', username: 'shared', role: 'user', currentOrgId: NORTHWIND_ORG },
    });

    await startMany(fabrikam.ctx, 15);
    await startMany(system, 15);
    expect(fabrikam.startScan).toHaveBeenCalledTimes(30);
    await expect(createScan(northwind, { siteUrl: 'https://example.com' })).rejects.toThrow(
      new Error(SCAN_RATE_LIMIT_ERROR),
    );
    expect(fabrikam.startScan).toHaveBeenCalledTimes(30);
  });

  it('SCAN-02 graphql createScan rate limit gives each api key its own bucket', async () => {
    const { ctx, startScan } = build({
      limiter: frozenLimiter(),
      clientIp: IP_A,
      user: { id: 'api-key', username: 'api-key', role: 'admin', currentOrgId: 'system', apiKeyId: 'key-fabrikam' },
    });
    await startMany(ctx, 30);
    await expect(createScan(ctx, { siteUrl: 'https://example.com' })).rejects.toThrow(
      new Error(SCAN_RATE_LIMIT_ERROR),
    );

    const otherKey = as(ctx, {
      user: { id: 'api-key', username: 'api-key', role: 'admin', currentOrgId: 'system', apiKeyId: 'key-northwind' },
    });
    await createScan(otherKey, { siteUrl: 'https://example.com' });
    expect(startScan).toHaveBeenCalledTimes(31);
  });

  it('SCAN-02 graphql createScan rate limit falls back to the caller address for an api key without a key id', async () => {
    const { ctx, startScan } = build({
      limiter: frozenLimiter(),
      clientIp: IP_A,
      user: { id: 'api-key', username: 'api-key', role: 'admin', currentOrgId: 'system' },
    });
    await startMany(ctx, 30);
    const second = as(ctx, {
      user: { id: 'api-key', username: 'api-key', role: 'admin', currentOrgId: 'system' },
    });
    await expect(createScan(second, { siteUrl: 'https://example.com' })).rejects.toThrow(
      new Error(SCAN_RATE_LIMIT_ERROR),
    );

    const elsewhere = as(ctx, {
      user: { id: 'api-key', username: 'api-key', role: 'admin', currentOrgId: 'system' },
      clientIp: IP_B,
    });
    await createScan(elsewhere, { siteUrl: 'https://example.com' });
    expect(startScan).toHaveBeenCalledTimes(31);
  });

  it('SCAN-02 graphql createScan counts refused start attempts toward the rate limit', async () => {
    const { ctx, storage, startScan } = build({ limiter: frozenLimiter(), clientIp: IP_A });
    for (let i = 0; i < 30; i += 1) {
      await expect(createScan(ctx, { siteUrl: 'ftp://files.example' })).rejects.toThrow(
        new Error('URL must use http or https'),
      );
    }
    expect(startScan).not.toHaveBeenCalled();

    await expect(createScan(ctx, { siteUrl: 'https://example.com' })).rejects.toThrow(
      new Error(SCAN_RATE_LIMIT_ERROR),
    );
    expect(startScan).not.toHaveBeenCalled();
    expect(storage.scans.createScan).not.toHaveBeenCalled();
  });

  it('SCAN-02 graphql createScan is rate limited when the scan service gets no injected limiter', async () => {
    const { ctx, startScan } = build({ clientIp: IP_A });
    await startMany(ctx, 30);
    await expect(createScan(ctx, { siteUrl: 'https://example.com' })).rejects.toThrow(
      new Error(SCAN_RATE_LIMIT_ERROR),
    );
    expect(startScan).toHaveBeenCalledTimes(30);
  });
});

describe('graphql createScan null list inputs mean none', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function startedWith(startScan: ReturnType<typeof vi.fn>): Record<string, unknown> {
    return startScan.mock.calls[0]![1] as Record<string, unknown>;
  }

  function storedWith(storage: ReturnType<typeof makeStorage>): Record<string, unknown> {
    return storage.scans.createScan.mock.calls[0]![0] as Record<string, unknown>;
  }

  it('NULL-01 jurisdictions null reaches storage and orchestrator as none', async () => {
    const { ctx, storage, startScan } = build();
    await createScan(ctx, { siteUrl: 'https://example.com', jurisdictions: null });

    expect(startScan).toHaveBeenCalledTimes(1);
    expect(storedWith(storage)['jurisdictions']).toEqual([]);
    expect(startedWith(startScan)['jurisdictions']).toEqual([]);
  });

  it('NULL-01 jurisdictions null behaves exactly like jurisdictions omitted', async () => {
    const omitted = build();
    await createScan(omitted.ctx, { siteUrl: 'https://example.com' });
    const withNull = build();
    await createScan(withNull.ctx, { siteUrl: 'https://example.com', jurisdictions: null });

    expect(storedWith(withNull.storage)['jurisdictions']).toEqual(
      storedWith(omitted.storage)['jurisdictions'],
    );
    expect(startedWith(withNull.startScan)['jurisdictions']).toEqual(
      startedWith(omitted.startScan)['jurisdictions'],
    );
  });

  it('NULL-02 jurisdictions with null elements keep only the strings', async () => {
    const { ctx, storage, startScan } = build();
    await createScan(ctx, { siteUrl: 'https://example.com', jurisdictions: [null, 'EU', '', 'US'] });

    expect(storedWith(storage)['jurisdictions']).toEqual(['EU', 'US']);
    expect(startedWith(startScan)['jurisdictions']).toEqual(['EU', 'US']);
  });

  it('NULL-03 regulations null reaches storage and orchestrator as none', async () => {
    const { ctx, storage, startScan } = build();
    const result = await ctx.scanService.initiateScanAuthorized(
      { siteUrl: 'https://example.com', regulations: null as unknown as string[] },
      {
        username: ctx.user!.username,
        orgId: ctx.orgId,
        complianceToken: COMPLIANCE_TOKEN,
        permissions: ctx.permissions,
        startSubject: { userId: ctx.user!.id, apiKeyId: undefined, clientIp: IP_A },
      },
    );

    expect(result.ok).toBe(true);
    expect(storedWith(storage)['regulations']).toEqual([]);
    expect(startedWith(startScan)['regulations']).toEqual([]);
  });
});
