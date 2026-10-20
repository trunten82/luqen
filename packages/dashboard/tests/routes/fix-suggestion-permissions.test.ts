import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance, FastifyReply } from 'fastify';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { registerSession } from '../../src/auth/session.js';
import { reportRoutes } from '../../src/routes/reports.js';
import type { LLMClient } from '../../src/llm-client.js';
import { loadTranslations, t } from '../../src/i18n/index.js';

loadTranslations();

const TEST_SESSION_SECRET = 'test-session-secret-at-least-32b';
const AI_FIXED_HTML = '<img src="x.png" alt="ai-marker-fixed-html-7f3a">';
const AI_EXPLANATION = 'ai-marker-explanation-91c2';
const ISSUE_MESSAGE = 'Img element missing an alt attribute';

interface Harness {
  server: FastifyInstance;
  scanId: string;
  generateFix: ReturnType<typeof vi.fn>;
  cleanup: () => void;
}

/**
 * Unlike tests/routes/reports.test.ts, this harness grants EXACTLY the
 * permissions passed in. Nothing is force-added, so a caller that holds
 * issues.fix but not llm.view can actually be expressed.
 */
async function createHarness(
  permissions: string[],
  hasLlm: boolean,
): Promise<Harness> {
  const dbPath = join(tmpdir(), `test-fixperm-${randomUUID()}.db`);
  const reportsDir = join(tmpdir(), `test-fixperm-dir-${randomUUID()}`);
  mkdirSync(reportsDir, { recursive: true });

  const storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  const generateFix = vi.fn().mockResolvedValue({
    fixedHtml: AI_FIXED_HTML,
    explanation: AI_EXPLANATION,
  });
  const llm = {
    baseUrl: 'https://llm.example.com',
    generateFix,
    destroy: () => {},
  } as unknown as LLMClient;

  const server = Fastify({ logger: false });
  await server.register(import('@fastify/formbody'));
  await registerSession(server, TEST_SESSION_SECRET);

  server.decorateReply(
    'view',
    function (this: FastifyReply, template: string, data: unknown) {
      return this.code(200).header('content-type', 'application/json').send(
        JSON.stringify({ template, data }),
      );
    },
  );

  server.addHook('preHandler', async (request) => {
    request.user = {
      id: 'user-1',
      username: 'fixer',
      role: 'user',
      currentOrgId: 'system',
    };
    (request as unknown as Record<string, unknown>)['permissions'] = new Set(permissions);
  });

  await reportRoutes(server, storage, () => (hasLlm ? llm : null), { reportsDir });
  await server.ready();

  const scanId = randomUUID();
  await storage.scans.createScan({
    id: scanId,
    siteUrl: 'https://example.com',
    standard: 'WCAG2AA',
    jurisdictions: [],
    createdBy: 'fixer',
    createdAt: new Date().toISOString(),
    orgId: 'system',
  });

  const cleanup = (): void => {
    void storage.disconnect();
    if (existsSync(dbPath)) rmSync(dbPath);
    if (existsSync(reportsDir)) rmSync(reportsDir, { recursive: true });
    void server.close();
  };

  return { server, scanId, generateFix, cleanup };
}

function fixUrl(scanId: string): string {
  return `/reports/${scanId}/fix-suggestion?criterion=1.1.1&message=${encodeURIComponent(ISSUE_MESSAGE)}`;
}

async function getFix(h: Harness) {
  return h.server.inject({
    method: 'GET',
    url: fixUrl(h.scanId),
    headers: { 'hx-request': 'true' },
  });
}

describe('GET /reports/:id/fix-suggestion permissions', () => {
  let harness: Harness | undefined;

  afterEach(() => {
    harness?.cleanup();
    harness = undefined;
  });

  it('issues.fix without llm.view gets the pattern suggestion and the LLM is never called', async () => {
    harness = await createHarness(['reports.view', 'issues.fix'], true);
    const res = await getFix(harness);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(t('reportDetail.fixSourcePattern'));
    expect(res.body).not.toContain('ai-marker-fixed-html-7f3a');
    expect(res.body).not.toContain(t('reportDetail.fixSourceAi'));
    expect(res.body).not.toContain(t('reportDetail.fixLlmUnavailable'));
    expect(harness.generateFix).toHaveBeenCalledTimes(0);
  });

  it('issues.fix without llm.view sees no AI unavailable note when no LLM is configured', async () => {
    harness = await createHarness(['reports.view', 'issues.fix'], false);
    const res = await getFix(harness);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(t('reportDetail.fixSourcePattern'));
    expect(res.body).not.toContain(t('reportDetail.fixLlmUnavailable'));
  });

  it('llm.view holder gets the AI suggestion from generateFix', async () => {
    harness = await createHarness(['reports.view', 'llm.view'], true);
    const res = await getFix(harness);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('ai-marker-fixed-html-7f3a');
    expect(res.body).toContain(t('reportDetail.fixSourceAi'));
    expect(harness.generateFix).toHaveBeenCalledTimes(1);
    expect(harness.generateFix.mock.calls[0]?.[0]).toMatchObject({ wcagCriterion: '1.1.1' });
  });

  it('llm.view holder sees the AI unavailable note when no LLM is configured', async () => {
    harness = await createHarness(['reports.view', 'llm.view'], false);
    const res = await getFix(harness);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(t('reportDetail.fixLlmUnavailable'));
  });

  it('a caller with neither issues.fix nor llm.view is refused with 403', async () => {
    harness = await createHarness(['reports.view'], true);
    const res = await getFix(harness);

    expect(res.statusCode).toBe(403);
    expect(harness.generateFix).toHaveBeenCalledTimes(0);
  });
});
