/**
 * Phase 31.2 Plan 03 — Dashboard MCP tool-metadata drift prevention (D-09).
 *
 * Locks in the invariant that every dashboard MCP tool declares a valid
 * `requiredPermission` from the ALL_PERMISSION_IDS catalogue, and that the
 * exported metadata array matches the set of tools actually registered by
 * createDashboardMcpServer. Any contributor adding a new tool without
 * metadata (or with a typo'd permission name) breaks CI here.
 *
 * Five invariants enforced:
 *   1. DASHBOARD_TOOL_METADATA is non-empty.
 *   2. Every entry has a non-empty string `requiredPermission` (no tool
 *      without RBAC declaration).
 *   3. Every tool name matches /^[a-z][a-z0-9_]+$/ — catches typos.
 *   4. Every requiredPermission is a known ALL_PERMISSION_IDS entry —
 *      catches permission typos like `scan.create` vs `scans.create`.
 *   5. Metadata list matches the actually-registered tool count from
 *      createDashboardMcpServer (no orphan tools, no orphan metadata).
 */

import { describe, it, expect } from 'vitest';
import { DASHBOARD_TOOL_METADATA } from '../../src/mcp/metadata.js';
import { ALL_PERMISSION_IDS } from '../../src/permissions.js';
import { createDashboardMcpServer } from '../../src/mcp/server.js';
import type { StorageAdapter } from '../../src/db/index.js';
import type { ScanService } from '../../src/services/scan-service.js';
import type { ServiceConnectionsRepository } from '../../src/db/service-connections-repository.js';

// ---------------------------------------------------------------------------
// Minimal stubs — enough for createDashboardMcpServer to run tool registration.
// Mirrors the pattern in admin-tools.test.ts / data-tools.test.ts.
// ---------------------------------------------------------------------------

function makeStubStorage(): StorageAdapter {
  const empty = {} as unknown;
  return {
    scans: empty as StorageAdapter['scans'],
    brandScores: empty as StorageAdapter['brandScores'],
    users: empty as StorageAdapter['users'],
    organizations: empty as StorageAdapter['organizations'],
    roles: empty as StorageAdapter['roles'],
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
    upsert: (async () => ({
      serviceId: 'compliance' as const,
      url: '',
      clientId: '',
      clientSecret: '',
      hasSecret: false,
      updatedAt: '1970-01-01T00:00:00.000Z',
      updatedBy: 'stub',
      source: 'db' as const,
    })) as unknown as ServiceConnectionsRepository['upsert'],
    clearSecret: async () => {},
  };
}

describe('dashboard MCP tool metadata — drift prevention (Phase 31.2 D-09)', () => {
  it('DASHBOARD_TOOL_METADATA is non-empty', () => {
    expect(DASHBOARD_TOOL_METADATA.length).toBeGreaterThan(0);
  });

  it('every tool declares a non-empty requiredPermission', () => {
    const missing = DASHBOARD_TOOL_METADATA.filter(
      (t) =>
        typeof t.requiredPermission !== 'string' ||
        t.requiredPermission.length === 0,
    );
    expect(
      missing,
      `Tools missing requiredPermission: ${missing.map((t) => t.name).join(', ')}`,
    ).toEqual([]);
  });

  it('every tool name matches /^[a-z][a-z0-9_]+$/ (hygiene)', () => {
    const bad = DASHBOARD_TOOL_METADATA.filter(
      (t) => !/^[a-z][a-z0-9_]+$/.test(t.name),
    );
    expect(bad).toEqual([]);
  });

  it('every requiredPermission is a known ALL_PERMISSION_IDS entry', () => {
    const known = new Set<string>(ALL_PERMISSION_IDS);
    const unknown = DASHBOARD_TOOL_METADATA.filter(
      (t) => !known.has(t.requiredPermission as string),
    );
    expect(
      unknown,
      `Tools with unknown requiredPermission: ${unknown
        .map((t) => `${t.name} → ${String(t.requiredPermission)}`)
        .join(', ')}`,
    ).toEqual([]);
  });

  it('metadata list matches the actually-registered tool count', async () => {
    const { server } = await createDashboardMcpServer({
      storage: makeStubStorage(),
      scanService: makeStubScanService(),
      serviceConnections: makeStubServiceConnections(),
      // Compliance discovery tools register only when complianceAccess is
      // provided; we hand a stub so the registered surface includes the
      // four compliance tools and matches DASHBOARD_TOOL_METADATA.
      complianceAccess: async () => ({ baseUrl: 'http://stub', token: 'stub' }),
    });
    const registered =
      (
        server as unknown as {
          _registeredTools?: Record<string, unknown>;
        }
      )._registeredTools ?? {};
    const registeredNames = new Set(Object.keys(registered));
    const metadataNames = new Set(DASHBOARD_TOOL_METADATA.map((t) => t.name));

    const extraInRegistered = [...registeredNames].filter(
      (n) => !metadataNames.has(n),
    );
    const extraInMetadata = [...metadataNames].filter(
      (n) => !registeredNames.has(n),
    );
    expect({ extraInRegistered, extraInMetadata }).toEqual({
      extraInRegistered: [],
      extraInMetadata: [],
    });
  });
});
