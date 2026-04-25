/**
 * Phase 36 Plan 05 — /admin/audit (agent audit) route tests.
 *
 * Coverage:
 *  - Test 1: outcomeDetail filter passed to repository
 *  - Test 2: empty outcomeDetail string is omitted from filters
 *  - Test 3: outcomeDetail preserved in pagination links
 *  - Test 4: rendered HTML truncates rationale + hides full text in expandable panel
 *  - Test 5: rendered HTML for null rationale shows em-dash, no expand button
 *  - Test 6: CSV export appends a `rationale` column
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import handlebars from 'handlebars';

import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { agentAuditRoutes } from '../../src/routes/admin/agent-audit.js';
import { loadTranslations, t } from '../../src/i18n/index.js';
import type { AgentAuditEntry } from '../../src/db/interfaces/agent-audit-repository.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TestContext {
  server: FastifyInstance;
  storage: SqliteStorageAdapter;
  listSpy: ReturnType<typeof vi.spyOn>;
  countSpy: ReturnType<typeof vi.spyOn>;
  cleanup: () => Promise<void>;
}

const ORG_ID = 'org-a';
const USER_ID = 'user-1';

function makeEntry(over: Partial<AgentAuditEntry> = {}): AgentAuditEntry {
  return {
    id: over.id ?? randomUUID(),
    userId: over.userId ?? USER_ID,
    orgId: over.orgId ?? ORG_ID,
    conversationId: over.conversationId ?? null,
    toolName: over.toolName ?? 'list_scans',
    argsJson: over.argsJson ?? '{}',
    outcome: over.outcome ?? 'success',
    outcomeDetail: over.outcomeDetail ?? null,
    rationale: over.rationale === undefined ? null : over.rationale,
    latencyMs: over.latencyMs ?? 12,
    createdAt: over.createdAt ?? new Date('2026-04-25T10:00:00Z').toISOString(),
  };
}

async function createTestServer(opts: {
  rows?: AgentAuditEntry[];
  total?: number;
  renderHtml?: boolean;
} = {}): Promise<TestContext> {
  loadTranslations();

  const dbPath = join(tmpdir(), `test-agent-audit-route-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const rows = opts.rows ?? [];
  const total = opts.total ?? rows.length;

  const listSpy = vi.spyOn(storage.agentAudit, 'listForOrg').mockResolvedValue(rows);
  const countSpy = vi.spyOn(storage.agentAudit, 'countForOrg').mockResolvedValue(total);
  vi.spyOn(storage.agentAudit, 'distinctUsers').mockResolvedValue([USER_ID]);
  vi.spyOn(storage.agentAudit, 'distinctToolNames').mockResolvedValue(['list_scans']);

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));

  if (opts.renderHtml === true) {
    const hb = handlebars.create();
    hb.registerHelper('t', function (key: string, options: { hash?: Record<string, unknown> }) {
      const params = options?.hash != null
        ? Object.fromEntries(
            Object.entries(options.hash).map(([k, v]) => [k, String(v ?? '')]),
          )
        : undefined;
      return t(key, 'en', params);
    });
    hb.registerHelper('eq', (a: unknown, b: unknown) => a === b);
    hb.registerHelper('gt', (a: unknown, b: unknown) => Number(a) > Number(b));
    const viewsDir = join(__dirname, '../../src/views');
    await server.register(import('@fastify/view'), {
      engine: { handlebars: hb },
      root: viewsDir,
    });
  } else {
    server.decorateReply(
      'view',
      function (this: FastifyReply, template: string, data: unknown) {
        return this.code(200).header('content-type', 'application/json').send(
          JSON.stringify({ template, data }),
        );
      },
    );
  }

  server.addHook('preHandler', async (request) => {
    request.user = {
      id: USER_ID,
      username: 'alice',
      role: 'admin',
      currentOrgId: ORG_ID,
    };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(['admin.org']);
  });

  await agentAuditRoutes(server, storage);
  await server.ready();

  const cleanup = async (): Promise<void> => {
    vi.restoreAllMocks();
    await storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    await server.close();
  };

  return { server, storage, listSpy, countSpy, cleanup };
}

describe('Phase 36-05: /admin/audit route — rationale + outcomeDetail', () => {
  let ctx: TestContext | undefined;

  afterEach(async () => {
    if (ctx) {
      await ctx.cleanup();
      ctx = undefined;
    }
  });

  it('Test 1: passes outcomeDetail filter to listForOrg', async () => {
    ctx = await createTestServer({ rows: [], total: 0 });
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/audit?outcomeDetail=iteration_cap',
    });
    expect(res.statusCode).toBe(200);
    const callArgs = ctx.listSpy.mock.calls[0];
    expect(callArgs).toBeDefined();
    const filters = callArgs![1];
    expect(filters.outcomeDetail).toBe('iteration_cap');
  });

  it('Test 2: empty outcomeDetail is omitted from filters', async () => {
    ctx = await createTestServer({ rows: [], total: 0 });
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/audit?outcomeDetail=',
    });
    expect(res.statusCode).toBe(200);
    const callArgs = ctx.listSpy.mock.calls[0];
    expect(callArgs).toBeDefined();
    const filters = callArgs![1];
    expect(filters.outcomeDetail).toBeUndefined();
  });

  it('Test 3: outcomeDetail preserved in pagination links', async () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      makeEntry({ id: `r-${i}`, rationale: 'Why I called this tool' }),
    );
    ctx = await createTestServer({ rows, total: 200, renderHtml: true });
    const res = await ctx.server.inject({
      method: 'GET',
      url: '/admin/audit?outcomeDetail=iteration_cap&offset=50',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('outcomeDetail=iteration_cap');
  });

  it('Test 4: long rationale renders truncated preview + hidden full panel', async () => {
    const longRationale =
      'I am calling list_scans because the user asked for a recap of recent scan activity across the organisation, and this is the canonical tool for that.';
    const rows = [makeEntry({ rationale: longRationale })];
    ctx = await createTestServer({ rows, total: 1, renderHtml: true });
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/audit' });
    expect(res.statusCode).toBe(200);
    const html = res.body;
    // Truncated preview (first 80 chars) appears
    expect(html).toContain(longRationale.slice(0, 60));
    // Full text appears (in hidden panel)
    expect(html).toContain(longRationale);
    // Toggle button hook
    expect(html).toContain('data-action="toggleRationale"');
    // Hidden panel marker
    expect(html).toMatch(/audit-rationale__full[^>]*hidden/);
  });

  it('Test 5: null rationale renders em-dash, no toggle button', async () => {
    const rows = [makeEntry({ rationale: null })];
    ctx = await createTestServer({ rows, total: 1, renderHtml: true });
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/audit' });
    expect(res.statusCode).toBe(200);
    const html = res.body;
    // Em-dash placeholder for null
    expect(html).toContain('—');
    // Confirm: in the rendered row the cell does NOT carry a toggle for this row.
    // We check the row HTML around the data-label="Rationale" cell does not embed
    // a data-action toggleRationale button. Strict check: count of toggle hooks is 0.
    const toggleMatches = html.match(/data-action="toggleRationale"/g);
    expect(toggleMatches).toBeNull();
  });

  it('Test 6: CSV export appends rationale column', async () => {
    const rows = [
      makeEntry({ rationale: 'because reasons' }),
      makeEntry({ rationale: null, id: 'r-2' }),
    ];
    ctx = await createTestServer({ rows, total: 2 });
    const res = await ctx.server.inject({ method: 'GET', url: '/admin/audit.csv' });
    expect(res.statusCode).toBe(200);
    const lines = res.body.trim().split('\n');
    expect(lines[0]).toContain('rationale');
    // Header order: existing columns preserved, rationale appended last
    expect(lines[0]).toBe(
      'timestamp,user_id,org_id,tool_name,outcome,latency_ms,args,outcome_detail,rationale',
    );
    // Data row 1 ends with the rationale value
    expect(lines[1]?.endsWith('because reasons')).toBe(true);
    // Data row 2 ends with empty rationale (null → '')
    expect(lines[2]?.endsWith(',')).toBe(true);
  });
});
