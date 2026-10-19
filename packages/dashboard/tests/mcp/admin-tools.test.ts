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
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpHttpPlugin, runInToolContext, type McpHttpPluginOptions, type ToolContext } from '@luqen/core/mcp';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerMcpRoutes } from '../../src/routes/api/mcp.js';
import { createDashboardMcpServer } from '../../src/mcp/server.js';
import { ADMIN_TOOL_NAMES, DASHBOARD_ADMIN_TOOL_METADATA, registerAdminTools } from '../../src/mcp/tools/admin.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';
import { DASHBOARD_TOOL_METADATA } from '../../src/mcp/metadata.js';
import { DATA_TOOL_NAMES } from '../../src/mcp/tools/data.js';
import type { McpTokenPayload, McpTokenVerifier } from '../../src/mcp/middleware.js';
import type { StorageAdapter } from '../../src/db/index.js';
import type { ScanService } from '../../src/services/scan-service.js';
import type {
  ServiceConnection,
  ServiceConnectionsRepository,
} from '../../src/db/service-connections-repository.js';
import * as tester from '../../src/services/service-connection-tester.js';
import { validatePassword, validateUsername } from '../../src/validation.js';
import { withStoredCaller } from '../helpers/stored-caller-stub.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Stubs (kept self-contained — copies the data-tools.test.ts pattern so the
// admin-tool tests do not couple to the data-tool helpers)
// ---------------------------------------------------------------------------

function makeStubStorage(perms: readonly string[] = [], callerRole = 'user'): StorageAdapter {
  const empty = {} as unknown;
  const permSet = new Set(perms);
  return {
    scans: empty as StorageAdapter['scans'],
    brandScores: empty as StorageAdapter['brandScores'],
    users: withStoredCaller({
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
    }, 'tester', callerRole) as unknown as StorageAdapter['users'],
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
  /** The stored global role of the token subject 'tester' (the MCP endpoint answers for the stored user). */
  readonly callerRole?: string;
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
    storage: makeStubStorage(o.permissions ?? [], o.callerRole ?? 'user'),
    scanService: makeStubScanService(),
    serviceConnections: o.serviceConnections ?? makeStubServiceConnections(),
  });
  await app.ready();
  return app;
}

/**
 * tools/list in process for a caller holding exactly `permissions`: the dashboard McpServer with
 * core's tools/list handler installed (createMcpHttpPlugin), called through an in-memory client inside
 * runInToolContext. The HTTP endpoint answers for the stored user of the token, and only the stored
 * global admin role holds admin.system / admin.users, so a set holding one of them WITHOUT every other
 * permission exists only for an in-process context.
 */
