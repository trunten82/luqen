import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';

vi.mock('../../src/capabilities/generate-fix.js', () => ({
  executeGenerateFix: vi.fn(),
}));
import { executeGenerateFix } from '../../src/capabilities/generate-fix.js';
const mockGenerateFix = vi.mocked(executeGenerateFix);

const TEST_DB = '/tmp/llm-credits-metering-test.db';
function cleanup() {
  for (const p of [TEST_DB, `${TEST_DB}-shm`, `${TEST_DB}-wal`]) if (existsSync(p)) unlinkSync(p);
}

const okFix = {
  data: { fixedHtml: '<img alt="x">', explanation: 'add alt', effort: 'low' as const },
  model: 'm', provider: 'p', attempts: 1,
};

describe('generate-fix credit metering (Phase 80)', () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  let db: SqliteAdapter;
  let token: string;

  beforeAll(async () => {
    cleanup();
    db = new SqliteAdapter(TEST_DB);
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const signToken = await createTokenSigner(await exportPKCS8(privateKey));
    const verifyToken = await createTokenVerifier(await exportSPKI(publicKey));
    app = await createServer({ db, signToken, verifyToken, tokenExpiry: '1h', logger: false });
    await app.ready();
    token = await signToken({ sub: 'u', scopes: ['read', 'write', 'admin'], expiresIn: '1h' });
  });

  afterAll(async () => { await app.close(); cleanup(); });
  beforeEach(() => { mockGenerateFix.mockReset(); });

  const post = (orgId?: string) => app.inject({
    method: 'POST',
    url: '/api/v1/generate-fix',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      wcagCriterion: '1.1.1',
      issueMessage: 'Missing alt text',
      htmlContext: '<img>',
      ...(orgId ? { orgId } : {}),
    },
  });

  it('charges one credit on a successful metered fix and reports remaining', async () => {
    mockGenerateFix.mockResolvedValue(okFix);
    await db.setCreditAllocation('org-meter', 5, 'admin');
    const res = await post('org-meter');
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-luqen-credits-remaining']).toBe('4');
    expect((await db.getCreditBalance('org-meter')).balance).toBe(4);
  });

  it('does not charge for a failed fix', async () => {
    mockGenerateFix.mockRejectedValue(new Error('boom'));
    await db.setCreditAllocation('org-fail', 5, 'admin');
    const res = await post('org-fail');
    expect(res.statusCode).toBe(502);
    expect((await db.getCreditBalance('org-fail')).balance).toBe(5);
  });

  it('gates with 402 when credits are exhausted and never calls the LLM', async () => {
    mockGenerateFix.mockResolvedValue(okFix);
    await db.setCreditAllocation('org-empty', 0, 'admin');
    const res = await post('org-empty');
    expect(res.statusCode).toBe(402);
    expect(res.json().creditsExhausted).toBe(true);
    expect(res.headers['x-luqen-credits-remaining']).toBe('0');
    expect(mockGenerateFix).not.toHaveBeenCalled();
  });

  it('leaves system/unscoped calls unmetered', async () => {
    mockGenerateFix.mockResolvedValue(okFix);
    // No orgId in body and the token has no orgId binding → resolves to 'system'.
    const res = await post();
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-luqen-credits-remaining']).toBeUndefined();
  });
});
