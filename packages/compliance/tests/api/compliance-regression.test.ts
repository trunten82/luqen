/**
 * REG-04 regression test — this test MUST stay green forever.
 *
 * It pins the compliance API response shape for a jurisdictions-only request
 * against a stored JSON snapshot. If this test fails, the backwards-compat
 * contract for legacy (pre-Phase-07) callers has been broken.
 *
 * Regenerate the snapshot ONLY with explicit user approval. To regenerate,
 * delete the snapshot file and re-run this test — it will write a fresh
 * snapshot on first run.
 *
 * Phase: 07-regulation-filter / Plan 04
 * Requirement: REG-04 (backwards compatibility guarantee)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { createTestApp, authHeader } from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(__dirname, '__snapshots__', 'compliance-jurisdictions-only.snap.json');

// Canonical fixture request — DO NOT MODIFY unless regenerating the snapshot
// with explicit user approval. Any change to this request invalidates the
// backwards-compat guarantee this test provides.
const FIXED_REQUEST = {
  jurisdictions: ['EU', 'DE'],
  issues: [
    {
      code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
      type: 'error',
      message: 'Img element missing an alt attribute',
      selector: 'img',
      context: '<img src="test.png">',
    },
    {
      code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18',
      type: 'error',
      message: 'Insufficient contrast',
      selector: 'p.small',
      context: '<p class="small">text</p>',
    },
    {
      code: 'WCAG2AA.Principle2.Guideline2_4.2_4_4.H77',
      type: 'warning',
      message: 'Link text may not be descriptive',
      selector: 'a.more',
      context: '<a class="more">click</a>',
    },
  ],
  includeOptional: false,
} as const;

interface ComplianceResponse {
  readonly matrix: Record<string, unknown>;
  readonly summary: Record<string, unknown>;
  readonly annotatedIssues: readonly unknown[];
  readonly regulationMatrix: Record<string, unknown>;
}

describe('REG-04 regression — jurisdictions-only backwards compatibility', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let readToken: string;
  let snapshot: ComplianceResponse;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    adminToken = ctx.adminToken;
    readToken = ctx.readToken;

    // Seed the baseline regulations + requirements fixture
    await app.inject({
      method: 'POST',
      url: '/api/v1/seed',
      headers: authHeader(adminToken),
    });

    // If snapshot does not exist, capture it by running the canonical request
    // once and writing the output. Subsequent runs read from disk and assert
    // byte equality.
    if (!existsSync(SNAPSHOT_PATH)) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/compliance/check',
        headers: { ...authHeader(readToken), 'content-type': 'application/json' },
        body: JSON.stringify(FIXED_REQUEST),
      });
      const body = JSON.parse(res.body) as ComplianceResponse;
      writeFileSync(
        SNAPSHOT_PATH,
        JSON.stringify(
          {
            request: FIXED_REQUEST,
            response: {
              matrix: body.matrix,
              summary: body.summary,
              annotatedIssues: body.annotatedIssues,
              regulationMatrix: body.regulationMatrix,
            },
          },
          null,
          2,
        ) + '\n',
      );
    }

    const raw = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as {
      response: ComplianceResponse;
    };
    snapshot = raw.response;
  });

  afterAll(async () => {
    await app.close();
  });

  it('response.matrix equals golden snapshot (REG-04)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/compliance/check',
      headers: { ...authHeader(readToken), 'content-type': 'application/json' },
      body: JSON.stringify(FIXED_REQUEST),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as ComplianceResponse;
    expect(body.matrix).toEqual(snapshot.matrix);
    expect(body.summary).toEqual(snapshot.summary);
    expect(body.annotatedIssues).toEqual(snapshot.annotatedIssues);
    // regulationMatrix must be present and empty when no regulations requested
    expect(body.regulationMatrix).toEqual({});
  });

  it('regulations: [] produces identical result (REG-04)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/compliance/check',
      headers: { ...authHeader(readToken), 'content-type': 'application/json' },
      body: JSON.stringify({ ...FIXED_REQUEST, regulations: [] }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as ComplianceResponse;
    expect(body.matrix).toEqual(snapshot.matrix);
    expect(body.summary).toEqual(snapshot.summary);
    expect(body.annotatedIssues).toEqual(snapshot.annotatedIssues);
    expect(body.regulationMatrix).toEqual({});
  });

  it('regulations: undefined produces identical result (REG-04)', async () => {
    // JSON cannot carry an explicit undefined; we simulate by omitting the key
    // (same wire shape as legacy jurisdictions-only callers).
    const payload = { ...FIXED_REQUEST };
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/compliance/check',
      headers: { ...authHeader(readToken), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as ComplianceResponse;
    expect(body.matrix).toEqual(snapshot.matrix);
  });

  it('top-level response keys exactly match the stable contract (REG-04)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/compliance/check',
      headers: { ...authHeader(readToken), 'content-type': 'application/json' },
      body: JSON.stringify(FIXED_REQUEST),
    });

    const body = JSON.parse(res.body) as Record<string, unknown>;
    // Exhaustive set of top-level keys — any addition here is a breaking change
    // that requires explicit review.
    expect(Object.keys(body).sort()).toEqual([
      'annotatedIssues',
      'matrix',
      'regulationMatrix',
      'summary',
    ]);
  });
});
