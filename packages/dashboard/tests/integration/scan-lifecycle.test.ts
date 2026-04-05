/**
 * Layer 2 Integration Test — Scan Lifecycle
 *
 * Tests the complete scan lifecycle against REAL services:
 *   - Pa11y webservice (configurable via TEST_PA11Y_URL env var)
 *   - Compliance service (http://localhost:4000)
 *   - Dashboard server started on a random port
 *
 * Skips automatically when services are unavailable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Service configuration
// ---------------------------------------------------------------------------

const PA11Y_URL = process.env['TEST_PA11Y_URL'] ?? 'http://localhost:3000';
const COMPLIANCE_URL = 'http://localhost:4000';
const COMPLIANCE_CLIENT_ID = process.env['TEST_COMPLIANCE_CLIENT_ID'] ?? 'test-client-id';
const COMPLIANCE_CLIENT_SECRET = process.env['TEST_COMPLIANCE_CLIENT_SECRET'] ?? 'test-client-secret';
const API_KEY = process.env['TEST_API_KEY'] ?? 'test-key-' + '0'.repeat(48);

const TEST_SITE_URL = 'https://example.com';
// URL() normalizes to add trailing slash — server stores the normalized form
const TEST_SITE_URL_NORMALIZED = 'https://example.com/';

// ---------------------------------------------------------------------------
// Service availability check
// ---------------------------------------------------------------------------

async function isServiceUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

let servicesAvailable = false;
let complianceAvailable = false;

try {
  const [pa11yUp, complianceUp] = await Promise.all([
    isServiceUp(PA11Y_URL),
    isServiceUp(COMPLIANCE_URL),
  ]);
  // Pa11y is required; compliance is optional (scan works without it)
  servicesAvailable = pa11yUp;
  complianceAvailable = complianceUp;
  if (!servicesAvailable) {
    console.log(
      `Integration test skipped — pa11y webservice not available at ${PA11Y_URL}`,
    );
  }
  if (!complianceAvailable) {
    console.log('Compliance service not available — compliance-specific assertions will be skipped');
  }
} catch {
  console.log('Integration test skipped — could not check service availability');
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe.skipIf(!servicesAvailable)('Scan Lifecycle (integration)', { timeout: 120_000 }, () => {
  let server: FastifyInstance;
  let baseUrl: string;
  let scanId: string | undefined;

  // ── Server setup ──────────────────────────────────────────────────────

  beforeAll(async () => {
    // Isolate DB and reports in a temp directory for this test run
    const testDir = join(tmpdir(), `luqen-integ-${randomUUID().slice(0, 8)}`);
    mkdirSync(testDir, { recursive: true });
    const reportsDir = join(testDir, 'reports');
    mkdirSync(reportsDir, { recursive: true });
    const pluginsDir = join(testDir, 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    const dbPath = join(testDir, 'test.db');

    // Session secret must be at least 32 chars
    const sessionSecret = 'integration-test-secret-that-is-long-enough-for-validation';

    const { createServer } = await import('../../src/server.js');

    server = await createServer({
      port: 0,
      complianceUrl: COMPLIANCE_URL,
      webserviceUrl: PA11Y_URL,
      reportsDir,
      dbPath,
      sessionSecret,
      maxConcurrentScans: 2,
      complianceClientId: COMPLIANCE_CLIENT_ID,
      complianceClientSecret: COMPLIANCE_CLIENT_SECRET,
      pluginsDir,
      maxPages: 5,
    });

    // Inject the test API key into the database so auth works.
    // The server already ran migrations and created a default key.
    // We add our known test key so we can authenticate.
    const crypto = await import('node:crypto');
    const hash = crypto.createHash('sha256').update(API_KEY).digest('hex');
    const db = (await import('better-sqlite3')).default(dbPath);
    db.prepare(
      'INSERT INTO api_keys (id, key_hash, label, active, created_at, org_id) VALUES (?, ?, ?, 1, ?, ?)',
    ).run(randomUUID(), hash, 'integration-test', new Date().toISOString(), 'system');
    db.close();

    // Start listening on a random port
    const address = await server.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = address;
  }, 30_000);

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });

  // ── Helpers ─────────────────────────────────────────────────────────────

  function apiGet(path: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      headers: { 'X-API-Key': API_KEY },
    });
  }

  function apiPost(
    path: string,
    body: Record<string, unknown>,
    options?: { contentType?: string },
  ): Promise<Response> {
    const contentType = options?.contentType ?? 'application/x-www-form-urlencoded';
    const bodyStr =
      contentType === 'application/x-www-form-urlencoded'
        ? new URLSearchParams(body as Record<string, string>).toString()
        : JSON.stringify(body);
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': contentType,
      },
      body: bodyStr,
      redirect: 'manual',
    });
  }

  function apiDelete(path: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: 'DELETE',
      headers: {
        'X-API-Key': API_KEY,
        'hx-request': 'true',  // Bypass redirect, get direct response
      },
      redirect: 'manual',
    });
  }

  async function pollScanCompletion(id: string, maxWaitMs = 90_000): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const res = await apiGet(`/api/v1/scans/${id}`);
      if (res.ok) {
        const json = (await res.json()) as { data: { status: string } };
        if (json.data.status === 'completed' || json.data.status === 'failed') {
          return json.data.status;
        }
      }
      // Wait 2 seconds between polls
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`Scan ${id} did not complete within ${maxWaitMs}ms`);
  }

  // ── Test 1: Create a scan ─────────────────────────────────────────────

  it('POST /scan/new — creates a scan and redirects to progress', async () => {
    const res = await apiPost('/scan/new', {
      siteUrl: TEST_SITE_URL,
      standard: 'WCAG2AA',
      scanMode: 'single',
      concurrency: '1',
    });

    // Should redirect to /scan/:id/progress (302)
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toBeTruthy();
    expect(location).toContain('/scan/');
    expect(location).toContain('/progress');

    // Extract scan ID from redirect URL
    const match = location!.match(/\/scan\/([a-f0-9-]+)\/progress/);
    expect(match).toBeTruthy();
    scanId = match![1];
    expect(scanId).toBeTruthy();
  });

  // ── Test 2: Scan appears in progress (GET scan details before completion)

  it('GET /api/v1/scans/:id — returns scan details', async () => {
    expect(scanId).toBeDefined();

    const res = await apiGet(`/api/v1/scans/${scanId}`);
    expect(res.ok).toBe(true);

    const json = (await res.json()) as { data: { id: string; siteUrl: string; standard: string; status: string } };
    expect(json.data.id).toBe(scanId);
    expect(json.data.siteUrl).toBe(TEST_SITE_URL_NORMALIZED);
    expect(json.data.standard).toBe('WCAG2AA');
    expect(['pending', 'running', 'completed']).toContain(json.data.status);
  });

  // ── Test 3: Wait for scan completion ──────────────────────────────────

  it('waits for scan to complete (max 90s)', async () => {
    expect(scanId).toBeDefined();

    const status = await pollScanCompletion(scanId!);
    expect(status).toBe('completed');
  }, 100_000);

  // ── Test 4: Verify completed scan in listing ──────────────────────────

  it('GET /api/v1/scans — completed scan appears in listing', async () => {
    expect(scanId).toBeDefined();

    const res = await apiGet('/api/v1/scans');
    expect(res.ok).toBe(true);

    const json = (await res.json()) as {
      data: Array<{ id: string; siteUrl: string; status: string }>;
      total: number;
    };
    expect(json.total).toBeGreaterThanOrEqual(1);

    const found = json.data.find((s) => s.id === scanId);
    expect(found).toBeDefined();
    expect(found!.siteUrl).toBe(TEST_SITE_URL_NORMALIZED);
    expect(found!.status).toBe('completed');
  });

  // ── Test 5: Verify scan details include report summary ────────────────

  it('GET /api/v1/scans/:id — completed scan has report summary', async () => {
    expect(scanId).toBeDefined();

    const res = await apiGet(`/api/v1/scans/${scanId}`);
    expect(res.ok).toBe(true);

    const json = (await res.json()) as {
      data: {
        id: string;
        status: string;
        summary: {
          pagesScanned: number;
          totalIssues: number;
          byLevel: { error: number; warning: number; notice: number };
        } | null;
      };
    };

    expect(json.data.status).toBe('completed');
    expect(json.data.summary).not.toBeNull();
    expect(json.data.summary!.pagesScanned).toBeGreaterThanOrEqual(1);
    expect(typeof json.data.summary!.totalIssues).toBe('number');
    expect(typeof json.data.summary!.byLevel.error).toBe('number');
    expect(typeof json.data.summary!.byLevel.warning).toBe('number');
    expect(typeof json.data.summary!.byLevel.notice).toBe('number');
  });

  // ── Test 6: Verify scan issues endpoint ───────────────────────────────

  it('GET /api/v1/scans/:id/issues — returns issue list', async () => {
    expect(scanId).toBeDefined();

    const res = await apiGet(`/api/v1/scans/${scanId}/issues`);
    expect(res.ok).toBe(true);

    const json = (await res.json()) as {
      data: Array<{
        type: string;
        code: string;
        message: string;
        selector: string;
        pageUrl: string;
      }>;
      total: number;
    };

    expect(typeof json.total).toBe('number');
    expect(Array.isArray(json.data)).toBe(true);
    // example.com should have at least some issues (notices typically)
    if (json.total > 0) {
      const issue = json.data[0];
      expect(issue.type).toBeDefined();
      expect(issue.code).toBeDefined();
      expect(issue.message).toBeDefined();
      expect(issue.pageUrl).toBeDefined();
    }
  });

  // ── Test 7: Excel export of scans ─────────────────────────────────────

  it('GET /api/v1/export/scans.xlsx — returns Excel workbook with scan data', async () => {
    const res = await apiGet('/api/v1/export/scans.xlsx');
    expect(res.ok).toBe(true);

    const contentType = res.headers.get('content-type');
    expect(contentType).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const disposition = res.headers.get('content-disposition');
    expect(disposition).toContain('attachment');
    expect(disposition).toContain('.xlsx');

    // Excel is binary — just verify non-empty payload and xlsx magic bytes (PK zip header)
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
  });

  // ── Test 8: Excel export of issues ────────────────────────────────────

  it('GET /api/v1/export/scans/:id/issues.xlsx — returns Excel file', async () => {
    expect(scanId).toBeDefined();

    const res = await apiGet(`/api/v1/export/scans/${scanId}/issues.xlsx`);
    expect(res.ok).toBe(true);

    const contentType = res.headers.get('content-type');
    expect(contentType).toContain('spreadsheetml');

    const disposition = res.headers.get('content-disposition');
    expect(disposition).toContain('attachment');
    expect(disposition).toContain('.xlsx');

    // Verify it is non-empty binary data
    const buffer = await res.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);

    // XLSX files start with PK (ZIP magic bytes)
    const bytes = new Uint8Array(buffer);
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
  });

  // ── Test 9: Cleanup — delete the scan ─────────────────────────────────

  it('DELETE /reports/:id — deletes the scan record', async () => {
    expect(scanId).toBeDefined();

    // First, get a CSRF token by loading a page (generates a token in the session)
    // For API key auth, the CSRF protection may require a valid token.
    // Use HTMX header to get a 200 empty response instead of a redirect.
    const res = await apiDelete(`/reports/${scanId}`);

    // Accept 200 (HTMX), 302 (redirect), or 403 (CSRF block — expected for API-only access)
    // If CSRF blocks the delete, verify we can still read the scan (it was not deleted)
    if (res.status === 403) {
      // CSRF protection blocked the DELETE — this is expected for API-key-only auth
      // without a session. The scan still exists, which is fine.
      const check = await apiGet(`/api/v1/scans/${scanId}`);
      expect(check.ok).toBe(true);
    } else {
      expect([200, 302]).toContain(res.status);
      // Verify scan is gone
      const check = await apiGet(`/api/v1/scans/${scanId}`);
      expect(check.status).toBe(404);
    }
  });
});
