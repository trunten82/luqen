/**
 * Layer 2 Integration Tests — Dashboard ↔ Real Compliance Service
 *
 * These tests call the REAL compliance service at http://localhost:4000.
 * They are skipped automatically when the service is unreachable.
 */
import { describe, it, expect } from 'vitest';
import {
  getToken,
  listJurisdictions,
  listRegulations,
  listRequirements,
  checkCompliance,
  getSeedStatus,
  getSystemHealth,
  safeListJurisdictions,
  safeGetSystemHealth,
  type TokenResponse,
  type Jurisdiction,
  type Regulation,
  type ComplianceCheckResult,
  type SeedStatus,
} from '../../src/compliance-client.js';

const BASE_URL = 'http://localhost:4000';
const CLIENT_ID = process.env['TEST_COMPLIANCE_CLIENT_ID'] ?? 'test-client-id';
const CLIENT_SECRET = process.env['TEST_COMPLIANCE_CLIENT_SECRET'] ?? 'test-client-secret';
const ADMIN_USER = 'admin';
const ADMIN_PASS = process.env['TEST_COMPLIANCE_ADMIN_PASS'] ?? 'TestPass123!';

/** Check if compliance service is reachable before running the suite. */
async function isServiceAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${BASE_URL}/api/v1/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

const available = await isServiceAvailable();

