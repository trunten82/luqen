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
});
