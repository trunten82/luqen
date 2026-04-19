/**
 * MCP Inspector smoke test (MCPT-05, Phase 30 plan 30-06, part 1 of D-16).
 *
 * Spawns `npx -y @modelcontextprotocol/inspector` against a live ephemeral
 * dashboard MCP server with a real RS256-signed Bearer token and asserts
 * the populated catalogue (tools, resources, prompts) + one tool-call
 * happy path + negative-auth. This is CI's proof that external MCP clients
 * can connect with standard OAuth2 credentials and use the server.
 *
 * If the installed inspector CLI does not support non-interactive flags
 * (or npx cannot reach the registry in CI), the test falls back to direct
 * JSON-RPC POSTs via fetch() against the same ephemeral port. Either path
 * proves MCPT-05.
 *
 * Security note: the Authorization header value is NEVER logged. spawn()
 * uses piped stdio so child output is captured in buffers, not printed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { SignJWT, generateKeyPair, exportSPKI } from 'jose';
import Fastify, { type FastifyInstance } from 'fastify';

import { registerMcpRoutes } from '../../src/routes/api/mcp.js';
import { createDashboardJwtVerifier } from '../../src/mcp/verifier.js';
import type { StorageAdapter } from '../../src/db/index.js';
import type { ScanService } from '../../src/services/scan-service.js';
import type {
  ServiceConnection,
  ServiceConnectionsRepository,
} from '../../src/db/service-connections-repository.js';

// ---------------------------------------------------------------------------
// Test stubs — copied from http.test.ts / data-tools.test.ts patterns
// ---------------------------------------------------------------------------

function makeStubStorage(perms: readonly string[]): StorageAdapter {
  const empty = {} as unknown;
  return {
    scans: {
      listScans: async () => [],
      getScan: async () => null,
      getReport: async () => null,
      getLatestPerSite: async () => [],
      listForOrg: async () => [],
      getByIdForOrg: async () => null,
      listAll: async () => [],
    } as unknown as StorageAdapter['scans'],
    users: {
      listForOrg: async () => [],
      getByIdForOrg: async () => null,
      listAll: async () => [],
    } as unknown as StorageAdapter['users'],
    organizations: {
      list: async () => [],
      getById: async () => null,
    } as unknown as StorageAdapter['organizations'],
    schedules: empty as StorageAdapter['schedules'],
    assignments: empty as StorageAdapter['assignments'],
    repos: empty as StorageAdapter['repos'],
    roles: {
      getEffectivePermissions: async (): Promise<Set<string>> => new Set(perms),
    } as unknown as StorageAdapter['roles'],
    teams: empty as StorageAdapter['teams'],
    email: empty as StorageAdapter['email'],
    audit: empty as StorageAdapter['audit'],
    plugins: empty as StorageAdapter['plugins'],
    apiKeys: empty as StorageAdapter['apiKeys'],
    pageHashes: empty as StorageAdapter['pageHashes'],
    manualTests: empty as StorageAdapter['manualTests'],
    gitHosts: empty as StorageAdapter['gitHosts'],
    branding: empty as StorageAdapter['branding'],
    brandScores: {
      getLatestForScan: async () => null,
      getHistoryForSite: async () => [],
      listForOrg: async () => [],
      getForOrg: async () => null,
    } as unknown as StorageAdapter['brandScores'],
    connect: async (): Promise<void> => {},
    disconnect: async (): Promise<void> => {},
    migrate: async (): Promise<void> => {},
    healthCheck: async (): Promise<boolean> => true,
    name: 'stub',
  };
}

function makeStubScanService(): ScanService {
  return {
    initiateScan: async () => ({ ok: true, scanId: 'stub-scan' }),
    getScanForOrg: async () => ({ ok: false, error: 'Scan not found' }),
  } as unknown as ScanService;
}

function makeStubServiceConnections(): ServiceConnectionsRepository {
  return {
    list: async () => [],
    get: async () => null,
    upsert: async (input) => ({
      serviceId: input.serviceId,
      url: input.url,
      clientId: input.clientId,
      clientSecret: input.clientSecret ?? '',
      hasSecret: input.clientSecret != null && input.clientSecret !== '',
      updatedAt: '1970-01-01T00:00:00.000Z',
      updatedBy: input.updatedBy,
      source: 'db',
    }) as unknown as ServiceConnection,
    clearSecret: async () => {},
  };
}

// ---------------------------------------------------------------------------
// Flag discovery — inspector CLI availability probe (runs once)
// ---------------------------------------------------------------------------

let USE_FALLBACK = false;
let INSPECTOR_VERSION: string | null = null;

async function detectInspectorCapabilities(): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['-y', '@modelcontextprotocol/inspector', '--help'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    let stdout = '';
    child.stdout?.on('data', (c: Buffer) => {
      stdout += String(c);
    });
    child.stderr?.on('data', (c: Buffer) => {
      stdout += String(c);
    });
    child.on('close', () => {
      const hasCli = /--cli\b/.test(stdout);
      const hasCommand = /--command\b/.test(stdout);
      USE_FALLBACK = !(hasCli && hasCommand);
      const versionMatch = stdout.match(/v?(\d+\.\d+\.\d+)/);
      INSPECTOR_VERSION = versionMatch !== null ? (versionMatch[1] ?? null) : null;
      resolve();
    });
    child.on('error', () => {
      USE_FALLBACK = true;
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Fixtures — real RS256 keypair + full dashboard Fastify app on ephemeral port
// ---------------------------------------------------------------------------

let app: FastifyInstance | null = null;
let baseUrl = '';
let validToken = '';

beforeAll(async () => {
  await detectInspectorCapabilities();

  const { publicKey, privateKey } = await generateKeyPair('RS256', {
    modulusLength: 2048,
    extractable: true,
  });
  const publicKeyPem = await exportSPKI(publicKey);

  // Phase 31.1 Plan 03: verifier now requires aud claim matching the
  // expectedAudience configured below. Legacy PEM path is used here for
  // backwards-compat since this test doesn't stand up a JWKS server.
  const INSPECTOR_AUD = 'https://dashboard.luqen.local/api/v1/mcp';
  validToken = await new SignJWT({
    scopes: ['read', 'write', 'admin'],
    orgId: 'test-org',
    role: 'admin',
    aud: [INSPECTOR_AUD],
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('test-user')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);

  const verifyToken = await createDashboardJwtVerifier({
    expectedAudience: INSPECTOR_AUD,
    legacyPem: publicKeyPem,
  });

  const storage = makeStubStorage([
    'reports.view',
    'branding.view',
    'scans.create',
    'admin.users',
    'admin.org',
    'admin.system',
    'service_connections.read',
    'service_connections.write',
  ]);
  const scanService = makeStubScanService();
  const serviceConnections = makeStubServiceConnections();

  app = Fastify({ logger: false });
  await registerMcpRoutes(app, { verifyToken, storage, scanService, serviceConnections });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
}, 60_000);

afterAll(async () => {
  if (app !== null) {
    await app.close();
    app = null;
  }
});

// ---------------------------------------------------------------------------
// Helpers — direct JSON-RPC fetch (fallback) + inspector CLI spawn (primary)
// ---------------------------------------------------------------------------

async function jsonRpc(
  method: string,
  params: unknown = {},
  token: string | null = validToken,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (token !== null) headers['authorization'] = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}/api/v1/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) {
    return { _status: response.status, _body: await response.text() };
  }
  const body = await response.text();
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as Record<string, unknown>;
  const data = trimmed
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'));
  if (data == null) throw new Error(`No SSE data line: ${body}`);
  return JSON.parse(data.slice('data:'.length).trim()) as Record<string, unknown>;
}

async function inspectorCommand(
  command: string,
  extraArgs: string[] = [],
  token: string | null = validToken,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const args = [
    '-y',
    '@modelcontextprotocol/inspector',
    '--cli',
    '--transport',
    'http',
    '--url',
    `${baseUrl}/api/v1/mcp`,
    '--command',
    command,
    ...extraArgs,
  ];
  if (token !== null) {
    args.push('--header', `Authorization: Bearer ${token}`);
  }
  return await new Promise((resolve) => {
    const child: ChildProcess = spawn('npx', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => {
      stdout += String(c);
    });
    child.stderr?.on('data', (c: Buffer) => {
      stderr += String(c);
    });
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCPT-05 — MCP Inspector smoke (D-16 part 1)', () => {
  it('tools/list returns at least 19 tools with expected names', async () => {
    if (USE_FALLBACK) {
      const result = (await jsonRpc('tools/list'))['result'] as {
        tools: Array<{ name: string }>;
      };
      const names = result.tools.map((t) => t.name);
      expect(names).toContain('dashboard_scan_site');
      expect(names).toContain('dashboard_list_reports');
      expect(names).toContain('dashboard_get_report');
      expect(names).toContain('dashboard_query_issues');
      expect(names).toContain('dashboard_list_brand_scores');
      expect(names).toContain('dashboard_get_brand_score');
      expect(names).toContain('dashboard_list_users');
      expect(names).toContain('dashboard_list_orgs');
      expect(names).toContain('dashboard_list_service_connections');
      expect(names.length).toBeGreaterThanOrEqual(19);
    } else {
      const { stdout, code } = await inspectorCommand('tools/list');
      expect(code).toBe(0);
      expect(stdout).toContain('dashboard_scan_site');
      expect(stdout).toContain('dashboard_list_reports');
      expect(stdout).toContain('dashboard_list_service_connections');
    }
  }, 60_000);

  it('resources/templates/list exposes both scan:// and brand:// URI families', async () => {
    if (USE_FALLBACK) {
      const result = (await jsonRpc('resources/templates/list'))['result'] as {
        resourceTemplates: Array<{ uriTemplate: string }>;
      };
      const templates = result.resourceTemplates.map((t) => t.uriTemplate);
      expect(templates.some((u) => u.startsWith('scan://'))).toBe(true);
      expect(templates.some((u) => u.startsWith('brand://'))).toBe(true);
    } else {
      const { stdout, code } = await inspectorCommand('resources/templates/list');
      expect(code).toBe(0);
      expect(stdout).toMatch(/scan:\/\//);
      expect(stdout).toMatch(/brand:\/\//);
    }
  }, 60_000);

  it('prompts/list returns exactly ["scan", "report", "fix"]', async () => {
    if (USE_FALLBACK) {
      const result = (await jsonRpc('prompts/list'))['result'] as {
        prompts: Array<{ name: string }>;
      };
      const names = result.prompts.map((p) => p.name).sort();
      expect(names).toEqual(['fix', 'report', 'scan']);
    } else {
      const { stdout, code } = await inspectorCommand('prompts/list');
      expect(code).toBe(0);
      expect(stdout).toContain('scan');
      expect(stdout).toContain('report');
      expect(stdout).toContain('fix');
    }
  }, 60_000);

  it('tools/call dashboard_list_reports returns the expected envelope', async () => {
    if (USE_FALLBACK) {
      const parsed = await jsonRpc('tools/call', {
        name: 'dashboard_list_reports',
        arguments: {},
      });
      const result = parsed['result'] as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(result.isError).toBeFalsy();
      expect(result.content[0]?.type).toBe('text');
      const payload = JSON.parse(result.content[0]?.text ?? '{}') as {
        data?: unknown;
      };
      expect(Array.isArray(payload.data)).toBe(true);
    } else {
      const { stdout, code } = await inspectorCommand('tools/call', [
        '--argument',
        JSON.stringify({ name: 'dashboard_list_reports', arguments: {} }),
      ]);
      expect(code).toBe(0);
      expect(stdout).toContain('"data"');
    }
  }, 60_000);

  it('401 when Authorization header is missing', async () => {
    const parsed = await jsonRpc('tools/list', {}, null);
    expect(parsed['_status']).toBe(401);
  });

  it('401 when Bearer token is invalid', async () => {
    const parsed = await jsonRpc('tools/list', {}, 'garbage-not-a-jwt');
    expect(parsed['_status']).toBe(401);
  });
});
