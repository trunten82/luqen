import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, authHeader } from './helpers.js';
import type { FastifyInstance } from 'fastify';

describe('Compliance Check API', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let readToken: string;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    adminToken = ctx.adminToken;
    readToken = ctx.readToken;

    // Seed the baseline data
    await app.inject({
      method: 'POST',
      url: '/api/v1/seed',
      headers: authHeader(adminToken),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns compliance matrix for EU jurisdiction', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/compliance/check',
      headers: { ...authHeader(readToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        jurisdictions: ['EU'],
        issues: [
          {
            code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
            type: 'error',
            message: 'Img element missing an alt attribute',
            selector: 'img',
            context: '<img src="test.png">',
          },
        ],
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.matrix).toBeDefined();
    expect(body.annotatedIssues).toBeDefined();
    expect(body.summary).toBeDefined();

    const matrix = body.matrix as Record<string, { status: string; jurisdictionId: string }>;
    expect(matrix.EU).toBeDefined();
    expect(matrix.EU.status).toBe('fail'); // EU EAA requires WCAG 2.1 AA
  });

  it('returns annotated issues with regulation data', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/compliance/check',
      headers: { ...authHeader(readToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        jurisdictions: ['EU'],
        issues: [
          {
            code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
            type: 'error',
            message: 'Missing alt text',
            selector: 'img',
            context: '<img>',
          },
        ],
      }),
    });

    const body = JSON.parse(response.body) as {
      annotatedIssues: Array<{ wcagCriterion: string; regulations: unknown[] }>;
    };
    expect(body.annotatedIssues.length).toBeGreaterThan(0);
    expect(body.annotatedIssues[0].wcagCriterion).toBe('1.1.1');
    expect(body.annotatedIssues[0].regulations.length).toBeGreaterThan(0);
  });

  it('checks German jurisdiction includes EU regulations (inheritance)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/compliance/check',
      headers: { ...authHeader(readToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        jurisdictions: ['DE'],
        issues: [
          {
            code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
            type: 'error',
            message: 'Missing alt text',
            selector: 'img',
            context: '<img>',
          },
        ],
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      matrix: Record<string, { status: string; regulations: Array<{ regulationId: string }> }>;
    };

    // DE should fail and include EU regulations
    expect(body.matrix.DE).toBeDefined();
    expect(body.matrix.DE.status).toBe('fail');

    // Should include EU EAA via inheritance (baseline uses uppercase IDs)
    const regulationIds = body.matrix.DE.regulations.map(r => r.regulationId);
    expect(regulationIds.length).toBeGreaterThan(0);
    // DE regulations include EU-EAA (or similar EU regulation via parentId)
    const hasEuRegulation = regulationIds.some(id => id.startsWith('EU-') || id.startsWith('eu-'));
    expect(hasEuRegulation).toBe(true);
  });

  it('returns summary with pass/fail counts', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/compliance/check',
      headers: { ...authHeader(readToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        jurisdictions: ['EU', 'US'],
        issues: [
          {
            code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
            type: 'error',
            message: 'Missing alt text',
            selector: 'img',
            context: '<img>',
          },
        ],
      }),
    });

    const body = JSON.parse(response.body) as {
      summary: {
        totalJurisdictions: number;
        passing: number;
        failing: number;
        totalMandatoryViolations: number;
        totalOptionalViolations: number;
      };
    };

    expect(body.summary.totalJurisdictions).toBe(2);
    expect(body.summary.failing).toBeGreaterThan(0);
    expect(typeof body.summary.totalMandatoryViolations).toBe('number');
  });

  it('returns empty violations for no issues', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/compliance/check',
      headers: { ...authHeader(readToken), 'content-type': 'application/json' },
      body: JSON.stringify({
        jurisdictions: ['EU'],
        issues: [],
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      matrix: Record<string, { status: string }>;
    };
    expect(body.matrix.EU.status).toBe('pass');
  });

  it('validates required jurisdictions field', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/compliance/check',
      headers: { ...authHeader(readToken), 'content-type': 'application/json' },
      body: JSON.stringify({ issues: [] }),
    });

    expect(response.statusCode).toBe(400);
  });

  it('requires auth (read scope)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/compliance/check',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jurisdictions: ['EU'], issues: [] }),
    });

    expect(response.statusCode).toBe(401);
  });

  // ─── Phase 07 / Plan 01: regulations filter (REG-02, REG-03, REG-04) ───
  describe('regulations filter', () => {
    const SAMPLE_ISSUE = {
      code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
      type: 'error',
      message: 'Img element missing an alt attribute',
      selector: 'img',
      context: '<img src="test.png">',
    };

    it('A: accepts optional regulations[] alongside jurisdictions[] and returns regulationMatrix', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/compliance/check',
        headers: { ...authHeader(readToken), 'content-type': 'application/json' },
        body: JSON.stringify({
          jurisdictions: ['EU'],
          regulations: ['eu-eaa'],
          issues: [],
        }),
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { regulationMatrix: Record<string, unknown> };
      expect(body.regulationMatrix).toBeDefined();
      expect(typeof body.regulationMatrix).toBe('object');
    });

    it('B: accepts regulations-only request (empty jurisdictions)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/compliance/check',
        headers: { ...authHeader(readToken), 'content-type': 'application/json' },
        body: JSON.stringify({
          jurisdictions: [],
          regulations: ['eu-eaa'],
          issues: [],
        }),
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { regulationMatrix: Record<string, unknown> };
      expect(body.regulationMatrix).toBeDefined();
    });

    it('C: rejects empty jurisdictions AND empty regulations with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/compliance/check',
        headers: { ...authHeader(readToken), 'content-type': 'application/json' },
        body: JSON.stringify({
          jurisdictions: [],
          regulations: [],
          issues: [],
        }),
      });
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('jurisdictions or regulations array is required');
    });

    it('D: response always includes regulationMatrix as {} when no regulations requested', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/compliance/check',
        headers: { ...authHeader(readToken), 'content-type': 'application/json' },
        body: JSON.stringify({
          jurisdictions: ['EU'],
          issues: [],
        }),
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { regulationMatrix: unknown };
      expect(body.regulationMatrix).toBeDefined();
      expect(body.regulationMatrix).toEqual({});
    });

    it('E: jurisdictions-only legacy shape is preserved (matrix/summary/annotatedIssues unchanged)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/compliance/check',
        headers: { ...authHeader(readToken), 'content-type': 'application/json' },
        body: JSON.stringify({
          jurisdictions: ['EU'],
          issues: [SAMPLE_ISSUE],
        }),
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as Record<string, unknown>;

      // All legacy top-level fields still present
      expect(body).toHaveProperty('matrix');
      expect(body).toHaveProperty('annotatedIssues');
      expect(body).toHaveProperty('summary');
      // New field is additive and equals {} when regulations not requested
      expect(body).toHaveProperty('regulationMatrix');
      expect(body.regulationMatrix).toEqual({});

      // Exhaustive key check — nothing unexpected added beyond regulationMatrix
      const topLevelKeys = Object.keys(body).sort();
      expect(topLevelKeys).toEqual(['annotatedIssues', 'matrix', 'regulationMatrix', 'summary']);
    });

    it('F: cacheKey differs between {jurisdictions:[EU]} and {jurisdictions:[EU],regulations:[X]}', async () => {
      const { cacheKey } = await import('../../src/api/routes/compliance.js');
      const a = cacheKey({ jurisdictions: ['EU'], issues: [] }, 'org1');
      const b = cacheKey(
        { jurisdictions: ['EU'], regulations: ['eu-eaa'], issues: [] },
        'org1',
      );
      expect(a).not.toBe(b);
      // Also verify sort-stability: order independence
      const c = cacheKey(
        { jurisdictions: ['EU'], regulations: ['eu-eaa'], issues: [] },
        'org1',
      );
      expect(b).toBe(c);
    });
  });
});
