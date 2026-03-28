import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp } from './helpers.js';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'));

describe('GET /api/v1/health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 without any auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(body.version).toBe(pkg.version);
    expect(typeof body.timestamp).toBe('string');
  });

  it('returns correct content type', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(response.headers['content-type']).toMatch(/application\/json/);
  });
});