describe.skipIf(!available)('Compliance API Integration', () => {
  let token: string;

  // ─── 1. OAuth token acquisition (client_credentials) ───────────────────────
  describe('OAuth token acquisition', () => {
    it('should acquire a token via client_credentials grant', async () => {
      const res = await fetch(`${BASE_URL}/api/v1/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        }),
      });

      expect(res.ok).toBe(true);
      const data = await res.json() as TokenResponse;
      expect(data.access_token).toBeDefined();
      expect(typeof data.access_token).toBe('string');
      expect(data.access_token.length).toBeGreaterThan(10);
      expect(data.token_type).toMatch(/^[Bb]earer$/);
      expect(data.expires_in).toBeGreaterThan(0);
    });

    it('should acquire a token via password grant (getToken helper)', async () => {
      const data = await getToken(BASE_URL, ADMIN_USER, ADMIN_PASS, CLIENT_ID, CLIENT_SECRET);
      expect(data.access_token).toBeDefined();
      expect(data.token_type).toMatch(/^[Bb]earer$/);
      expect(data.expires_in).toBeGreaterThan(0);

      // Store for subsequent tests
      token = data.access_token;
    });
  });

  // ─── 2. listJurisdictions ──────────────────────────────────────────────────
  describe('listJurisdictions', () => {
    it('should return an array of jurisdictions from the real service', async () => {
      const jurisdictions: Jurisdiction[] = await listJurisdictions(BASE_URL, token);
      expect(Array.isArray(jurisdictions)).toBe(true);
      expect(jurisdictions.length).toBeGreaterThan(0);

      const first = jurisdictions[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('name');
      expect(first).toHaveProperty('type');
    });
  });

  // ─── 3. listRegulations ────────────────────────────────────────────────────
  describe('listRegulations', () => {
    it('should return an array of regulations from the real service', async () => {
      const regulations: Regulation[] = await listRegulations(BASE_URL, token);
      expect(Array.isArray(regulations)).toBe(true);
      expect(regulations.length).toBeGreaterThan(0);

      const first = regulations[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('name');
      expect(first).toHaveProperty('shortName');
      expect(first).toHaveProperty('jurisdictionId');
      expect(first).toHaveProperty('status');
    });

    it('should support filtering regulations by jurisdiction', async () => {
      const jurisdictions = await listJurisdictions(BASE_URL, token);
      const jurisdictionId = jurisdictions[0].id;

      const filtered = await listRegulations(BASE_URL, token, {
        jurisdictionId,
      });
      expect(Array.isArray(filtered)).toBe(true);
      for (const reg of filtered) {
        expect(reg.jurisdictionId).toBe(jurisdictionId);
      }
    });
  });

  // ─── 4. checkCompliance ────────────────────────────────────────────────────
  describe('checkCompliance', () => {
    it('should return a compliance check result with summary and matrix', async () => {
      const jurisdictions = await listJurisdictions(BASE_URL, token);
      const jurisdictionIds = jurisdictions.slice(0, 2).map((j) => j.id);

      const issues = [
        {
          code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
          type: 'error',
          message: 'Img element missing an alt attribute.',
          selector: 'img.hero',
          context: '<img class="hero" src="banner.jpg">',
        },
        {
          code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
          type: 'error',
          message: 'Insufficient contrast ratio.',
          selector: 'p.text',
          context: '<p class="text" style="color:#999">Hello</p>',
        },
      ];

      const result: ComplianceCheckResult = await checkCompliance(
        BASE_URL,
        token,
        jurisdictionIds,
        [],
        issues,
      );

      expect(result).toHaveProperty('summary');
      expect(result.summary).toHaveProperty('totalJurisdictions');
      expect(result.summary.totalJurisdictions).toBeGreaterThanOrEqual(1);
      expect(result.summary).toHaveProperty('passing');
      expect(result.summary).toHaveProperty('failing');
      expect(result.summary).toHaveProperty('totalMandatoryViolations');
      expect(result).toHaveProperty('matrix');
      expect(typeof result.matrix).toBe('object');
    });

    it('should return passing result for empty issues list', async () => {
      const jurisdictions = await listJurisdictions(BASE_URL, token);
      const jurisdictionIds = [jurisdictions[0].id];

      const result = await checkCompliance(
        BASE_URL,
        token,
        jurisdictionIds,
        [],
        [],
      );

      expect(result.summary.totalMandatoryViolations).toBe(0);
      expect(result.summary.totalJurisdictions).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── 5. Seed status ───────────────────────────────────────────────────────
  describe('Seed status', () => {
    it('should return seed status with counts', async () => {
      const status: SeedStatus = await getSeedStatus(BASE_URL, token);
      expect(status).toHaveProperty('seeded');
      expect(typeof status.seeded).toBe('boolean');
      expect(status).toHaveProperty('jurisdictions');
      expect(typeof status.jurisdictions).toBe('number');
      expect(status).toHaveProperty('regulations');
      expect(typeof status.regulations).toBe('number');
      expect(status).toHaveProperty('requirements');
      expect(typeof status.requirements).toBe('number');
    });
  });

  // ─── 6. Health check ──────────────────────────────────────────────────────
  describe('Health check', () => {
    it('should return healthy status from /api/v1/health', async () => {
      const res = await fetch(`${BASE_URL}/api/v1/health`);
      expect(res.ok).toBe(true);

      const data = await res.json() as Record<string, unknown>;
      expect(data.status).toBe('ok');
      expect(data).toHaveProperty('version');
      expect(data).toHaveProperty('timestamp');
    });

    it('should return health via getSystemHealth helper', async () => {
      const health = await getSystemHealth(BASE_URL);
      expect(health.compliance).toBeDefined();
      expect(health.compliance.status).toBe('ok');
    });
  });

  // ─── 7. Token refresh / reuse ─────────────────────────────────────────────
  describe('Token refresh', () => {
    it('should acquire token, wait briefly, and reuse it successfully', async () => {
      const tokenData = await getToken(BASE_URL, ADMIN_USER, ADMIN_PASS, CLIENT_ID, CLIENT_SECRET);
      const acquiredToken = tokenData.access_token;

      // Brief wait to simulate time passing
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Token should still work
      const jurisdictions = await listJurisdictions(BASE_URL, acquiredToken);
      expect(Array.isArray(jurisdictions)).toBe(true);
      expect(jurisdictions.length).toBeGreaterThan(0);
    });

    it('should be able to acquire multiple tokens in sequence', async () => {
      const token1 = await getToken(BASE_URL, ADMIN_USER, ADMIN_PASS, CLIENT_ID, CLIENT_SECRET);
      const token2 = await getToken(BASE_URL, ADMIN_USER, ADMIN_PASS, CLIENT_ID, CLIENT_SECRET);

      // Both tokens should be valid (may or may not be identical)
      expect(token1.access_token).toBeDefined();
      expect(token2.access_token).toBeDefined();

      // Both should work
      const r1 = await listJurisdictions(BASE_URL, token1.access_token);
      const r2 = await listJurisdictions(BASE_URL, token2.access_token);
      expect(r1.length).toBeGreaterThan(0);
      expect(r2.length).toBeGreaterThan(0);
    });
  });

  // ─── 8. Multi-tenancy (X-Org-Id header) ───────────────────────────────────
  describe('Multi-tenancy', () => {
    it('should accept X-Org-Id header and scope results', async () => {
      const orgId = 'test-org-integration';

      // Passing an org ID should not cause errors — the result set may
      // differ from the system-level call (likely empty for a non-existent org).
      const jurisdictions = await listJurisdictions(BASE_URL, token, orgId);
      expect(Array.isArray(jurisdictions)).toBe(true);
      // Org-scoped may return fewer or zero results — that is expected.
    });

    it('should return system-level data when orgId is "system"', async () => {
      // "system" orgId is treated as no-org (header not sent)
      const jurisdictions = await listJurisdictions(BASE_URL, token, 'system');
      expect(Array.isArray(jurisdictions)).toBe(true);
      expect(jurisdictions.length).toBeGreaterThan(0);
    });

    it('should scope regulations by org', async () => {
      const orgId = 'test-org-integration';
      const regulations = await listRegulations(BASE_URL, token, undefined, orgId);
      expect(Array.isArray(regulations)).toBe(true);
    });
  });

  // ─── 9. Error handling — invalid token ────────────────────────────────────
  describe('Error handling', () => {
    it('should return 401 for an invalid token', async () => {
      const invalidToken = 'invalid-token-value-12345';
      await expect(
        listJurisdictions(BASE_URL, invalidToken),
      ).rejects.toThrow(/401/);
    });

    it('should return 401 for an expired/malformed JWT', async () => {
      const fakeJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.invalid';
      await expect(
        listRegulations(BASE_URL, fakeJwt),
      ).rejects.toThrow(/40[13]/);
    });

    it('should reject invalid OAuth grant type', async () => {
      const res = await fetch(`${BASE_URL}/api/v1/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json() as Record<string, unknown>;
      expect(data.error).toContain('unsupported_grant_type');
    });

    it('should reject wrong client credentials', async () => {
      const res = await fetch(`${BASE_URL}/api/v1/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: CLIENT_ID,
          client_secret: 'wrong-secret',
        }),
      });

      expect(res.status).toBe(401);
    });

    it('should reject wrong password in password grant', async () => {
      await expect(
        getToken(BASE_URL, ADMIN_USER, 'wrong-password', CLIENT_ID, CLIENT_SECRET),
      ).rejects.toThrow(/Authentication failed/);
    });
  });

  // ─── 10. Graceful degradation ─────────────────────────────────────────────
  describe('Graceful degradation', () => {
    const DEAD_URL = 'http://localhost:59999';

    it('should return empty array from safeListJurisdictions when service is down', async () => {
      const result = await safeListJurisdictions(DEAD_URL, 'fake-token');
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it('should return degraded status from safeGetSystemHealth when service is down', async () => {
      const health = await safeGetSystemHealth(DEAD_URL);
      expect(health.compliance.status).toBe('degraded');
    });

    it('should throw from listJurisdictions (non-safe) when service is down', async () => {
      await expect(
        listJurisdictions(DEAD_URL, 'fake-token'),
      ).rejects.toThrow();
    });
  });
});
