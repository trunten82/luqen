/**
 * Phase 30 dashboard admin tools — integration tests.
 *
 * Covers the 13 admin tools registered by
 * packages/dashboard/src/mcp/tools/admin.ts:
 *
 *   1. tools/list count + permission filtering
 *      - admin.system + admin.users + data perms → 19 visible
 *      - admin.users only → 4 user tools
 *      - admin.system only → 9 admin.system tools
 *   2. D-17 runtime guard — NO admin tool inputSchema contains an
 *      `orgId` key (`targetOrgId` is allowed by design — not the same key)
 *   3. Classification coverage — 13 org-scoped comments, 0 global,
 *      0 TODO markers, 0 console.log
 *   4. No delete tools registered
 *   5. DASHBOARD_ADMIN_TOOL_METADATA shape (count, permission distribution,
 *      no destructive flag)
 *   6. Service-connection secret redaction across list/get/create/update
 *      paths (D-06)
 *   7. dashboard_test_service_connection scrubs long secret-like tokens
 *      from error messages
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerMcpRoutes } from '../../src/routes/api/mcp.js';
import { createDashboardMcpServer } from '../../src/mcp/server.js';
import { ADMIN_TOOL_NAMES, DASHBOARD_ADMIN_TOOL_METADATA } from '../../src/mcp/tools/admin.js';
import { DATA_TOOL_NAMES } from '../../src/mcp/tools/data.js';
import type { McpTokenPayload, McpTokenVerifier } from '../../src/mcp/middleware.js';
import type { StorageAdapter } from '../../src/db/index.js';
import type { ScanService } from '../../src/services/scan-service.js';
import type {
  ServiceConnection,
  ServiceConnectionsRepository,
} from '../../src/db/service-connections-repository.js';
import * as tester from '../../src/services/service-connection-tester.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Stubs (kept self-contained — copies the data-tools.test.ts pattern so the
// admin-tool tests do not couple to the data-tool helpers)
// ---------------------------------------------------------------------------

function makeStubStorage(perms: readonly string[] = []): StorageAdapter {
  const empty = {} as unknown;
  const permSet = new Set(perms);
  return {
    scans: empty as StorageAdapter['scans'],
    brandScores: empty as StorageAdapter['brandScores'],
    users: {
      listUsers: async () => [
        {
          id: 'u1',
          username: 'alice',
          role: 'admin',
          active: true,
          createdAt: '2026-04-17T00:00:00.000Z',
          passwordHash: 'SECRET_HASH',
        } as unknown,
      ],
      listUsersForOrg: async () => [
        {
          id: 'u1',
          username: 'alice',
          role: 'admin',
          active: true,
          createdAt: '2026-04-17T00:00:00.000Z',
          passwordHash: 'SECRET_HASH',
        } as unknown,
      ],
      getUserById: async (id: string) =>
        id === 'u1'
          ? ({
              id: 'u1',
              username: 'alice',
              role: 'admin',
              active: true,
              createdAt: '2026-04-17T00:00:00.000Z',
              passwordHash: 'SECRET_HASH',
            } as unknown)
          : null,
      getUserByUsername: async () => null,
      createUser: async (username: string, _pw: string, role: string) =>
        ({
          id: 'u2',
          username,
          role,
          active: true,
          createdAt: '2026-04-17T00:00:00.000Z',
          passwordHash: 'HASH2',
        } as unknown),
      verifyPassword: async () => true,
      updateUserRole: async () => {},
      activateUser: async () => {},
      deactivateUser: async () => {},
      updatePassword: async () => {},
      deleteUser: async () => true,
      countUsers: async () => 1,
    } as unknown as StorageAdapter['users'],
    organizations: {
      listOrgs: async () => [
        { id: 'org-1', name: 'Acme', slug: 'acme', createdAt: '2026-04-17T00:00:00.000Z' },
      ],
      getOrg: async (id: string) =>
        id === 'org-1'
          ? { id: 'org-1', name: 'Acme', slug: 'acme', createdAt: '2026-04-17T00:00:00.000Z' }
          : null,
      createOrg: async (data: { name: string; slug: string }) => ({
        id: 'org-2',
        name: data.name,
        slug: data.slug,
        createdAt: '2026-04-17T00:00:00.000Z',
      }),
      setBrandingMode: async () => {},
      setBrandScoreTarget: async () => {},
      getBrandingMode: async () => 'embedded' as const,
      getBrandScoreTarget: async () => null,
    } as unknown as StorageAdapter['organizations'],
    roles: {
      getEffectivePermissions: async () => permSet,
    } as unknown as StorageAdapter['roles'],
    schedules: empty as StorageAdapter['schedules'],
    assignments: empty as StorageAdapter['assignments'],
    repos: empty as StorageAdapter['repos'],
    teams: empty as StorageAdapter['teams'],
    email: empty as StorageAdapter['email'],
    audit: empty as StorageAdapter['audit'],
    plugins: empty as StorageAdapter['plugins'],
    apiKeys: empty as StorageAdapter['apiKeys'],
    pageHashes: empty as StorageAdapter['pageHashes'],
    manualTests: empty as StorageAdapter['manualTests'],
    gitHosts: empty as StorageAdapter['gitHosts'],
    branding: empty as StorageAdapter['branding'],
    connect: async () => {},
    disconnect: async () => {},
    migrate: async () => {},
    healthCheck: async () => true,
    name: 'stub',
  };
}

interface SvcOverrides {
  readonly list?: ServiceConnectionsRepository['list'];
  readonly get?: ServiceConnectionsRepository['get'];
  readonly upsert?: ServiceConnectionsRepository['upsert'];
}

function makeStubServiceConnections(o: SvcOverrides = {}): ServiceConnectionsRepository {
  return {
    list: o.list ?? (async () => []),
    get: o.get ?? (async () => null),
    upsert:
      o.upsert ??
      (async (input) => ({
        serviceId: input.serviceId,
        url: input.url,
        clientId: input.clientId,
        clientSecret: input.clientSecret ?? '',
        hasSecret: input.clientSecret != null && input.clientSecret !== '',
        updatedAt: '1970-01-01T00:00:00.000Z',
        updatedBy: input.updatedBy,
        source: 'db',
      })) as unknown as ServiceConnectionsRepository['upsert'],
    clearSecret: async () => {},
  };
}

function makeStubScanService(): ScanService {
  return {
    initiateScan: async () => ({ ok: true, scanId: 'stub-scan' }),
    getScanForOrg: async () => ({ ok: false, error: 'Scan not found' }),
  } as unknown as ScanService;
}

function makeFakeVerifier(payload: McpTokenPayload): McpTokenVerifier {
  return async (token: string): Promise<McpTokenPayload> => {
    if (token === 'valid-jwt') return payload;
    throw new Error('Invalid token');
  };
}

async function buildApp(o: {
  readonly permissions?: readonly string[];
  readonly serviceConnections?: ServiceConnectionsRepository;
} = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerMcpRoutes(app, {
    verifyToken: makeFakeVerifier({
      sub: 'tester',
      // Grant all tiers so the scope-filter is a no-op and these tests focus
      // purely on the RBAC-filter behaviour they were written to cover.
      scopes: ['read', 'write', 'admin'],
      orgId: 'org-1',
      role: 'member',
    }),
    storage: makeStubStorage(o.permissions ?? []),
    scanService: makeStubScanService(),
    serviceConnections: o.serviceConnections ?? makeStubServiceConnections(),
  });
  await app.ready();
  return app;
}

function rpc(method: string, params: unknown = {}, id = 1): unknown {
  return { jsonrpc: '2.0', id, method, params };
}

function parseSseOrJson(body: string): Record<string, unknown> {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as Record<string, unknown>;
  const dataLine = trimmed
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'));
  if (dataLine === undefined) throw new Error(`No SSE data line in body: ${body}`);
  return JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>;
}

async function callTool(
  app: FastifyInstance,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await app.inject({
    method: 'POST',
    url: '/api/v1/mcp',
    headers: {
      authorization: 'Bearer valid-jwt',
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    payload: rpc('tools/call', { name, arguments: args }),
  });
  return parseSseOrJson(resp.body);
}

function extractText(parsed: Record<string, unknown>): Record<string, unknown> {
  const r = parsed['result'] as { content?: Array<{ text?: string }> } | undefined;
  return JSON.parse(r?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// tools/list count + permission filtering
// ---------------------------------------------------------------------------

describe('Phase 30 admin tools — tools/list count + permission filtering', () => {
  let app: FastifyInstance | null = null;
  afterEach(async () => {
    if (app !== null) {
      await app.close();
      app = null;
    }
  });

  it('admin.system + admin.users + admin.org + scans.create + reports.view + branding.view → all 19 tools visible', async () => {
    app = await buildApp({
      permissions: [
        'admin.system',
        'admin.users',
        'admin.org',
        'scans.create',
        'reports.view',
        'branding.view',
      ],
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        authorization: 'Bearer valid-jwt',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: rpc('tools/list'),
    });
    const names = (
      (parseSseOrJson(response.body)['result'] as { tools: Array<{ name: string }> }).tools
    ).map((t) => t.name);
    expect(names.length).toBe(20);
    expect(names).toEqual(expect.arrayContaining([...DATA_TOOL_NAMES, ...ADMIN_TOOL_NAMES]));
  });

  it('admin.users only → 4 user tools visible (0 data, 0 system tools)', async () => {
    app = await buildApp({ permissions: ['admin.users'] });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        authorization: 'Bearer valid-jwt',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: rpc('tools/list'),
    });
    const names = (
      (parseSseOrJson(response.body)['result'] as { tools: Array<{ name: string }> }).tools
    ).map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'dashboard_list_users',
        'dashboard_get_user',
        'dashboard_create_user',
        'dashboard_update_user',
      ]),
    );
    expect(names.length).toBe(4);
  });

  it('admin.system + admin.org → 9 admin.system-relevant tools visible (4 org + 5 service-connection)', async () => {
    // In production, admin role holders get ALL permissions via
    // resolveEffectivePermissions (permissions.ts), so admin.system holders
    // also have admin.org. The dual-permission tools (list_orgs/get_org/
    // update_org) gate on admin.org as the lower-tier filter; the handler
    // branches on perms.has('admin.system') for cross-org scope. This test
    // therefore grants both permissions to mirror the production state.
    app = await buildApp({ permissions: ['admin.system', 'admin.org'] });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: {
        authorization: 'Bearer valid-jwt',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: rpc('tools/list'),
    });
    const names = (
      (parseSseOrJson(response.body)['result'] as { tools: Array<{ name: string }> }).tools
    ).map((t) => t.name);
    expect(names.length).toBe(9);
    expect(names).toContain('dashboard_list_orgs');
    expect(names).toContain('dashboard_list_service_connections');
    expect(names).toContain('dashboard_test_service_connection');
  });
});

// ---------------------------------------------------------------------------
// D-17 invariant + classification coverage + no deletes + metadata shape
// ---------------------------------------------------------------------------

describe('Phase 30 admin tools — D-17 invariant + classification coverage + no deletes', () => {
  it('D-17 runtime guard — NO admin tool inputSchema contains a literal orgId key', async () => {
    const { server, toolNames } = await createDashboardMcpServer({
      storage: makeStubStorage([]),
      scanService: makeStubScanService(),
      serviceConnections: makeStubServiceConnections(),
    });
    expect(toolNames.length).toBe(20); // 7 data (Phase 46 added scan_progress) + 13 admin

    const registered =
      (
        server as unknown as {
          _registeredTools?: Record<string, { inputSchema?: unknown }>;
        }
      )._registeredTools ?? {};
    for (const [name, tool] of Object.entries(registered)) {
      const schema = tool.inputSchema as Record<string, unknown> | undefined;
      let shapeRecord: Record<string, unknown> = {};
      if (schema != null && typeof schema === 'object') {
        const def = (schema as { _def?: { shape?: unknown } })._def;
        if (def != null && typeof def === 'object' && 'shape' in def) {
          const shape = (def as { shape?: unknown }).shape;
          if (typeof shape === 'function') {
            shapeRecord = (shape as () => Record<string, unknown>)() ?? {};
          } else if (shape != null && typeof shape === 'object') {
            shapeRecord = shape as Record<string, unknown>;
          }
        }
        if (Object.keys(shapeRecord).length === 0) {
          const s = (schema as { shape?: unknown }).shape;
          if (s != null && typeof s === 'object') {
            shapeRecord = s as Record<string, unknown>;
          }
        }
      }
      expect(shapeRecord, `tool ${name} must not accept orgId (D-17)`).not.toHaveProperty(
        'orgId',
      );
    }
  });

  it('Classification coverage — admin.ts has 13 org-scoped comments, 0 global, 0 TODO markers, 0 console.log', async () => {
    const source = await readFile(
      resolve(__dirname, '../../src/mcp/tools/admin.ts'),
      'utf-8',
    );
    const orgScoped = (source.match(/\/\/ orgId: ctx\.orgId \(org-scoped/g) ?? []).length;
    const global = (source.match(/\/\/ orgId: N\/A /g) ?? []).length;
    expect(orgScoped).toBe(13);
    expect(global).toBe(0);
    expect(source).not.toMatch(/TODO\(phase-/);
    expect(source).not.toMatch(/console\.log/);
  });

  it('No delete tools registered', async () => {
    const { server } = await createDashboardMcpServer({
      storage: makeStubStorage([]),
      scanService: makeStubScanService(),
      serviceConnections: makeStubServiceConnections(),
    });
    const registered =
      (
        server as unknown as {
          _registeredTools?: Record<string, unknown>;
        }
      )._registeredTools ?? {};
    const deleteTools = Object.keys(registered).filter((k) =>
      k.startsWith('dashboard_delete_'),
    );
    expect(deleteTools).toEqual([]);
  });

  it('DASHBOARD_ADMIN_TOOL_METADATA has exactly 13 entries with correct permission distribution', () => {
    expect(DASHBOARD_ADMIN_TOOL_METADATA.length).toBe(13);
    const adminUsers = DASHBOARD_ADMIN_TOOL_METADATA.filter(
      (t) => t.requiredPermission === 'admin.users',
    );
    const adminSystem = DASHBOARD_ADMIN_TOOL_METADATA.filter(
      (t) => t.requiredPermission === 'admin.system',
    );
    const adminOrg = DASHBOARD_ADMIN_TOOL_METADATA.filter(
      (t) => t.requiredPermission === 'admin.org',
    );
    expect(adminUsers.length).toBe(4);
    expect(adminSystem.length).toBe(6); // 5 service-connection + 1 dashboard_create_org
    expect(adminOrg.length).toBe(3); // list/get/update_org dual-permission
    expect(DASHBOARD_ADMIN_TOOL_METADATA.every((t) => t.destructive !== true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Service-connection secret redaction (D-06) — list/get/create/update/test
// ---------------------------------------------------------------------------

describe('Phase 30 admin tools — service-connection secret redaction (D-06)', () => {
  let app: FastifyInstance | null = null;
  afterEach(async () => {
    if (app !== null) {
      await app.close();
      app = null;
    }
  });

  const STUB_CONN: ServiceConnection = {
    serviceId: 'compliance',
    url: 'http://compliance:4000',
    clientId: 'cid-abc',
    clientSecret: 'super-secret-key-abcd-12345',
    hasSecret: true,
    updatedAt: '2026-04-17T00:00:00.000Z',
    updatedBy: 'admin',
    source: 'db',
  };

  it('dashboard_list_service_connections redacts clientSecret', async () => {
    app = await buildApp({
      permissions: ['admin.system'],
      serviceConnections: makeStubServiceConnections({ list: async () => [STUB_CONN] }),
    });
    const parsed = await callTool(app, 'dashboard_list_service_connections', {});
    const data = extractText(parsed);
    const rawText = JSON.stringify(data);
    expect(rawText).not.toContain('super-secret-key-abcd-12345');
    expect(rawText).not.toContain('clientSecret');
    const rows = data['data'] as Array<Record<string, unknown>>;
    expect(rows[0]?.['hasSecret']).toBe(true);
    expect(rows[0]?.['secretPreview']).toBe('xxxx...2345');
  });

  it('dashboard_get_service_connection redacts clientSecret', async () => {
    app = await buildApp({
      permissions: ['admin.system'],
      serviceConnections: makeStubServiceConnections({ get: async () => STUB_CONN }),
    });
    const parsed = await callTool(app, 'dashboard_get_service_connection', {
      serviceId: 'compliance',
    });
    const data = extractText(parsed);
    const rawText = JSON.stringify(data);
    expect(rawText).not.toContain('super-secret-key-abcd-12345');
    expect(rawText).not.toContain('clientSecret');
    expect(data['hasSecret']).toBe(true);
    expect(data['secretPreview']).toBe('xxxx...2345');
  });

  it('dashboard_create_service_connection accepts clientSecret on input; response is redacted', async () => {
    const upsertSpy = vi.fn(
      async (input: Parameters<ServiceConnectionsRepository['upsert']>[0]) => ({
        serviceId: input.serviceId,
        url: input.url,
        clientId: input.clientId,
        clientSecret: input.clientSecret ?? '',
        hasSecret: input.clientSecret != null && input.clientSecret !== '',
        updatedAt: '2026-04-17T00:00:00.000Z',
        updatedBy: input.updatedBy,
        source: 'db' as const,
      }),
    );
    app = await buildApp({
      permissions: ['admin.system'],
      serviceConnections: makeStubServiceConnections({ upsert: upsertSpy }),
    });
    const parsed = await callTool(app, 'dashboard_create_service_connection', {
      serviceId: 'compliance',
      url: 'http://x:1',
      clientId: 'cid',
      clientSecret: 'incoming-sec-xyz-9876',
    });
    const data = extractText(parsed);
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecret: 'incoming-sec-xyz-9876' }),
    );
    expect(JSON.stringify(data)).not.toContain('incoming-sec-xyz-9876');
    expect(data['secretPreview']).toBe('xxxx...9876');
  });

  it('dashboard_update_service_connection with omitted clientSecret → upsert called with clientSecret: null (blank-to-keep)', async () => {
    const upsertSpy = vi.fn(
      async (input: Parameters<ServiceConnectionsRepository['upsert']>[0]) => ({
        serviceId: input.serviceId,
        url: input.url,
        clientId: input.clientId,
        clientSecret: '',
        hasSecret: false,
        updatedAt: '2026-04-17T00:00:00.000Z',
        updatedBy: input.updatedBy,
        source: 'db' as const,
      }),
    );
    app = await buildApp({
      permissions: ['admin.system'],
      serviceConnections: makeStubServiceConnections({
        get: async () => STUB_CONN,
        upsert: upsertSpy,
      }),
    });
    await callTool(app, 'dashboard_update_service_connection', {
      serviceId: 'compliance',
      url: 'http://new:1',
    });
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecret: null }),
    );
  });

  it('dashboard_test_service_connection scrubs long secret-like tokens from error messages', async () => {
    const testSpy = vi
      .spyOn(tester, 'testServiceConnection')
      .mockRejectedValueOnce(
        new Error('Failed: token=abcdefghijklmnopqrstuvwxyz1234567890 invalid'),
      );
    app = await buildApp({
      permissions: ['admin.system'],
      serviceConnections: makeStubServiceConnections({ get: async () => STUB_CONN }),
    });
    const parsed = await callTool(app, 'dashboard_test_service_connection', {
      serviceId: 'compliance',
    });
    const r = parsed['result'] as { isError?: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(true);
    const text = r.content[0]?.text ?? '';
    expect(text).toContain('[redacted]');
    expect(text).not.toContain('abcdefghijklmnopqrstuvwxyz1234567890');
    testSpy.mockRestore();
  });
});