async function listInProcess(permissions: readonly string[]): Promise<string[]> {
  const { server } = await createDashboardMcpServer({
    storage: makeStubStorage(permissions),
    scanService: makeStubScanService(),
    serviceConnections: makeStubServiceConnections(),
  });
  await createMcpHttpPlugin({ mcpServer: server, toolMetadata: DASHBOARD_TOOL_METADATA, requiredScope: 'read' } as unknown as McpHttpPluginOptions);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const context: ToolContext = { userId: 'tester', orgId: 'org-1', scopes: ['read', 'write', 'admin'], permissions: new Set(permissions), authType: 'jwt' };
  try {
    const { tools } = await runInToolContext(context, () => client.listTools());
    return tools.map((t) => t.name);
  } finally {
    await client.close();
  }
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

  it('admin.system + admin.users + admin.org + scans.create + reports.view + branding.view → all 24 tools visible', async () => {
    app = await buildApp({
      callerRole: 'admin',
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
    // Phase 62.4: +4 fleet tools (3 reports.view + 1 admin.org) on top of
    // the 7 data + 13 admin baseline → 24.
    expect(names.length).toBe(24);
    expect(names).toEqual(expect.arrayContaining([...DATA_TOOL_NAMES, ...ADMIN_TOOL_NAMES]));
  });

  it('admin.users only → 4 user tools visible (0 data, 0 system tools)', async () => {
    const names = await listInProcess(['admin.users']);
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

  it('admin.system + admin.org → 9 admin.system-relevant tools + 1 admin.org fleet tool = 10', async () => {
    // In production, admin role holders get ALL permissions via
    // resolveEffectivePermissions (permissions.ts), so admin.system holders
    // also have admin.org. The dual-permission tools (list_orgs/get_org/
    // update_org) gate on admin.org as the lower-tier filter; the handler
    // branches on perms.has('admin.system') for cross-org scope. This test
    // therefore grants both permissions to mirror the production state.
    const names = await listInProcess(['admin.system', 'admin.org']);
    // Phase 62.4: dashboard_queue_bulk_fix (admin.org) is the only fleet tool
    // visible here; the other 3 fleet tools gate on reports.view.
    expect(names.length).toBe(10);
    expect(names).toContain('dashboard_list_orgs');
    expect(names).toContain('dashboard_list_service_connections');
    expect(names).toContain('dashboard_test_service_connection');
    expect(names).toContain('dashboard_queue_bulk_fix');
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
    expect(toolNames.length).toBe(24); // 7 data + 13 admin + 4 fleet (Phase 62.4)

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
      callerRole: 'admin',
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
      callerRole: 'admin',
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
      callerRole: 'admin',
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
      callerRole: 'admin',
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
      callerRole: 'admin',
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

// ---------------------------------------------------------------------------
// Quick 261013-dr7 (WR-04): dashboard_create_user reserves the api-key prefix
// ---------------------------------------------------------------------------

describe('dashboard_create_user reserved usernames', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('refuses a username starting with api-key and creates nothing; a normal name is created', async () => {
    app = await buildApp({ permissions: ['admin.users'], callerRole: 'admin' });
    for (const username of ['api-key', 'api-key:0123456789abcdef', 'API-Key-ops']) {
      const parsed = await callTool(app, 'dashboard_create_user', { username, password: 'Pass-word-123!', role: 'user' });
      const result = parsed['result'] as { isError?: boolean; content?: Array<{ text?: string }> };
      expect(result.isError, username).toBe(true);
      expect(result.content?.[0]?.text ?? '', username).toMatch(/api-key/i);
      expect(extractText(parsed)['id'], username).toBeUndefined();
    }
    const ok = extractText(await callTool(app, 'dashboard_create_user', { username: 'fabrikam-ops', password: 'Pass-word-123!', role: 'user' }));
    expect(ok['username']).toBe('fabrikam-ops');
  });
});

// ---------------------------------------------------------------------------
// HARD-13: the MCP user tools accept exactly what the dashboard accepts —
// the dashboard's own validators and global role list, with its wording.
// ---------------------------------------------------------------------------

interface StoredUser { readonly id: string; readonly username: string; readonly role: string; readonly active?: boolean }
interface StoredTeam { readonly id: string; readonly orgId: string; readonly members: readonly string[] }

/**
 * The calling user (token sub 'tester'). The user tools read the caller's STORED row, so the store
 * holds it: by default an active global admin, kept apart from the target users the tests assert on.
 */
const GLOBAL_ADMIN_CALLER: StoredUser = { id: 'tester', username: 'fabrikam-tester', role: 'admin', active: true };

/** A users store that remembers what was created and every role and status write; teams are read-only. */
function makeUserStore(
  seed: readonly StoredUser[] = [],
  opts: { readonly caller?: StoredUser; readonly teams?: readonly StoredTeam[] } = {},
) {
  const users = new Map<string, StoredUser>(seed.map((u) => [u.id, u]));
  const callers = new Map<string, StoredUser>([[(opts.caller ?? GLOBAL_ADMIN_CALLER).id, opts.caller ?? GLOBAL_ADMIN_CALLER]]);
  const teams = opts.teams ?? [];
  const roleWrites: Array<{ readonly id: string; readonly role: string }> = [];
  const statusWrites: Array<{ readonly id: string; readonly active: boolean }> = [];
  const holderOf = (id: string) => (users.has(id) ? users : callers.has(id) ? callers : undefined);
  const find = (id: string) => users.get(id) ?? callers.get(id);
  const write = (id: string, change: Partial<StoredUser>) => {
    const holder = holderOf(id);
    const u = holder?.get(id);
    if (holder !== undefined && u !== undefined) holder.set(id, { ...u, ...change });
  };
  const byName = (username: string) => [...users.values(), ...callers.values()].find((u) => u.username === username) ?? null;
  const asRow = (u: StoredUser) => ({ ...u, active: u.active ?? true, createdAt: '2026-10-18T00:00:00.000Z', passwordHash: 'HASH' }) as unknown;
  const repo = {
    getUserById: async (id: string) => { const u = find(id); return u === undefined ? null : asRow(u); },
    getUserByUsername: async (username: string) => { const u = byName(username); return u === null ? null : asRow(u); },
    listUsers: async () => [...users.values(), ...callers.values()].map(asRow),
    createUser: async (username: string, _pw: string, role: string) => {
      const u = { id: `u${users.size + 1}`, username, role };
      users.set(u.id, u);
      return asRow(u);
    },
    updateUserRole: async (id: string, role: string) => {
      roleWrites.push({ id, role });
      write(id, { role });
    },
    activateUser: async (id: string) => { statusWrites.push({ id, active: true }); write(id, { active: true }); },
    deactivateUser: async (id: string) => { statusWrites.push({ id, active: false }); write(id, { active: false }); },
  };
  const teamRepo = {
    listTeamMembershipsForUser: async (userId: string) =>
      teams.filter((t) => t.members.includes(userId)).map((t) => ({ teamId: t.id, role: 'member' })),
    getTeam: async (id: string) => {
      const t = teams.find((x) => x.id === id);
      return t === undefined ? null : { id: t.id, name: t.id, description: '', orgId: t.orgId, roleId: null, createdAt: '2026-10-18T00:00:00.000Z' };
    },
  };
  return { users, callers, roleWrites, statusWrites, repo, teamRepo };
}

type UserStore = ReturnType<typeof makeUserStore>;

function userStorage(store: UserStore, permissions: readonly string[]): StorageAdapter {
  const base = makeStubStorage(permissions);
  return {
    ...base,
    users: { ...base.users, ...store.repo } as unknown as StorageAdapter['users'],
    teams: store.teamRepo as unknown as StorageAdapter['teams'],
  };
}

async function buildUserApp(store: UserStore, permissions: readonly string[] = ['admin.users']): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerMcpRoutes(app, {
    verifyToken: makeFakeVerifier({ sub: 'tester', scopes: ['read', 'write', 'admin'], orgId: 'org-1', role: 'member' }),
    storage: userStorage(store, permissions),
    scanService: makeStubScanService(),
    serviceConnections: makeStubServiceConnections(),
  });
  await app.ready();
  return app;
}

function toolError(parsed: Record<string, unknown>): { readonly isError: boolean; readonly error: unknown } {
  const result = parsed['result'] as { isError?: boolean } | undefined;
  return { isError: result?.isError === true, error: extractText(parsed)['error'] };
}

const STRONG_PASSWORD = 'Fabrikam-Audit-42!';
const INVALID_ROLE_ERROR = 'Invalid role. Must be executive, viewer, user, developer, or admin.';
const USERNAME_NOT_AVAILABLE_ERROR = 'This username is not available.';

describe('HARD-13 MCP user tools validate like the dashboard', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('HARD-13 create user refuses an unknown role', async () => {
    const store = makeUserStore();
    app = await buildUserApp(store);
    const parsed = await callTool(app, 'dashboard_create_user', { username: 'fabrikam-auditor', password: STRONG_PASSWORD, role: 'member' });
    expect(toolError(parsed)).toEqual({ isError: true, error: INVALID_ROLE_ERROR });
    expect(store.users.size).toBe(0);
  });

  it('HARD-13 create user accepts a valid username and role', async () => {
    const store = makeUserStore();
    app = await buildUserApp(store);
    const parsed = await callTool(app, 'dashboard_create_user', { username: 'fabrikam-auditor', password: STRONG_PASSWORD, role: 'user' });
    expect(toolError(parsed).isError).toBe(false);
    const body = extractText(parsed);
    expect(body['username']).toBe('fabrikam-auditor');
    expect(body['role']).toBe('user');
    expect(body).not.toHaveProperty('passwordHash');
    expect([...store.users.values()].map((u) => u.username)).toEqual(['fabrikam-auditor']);
  });

  it('HARD-13 create user refuses an invalid username', async () => {
    const store = makeUserStore();
    app = await buildUserApp(store);
    for (const username of ['.fabrikam', 'ab']) {
      const expected = validateUsername(username);
      expect(expected.valid, username).toBe(false);
      const parsed = await callTool(app, 'dashboard_create_user', { username, password: STRONG_PASSWORD, role: 'user' });
      expect(toolError(parsed), username).toEqual({ isError: true, error: expected.error });
    }
    expect(store.users.size).toBe(0);
  });

  it('HARD-13 create user refuses a password the dashboard would refuse', async () => {
    const store = makeUserStore();
    app = await buildUserApp(store);
    const expected = validatePassword('longenough');
    expect(expected.valid).toBe(false);
    const parsed = await callTool(app, 'dashboard_create_user', { username: 'fabrikam-auditor', password: 'longenough', role: 'user' });
    expect(toolError(parsed)).toEqual({ isError: true, error: expected.error });
    expect(store.users.size).toBe(0);
  });

  it('HARD-13 create user refuses a duplicate username', async () => {
    const store = makeUserStore();
    app = await buildUserApp(store);
    const first = await callTool(app, 'dashboard_create_user', { username: 'fabrikam-auditor', password: STRONG_PASSWORD, role: 'user' });
    expect(toolError(first).isError).toBe(false);
    const second = await callTool(app, 'dashboard_create_user', { username: 'fabrikam-auditor', password: STRONG_PASSWORD, role: 'viewer' });
    expect(toolError(second)).toEqual({ isError: true, error: USERNAME_NOT_AVAILABLE_ERROR });
    expect([...store.users.values()]).toEqual([{ id: 'u1', username: 'fabrikam-auditor', role: 'user' }]);
  });

  it('HARD-13 update user refuses an unknown role', async () => {
    const store = makeUserStore([{ id: 'u1', username: 'fabrikam-auditor', role: 'viewer' }]);
    app = await buildUserApp(store);
    const parsed = await callTool(app, 'dashboard_update_user', { userId: 'u1', role: 'member', active: false });
    expect(toolError(parsed)).toEqual({ isError: true, error: INVALID_ROLE_ERROR });
    expect(store.roleWrites).toEqual([]);
    expect(store.statusWrites).toEqual([]);
    expect(store.users.get('u1')?.role).toBe('viewer');
  });

  it('HARD-13 update user accepts a global role', async () => {
    const store = makeUserStore([{ id: 'u1', username: 'fabrikam-auditor', role: 'viewer' }]);
    app = await buildUserApp(store);
    const parsed = await callTool(app, 'dashboard_update_user', { userId: 'u1', role: 'developer' });
    expect(toolError(parsed).isError).toBe(false);
    expect(extractText(parsed)['role']).toBe('developer');
    expect(store.roleWrites).toEqual([{ id: 'u1', role: 'developer' }]);
  });
});

// ---------------------------------------------------------------------------
// HARD-13: the MCP user tools follow the dashboard's role authority rules. The
// permission set is forced through the stub role repository (as buildUserApp
// does), so what is observed is the HANDLER's own rule, which reads the
// caller's stored user row.
// ---------------------------------------------------------------------------

const ADMIN_ROLE_ERROR = 'Only global administrators can assign the admin role.';
const ORG_CALLER: StoredUser = { id: 'tester', username: 'fabrikam-owner', role: 'user', active: true };
const ORG_TARGET: StoredUser = { id: 'u1', username: 'fabrikam-analyst', role: 'viewer' };
const ORG_ONE_TEAM: StoredTeam = { id: 't1', orgId: 'org-1', members: ['tester', 'u1'] };

/** Calls a tool in process, the way the agent bridge dispatches: no tools/call gate, the given context. */
async function callInProcess(store: UserStore, context: ToolContext, name: string, args: Record<string, unknown>) {
  const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  registerAdminTools(server, { storage: userStorage(store, []), serviceConnections: makeStubServiceConnections() });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await runInToolContext(context, () => client.callTool({ name, arguments: args }));
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? '{}';
    return { isError: result.isError === true, error: (JSON.parse(text) as Record<string, unknown>)['error'] };
  } finally {
    await client.close();
  }
}

/**
 * The context of an org-scoped caller (stored role 'user') holding `permissions`. Over HTTP the endpoint
 * answers for the stored user, whose non-admin role never holds admin.users, so these handler rules for
 * such a caller are exercised in process, where a tool context carries any set.
 */
function orgCallerContext(permissions: readonly string[] = ['admin.users']): ToolContext {
  return { userId: 'tester', orgId: 'org-1', scopes: ['read', 'write', 'admin'], permissions: new Set(permissions), authType: 'jwt' };
}

describe('HARD-13 MCP user tools follow the dashboard role authority rules', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('HARD-13 update user assigns the admin role only for a global admin caller', async () => {
    const store = makeUserStore([ORG_TARGET], { caller: ORG_CALLER, teams: [ORG_ONE_TEAM] });
    const result = await callInProcess(store, orgCallerContext(), 'dashboard_update_user', { userId: 'u1', role: 'admin', active: false });
    expect(result).toEqual({ isError: true, error: ADMIN_ROLE_ERROR });
    expect(store.roleWrites).toEqual([]);
    expect(store.statusWrites).toEqual([]);
    expect(store.users.get('u1')?.role).toBe('viewer');
  });

  it('HARD-13 create user assigns the admin role only for a global admin caller', async () => {
    const store = makeUserStore([], { caller: ORG_CALLER, teams: [ORG_ONE_TEAM] });
    const result = await callInProcess(store, orgCallerContext(), 'dashboard_create_user', { username: 'fabrikam-ops-lead', password: STRONG_PASSWORD, role: 'admin' });
    expect(result).toEqual({ isError: true, error: ADMIN_ROLE_ERROR });
    expect(store.users.size).toBe(0);
  });

  it('HARD-13 admin role assignment reads the caller role from the user store', async () => {
    const store = makeUserStore([ORG_TARGET], { caller: ORG_CALLER, teams: [ORG_ONE_TEAM] });
    const result = await callInProcess(store, orgCallerContext(ALL_PERMISSION_IDS), 'dashboard_update_user', { userId: 'u1', role: 'admin' });
    expect(result).toEqual({ isError: true, error: ADMIN_ROLE_ERROR });
    expect(store.roleWrites).toEqual([]);
  });

  it('HARD-13 update user by a global admin assigns the admin role', async () => {
    const store = makeUserStore([ORG_TARGET], { caller: GLOBAL_ADMIN_CALLER, teams: [ORG_ONE_TEAM] });
    app = await buildUserApp(store, ALL_PERMISSION_IDS);
    const parsed = await callTool(app, 'dashboard_update_user', { userId: 'u1', role: 'admin' });
    expect(toolError(parsed).isError).toBe(false);
    expect(store.roleWrites).toEqual([{ id: 'u1', role: 'admin' }]);
    expect(store.users.get('u1')?.role).toBe('admin');
  });

  it('HARD-13 admin role assignment holds for an in process caller with an empty permission set', async () => {
    const store = makeUserStore([ORG_TARGET], { caller: ORG_CALLER, teams: [ORG_ONE_TEAM] });
    const context: ToolContext = { userId: 'tester', orgId: 'org-1', scopes: ['read', 'write', 'admin'], permissions: new Set<string>(), authType: 'jwt' };
    const result = await callInProcess(store, context, 'dashboard_update_user', { userId: 'u1', role: 'admin' });
    expect(result).toEqual({ isError: true, error: ADMIN_ROLE_ERROR });
    expect(store.roleWrites).toEqual([]);
    expect(store.users.get('u1')?.role).toBe('viewer');
  });
});

// ---------------------------------------------------------------------------
// HARD-13: dashboard_update_user changes only users the caller may manage
// (canManageUser, as the dashboard's user routes do), keeps the last active
// admin, and the tool descriptions say the admin role needs a global
// administrator.
// ---------------------------------------------------------------------------

const MANAGE_ERROR = 'You can only manage users in your organization.';
const LAST_ADMIN_ROLE_ERROR = 'Cannot change role of the last active admin user.';
const LAST_ADMIN_DEACTIVATE_ERROR = 'Cannot deactivate the last active admin user.';
const NORTHWIND_USER: StoredUser = { id: 'u2', username: 'northwind-analyst', role: 'viewer' };
const FABRIKAM_ADMIN: StoredUser = { id: 'u3', username: 'fabrikam-admin', role: 'admin', active: true };
const ORG_TWO_TEAM: StoredTeam = { id: 't2', orgId: 'org-2', members: ['u2'] };

describe('HARD-13 MCP user update follows the dashboard organization scope and last admin rules', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('HARD-13 update user changes only users the caller may manage', async () => {
    const store = makeUserStore([ORG_TARGET, NORTHWIND_USER], { caller: ORG_CALLER, teams: [ORG_ONE_TEAM, ORG_TWO_TEAM] });
    const result = await callInProcess(store, orgCallerContext(), 'dashboard_update_user', { userId: 'u2', role: 'developer', active: false });
    expect(result).toEqual({ isError: true, error: MANAGE_ERROR });
    expect(store.roleWrites).toEqual([]);
    expect(store.statusWrites).toEqual([]);
    expect(store.users.get('u2')?.role).toBe('viewer');
  });

  it('HARD-13 update user leaves a global admin unchanged for an org scoped caller', async () => {
    const team: StoredTeam = { id: 't1', orgId: 'org-1', members: ['tester', 'u1', 'u3'] };
    const store = makeUserStore([ORG_TARGET, FABRIKAM_ADMIN], { caller: ORG_CALLER, teams: [team] });
    const result = await callInProcess(store, orgCallerContext(), 'dashboard_update_user', { userId: 'u3', role: 'viewer', active: false });
    expect(result).toEqual({ isError: true, error: MANAGE_ERROR });
    expect(store.roleWrites).toEqual([]);
    expect(store.statusWrites).toEqual([]);
    expect(store.users.get('u3')).toEqual(FABRIKAM_ADMIN);
  });

  it('HARD-13 update user changes a user of the caller organization', async () => {
    const store = makeUserStore([ORG_TARGET], { caller: ORG_CALLER, teams: [ORG_ONE_TEAM] });
    const result = await callInProcess(store, orgCallerContext(), 'dashboard_update_user', { userId: 'u1', role: 'developer' });
    expect(result.isError).toBe(false);
    expect(store.users.get('u1')?.role).toBe('developer');
  });

  it('HARD-13 update user keeps the role of the last active admin', async () => {
    const store = makeUserStore([], { caller: GLOBAL_ADMIN_CALLER });
    app = await buildUserApp(store, ALL_PERMISSION_IDS);
    const parsed = await callTool(app, 'dashboard_update_user', { userId: 'tester', role: 'user' });
    expect(toolError(parsed)).toEqual({ isError: true, error: LAST_ADMIN_ROLE_ERROR });
    expect(store.roleWrites).toEqual([]);
    expect(store.callers.get('tester')?.role).toBe('admin');
  });

  it('HARD-13 update user keeps the last active admin active', async () => {
    const store = makeUserStore([], { caller: GLOBAL_ADMIN_CALLER });
    app = await buildUserApp(store, ALL_PERMISSION_IDS);
    const parsed = await callTool(app, 'dashboard_update_user', { userId: 'tester', active: false });
    expect(toolError(parsed)).toEqual({ isError: true, error: LAST_ADMIN_DEACTIVATE_ERROR });
    expect(store.statusWrites).toEqual([]);
    expect(store.callers.get('tester')?.active).toBe(true);
  });

  it('HARD-13 update user demotes an admin while another admin is active', async () => {
    const store = makeUserStore([FABRIKAM_ADMIN], { caller: GLOBAL_ADMIN_CALLER });
    app = await buildUserApp(store, ALL_PERMISSION_IDS);
    const parsed = await callTool(app, 'dashboard_update_user', { userId: 'u3', role: 'user' });
    expect(toolError(parsed).isError).toBe(false);
    expect(store.users.get('u3')?.role).toBe('user');
  });

  it('HARD-13 user tool descriptions name the global admin requirement for the admin role', async () => {
    // The registered tool list as the MCP SDK publishes it (JSON Schema, property descriptions kept).
    const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    registerAdminTools(server, { storage: userStorage(makeUserStore(), []), serviceConnections: makeStubServiceConnections() });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const { tools } = await client.listTools();
      for (const name of ['dashboard_create_user', 'dashboard_update_user']) {
        const properties = tools.find((t) => t.name === name)?.inputSchema.properties as Record<string, { description?: string }> | undefined;
        const roleDescription = properties?.['role']?.description ?? '';
        expect(roleDescription, name).toMatch(/^(New )?Global role/i);
        expect(roleDescription, name).toContain('global administrator');
      }
    } finally {
      await client.close();
    }
  });
});
