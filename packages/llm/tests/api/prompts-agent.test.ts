import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';
import { buildExtractionPrompt } from '../../src/prompts/extract-requirements.js';

const TEST_DB = '/tmp/llm-prompts-agent-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

// Valid override for extract-requirements that preserves locked segments
const EXTRACT_DEFAULT = buildExtractionPrompt(
  '{content}',
  { regulationId: '{regulationId}', regulationName: '{regulationName}' },
);
const VALID_EXTRACT_OVERRIDE = 'My custom template note.\n' + EXTRACT_DEFAULT;

describe('Prompt Override API — agent-system (D-14 refuses per-org override writes)', () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  let db: SqliteAdapter;
  let adminToken: string;

  beforeAll(async () => {
    cleanup();
    db = new SqliteAdapter(TEST_DB);
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const privateKeyPem = await exportPKCS8(privateKey);
    const publicKeyPem = await exportSPKI(publicKey);

    const signToken = await createTokenSigner(privateKeyPem);
    const verifyToken = await createTokenVerifier(publicKeyPem);

    app = await createServer({
      db,
      signToken,
      verifyToken,
      tokenExpiry: '1h',
      logger: false,
    });

    await app.ready();

    adminToken = await signToken({
      sub: 'test-admin',
      scopes: ['read', 'write', 'admin'],
      expiresIn: '1h',
    });
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  // Test 11 — per-org PUT of agent-system is rejected with 400
  it('PUT /api/v1/prompts/agent-system with orgId returns 400 and does NOT mutate DB', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/prompts/agent-system',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        template: 'any-template-with-locked-fences',
        orgId: 'org-1',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string; capability?: string }>();
    expect(body.error.toLowerCase()).toContain('agent-system');
    expect(body.error.toLowerCase()).toContain('per-org');

    // Read-back confirms no mutation — no org-specific override exists
    const stored = await db.getPromptOverride(
      'agent-system' as unknown as Parameters<typeof db.getPromptOverride>[0],
      'org-1',
    );
    expect(stored).toBeUndefined();
  });

  // Test 12 — global PUT of agent-system (no orgId) is allowed
  it('PUT /api/v1/prompts/agent-system with NO orgId accepts valid body (global override)', async () => {
    // Must include all three locked fences for validateOverride to accept
    const validAgentTemplate = [
      'You are {agentDisplayName}, a Luqen assistant.',
      '',
      '<!-- LOCKED:rbac -->',
      "You have access ONLY to the tools listed in this turn's tool manifest.",
      'Never claim a capability that is not in the manifest. If asked to do',
      "something outside the manifest, tell the user what tools you have and",
      "ask how they'd like to proceed.",
      '<!-- /LOCKED:rbac -->',
      '',
      '<!-- LOCKED:confirmation -->',
      'Tools marked destructive will be paused for user confirmation before',
      'running. Call the tool normally — the platform handles the pause. Do',
      'NOT ask the user to confirm in chat before calling the tool; that',
      'creates a double-confirmation experience.',
      '<!-- /LOCKED:confirmation -->',
      '',
      '<!-- LOCKED:honesty -->',
      'Never invent IDs, UUIDs, scan IDs, report IDs, dates, counts, or any',
      'other artefact that would normally come from a tool result. If you do',
      'not have a tool to perform the requested action, or the required tool',
      "is not in this turn's manifest, say so plainly and list the tools you",
      'do have. If a tool returns an error, do not invent results — report',
      'the error and offer to try a different approach. Only state that an',
      'action was performed when a tool actually returned a successful result',
      'in this turn.',
      '<!-- /LOCKED:honesty -->',
    ].join('\n');

    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/prompts/agent-system',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { template: validAgentTemplate },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ capability: string; isOverride: boolean }>();
    expect(body.capability).toBe('agent-system');
    expect(body.isOverride).toBe(true);
  });

  // Test 13 — per-org PUT of OTHER capabilities (extract-requirements) still works
  it('PUT /api/v1/prompts/extract-requirements with orgId still accepts valid body', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/prompts/extract-requirements',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        template: VALID_EXTRACT_OVERRIDE,
        orgId: 'org-1',
      },
    });

    expect(res.statusCode).toBe(200);
  });

  // Test 14 — GET /agent-system returns the default template with all three fences
  it('GET /api/v1/prompts/agent-system returns default template containing all three LOCKED fences', async () => {
    // Clear the global override from Test 12 so we really get the default
    await db.deletePromptOverride(
      'agent-system' as unknown as Parameters<typeof db.deletePromptOverride>[0],
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/prompts/agent-system',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ capability: string; template: string; isOverride: boolean }>();
    expect(body.capability).toBe('agent-system');
    expect(body.isOverride).toBe(false);
    expect(body.template).toContain('<!-- LOCKED:rbac -->');
    expect(body.template).toContain('<!-- LOCKED:confirmation -->');
    expect(body.template).toContain('<!-- LOCKED:honesty -->');
    expect(body.template).toContain('{agentDisplayName}');
  });
});
