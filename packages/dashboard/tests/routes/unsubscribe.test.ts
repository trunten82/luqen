/**
 * Phase 71 — Public unsubscribe route.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { unsubscribeRoutes } from '../../src/routes/unsubscribe.js';
import {
  mintUnsubscribeToken,
  CHANNEL_EMAIL_REPORTS,
} from '../../src/notifications/unsubscribe-token.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let app: FastifyInstance;
let storage: SqliteStorageAdapter;
let dbPath: string;

beforeAll(() => {
  process.env['UNSUBSCRIBE_SECRET'] = 'route-test-secret';
});

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-unsub-route-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  app = Fastify();
  await unsubscribeRoutes(app, storage);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('GET /u/:token', () => {
  it('returns 200 + confirmation page and persists the unsubscribe', async () => {
    const token = mintUnsubscribeToken({
      recipient: 'alice@example.com',
      channel: CHANNEL_EMAIL_REPORTS,
      orgId: 'org-1',
    });
    const res = await app.inject({ method: 'GET', url: `/u/${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('unsubscribed');
    expect(res.body).toContain('alice@example.com');

    const persisted = await storage.notificationUnsubscribes.isUnsubscribed(
      'alice@example.com',
      CHANNEL_EMAIL_REPORTS,
      'org-1',
    );
    expect(persisted).toBe(true);
  });

  it('is idempotent (second click stays unsubscribed, still 200)', async () => {
    const token = mintUnsubscribeToken({
      recipient: 'alice@example.com',
      channel: CHANNEL_EMAIL_REPORTS,
      orgId: 'org-1',
    });
    const url = `/u/${token}`;
    const a = await app.inject({ method: 'GET', url });
    const b = await app.inject({ method: 'GET', url });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(
      await storage.notificationUnsubscribes.isUnsubscribed(
        'alice@example.com',
        CHANNEL_EMAIL_REPORTS,
        'org-1',
      ),
    ).toBe(true);
  });

  it('returns 400 + error page for a tampered token', async () => {
    const token = mintUnsubscribeToken({
      recipient: 'alice@example.com',
      channel: CHANNEL_EMAIL_REPORTS,
      orgId: 'org-1',
    });
    const tampered = `${token.slice(0, -8)}AAAAAAAA`;
    const res = await app.inject({
      method: 'GET',
      url: `/u/${encodeURIComponent(tampered)}`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Invalid');
    // No DB write
    expect(
      await storage.notificationUnsubscribes.isUnsubscribed(
        'alice@example.com',
        CHANNEL_EMAIL_REPORTS,
        'org-1',
      ),
    ).toBe(false);
  });
});
