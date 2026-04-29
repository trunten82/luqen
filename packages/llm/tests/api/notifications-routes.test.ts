import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { createTokenSigner, createTokenVerifier } from '../../src/auth/oauth.js';
import { createServer } from '../../src/api/server.js';

vi.mock('../../src/capabilities/generate-notification-content.js', () => ({
  executeGenerateNotificationContent: vi.fn(),
}));

import { executeGenerateNotificationContent } from '../../src/capabilities/generate-notification-content.js';

const mockExec = vi.mocked(executeGenerateNotificationContent);

const TEST_DB = '/tmp/llm-notif-routes-test.db';

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

describe('POST /api/v1/generate-notification-content', () => {
  let app: Awaited<ReturnType<typeof createServer>>;
  let token: string;

  beforeAll(async () => {
    cleanup();
    const db = new SqliteAdapter(TEST_DB);
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const signToken = await createTokenSigner(await exportPKCS8(privateKey));
    const verifyToken = await createTokenVerifier(await exportSPKI(publicKey));

    app = await createServer({ db, signToken, verifyToken, tokenExpiry: '1h', logger: false });
    await app.ready();
    token = await signToken({ sub: 'test', scopes: ['read'], expiresIn: '1h' });
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  it('returns 400 when template is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/generate-notification-content',
      headers: { authorization: `Bearer ${token}` },
      payload: { channel: 'email', outputFormat: 'both', eventData: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when channel is invalid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/generate-notification-content',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        template: { subject: 's', body: 'b' },
        channel: 'sms',
        outputFormat: 'both',
        eventData: {},
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when outputFormat is invalid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/generate-notification-content',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        template: { subject: 's', body: 'b' },
        channel: 'email',
        outputFormat: 'wrong',
        eventData: {},
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns generated subject/body on happy path', async () => {
    mockExec.mockResolvedValueOnce({
      subject: 'GEN SUBJ',
      body: 'GEN BODY',
      model: 'Llama 3.2',
      provider: 'Test Ollama',
      latencyMs: 42,
      tokensIn: 10,
      tokensOut: 30,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/generate-notification-content',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        template: { subject: 's', body: 'b' },
        channel: 'email',
        outputFormat: 'both',
        eventData: { site: 'example.com' },
      },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.subject).toBe('GEN SUBJ');
    expect(json.body).toBe('GEN BODY');
    expect(json.model).toBe('Llama 3.2');
    expect(json.fallback).toBe(false);
  });

  it('returns { fallback: true } when capability returns null', async () => {
    mockExec.mockResolvedValueOnce(null);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/generate-notification-content',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        template: { subject: 's', body: 'b' },
        channel: 'slack',
        outputFormat: 'body',
        eventData: {},
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().fallback).toBe(true);
  });

  it('returns { fallback: true } when capability throws', async () => {
    mockExec.mockRejectedValueOnce(new Error('boom'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/generate-notification-content',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        template: { subject: 's', body: 'b' },
        channel: 'teams',
        outputFormat: 'both',
        eventData: {},
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().fallback).toBe(true);
  });

  it('rejects without auth token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/generate-notification-content',
      payload: {
        template: { subject: 's', body: 'b' },
        channel: 'email',
        outputFormat: 'both',
        eventData: {},
      },
    });
    expect(res.statusCode).toBe(401);
  });
});
