/**
 * Phase 63.1 — Aggregator webhook delivery service tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { deliverAggregatorEvent } from '../../src/services/aggregator-webhook-delivery.js';
import { randomUUID, createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
vi.stubGlobal('fetch', fetchSpy);

let storage: SqliteStorageAdapter;
let dbPath: string;
let orgId: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-awd-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const org = await storage.organizations.createOrg({ name: 'o', slug: 'o' });
  orgId = org.id;
  fetchSpy.mockClear();
  fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('deliverAggregatorEvent', () => {
  it('signs the body with HMAC-SHA256 when a secret is set', async () => {
    await storage.orgAggregatorWebhooks.create({
      orgId,
      url: 'https://example.com/hook',
      secret: 'topsecret',
    });

    await deliverAggregatorEvent(storage, orgId, 'coordinated_pr.created', {
      coordinated_pr_id: 'cpr_1',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    const url = call[0] as string;
    const init = call[1] as RequestInit;
    expect(url).toBe('https://example.com/hook');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Luqen-Event']).toBe('coordinated_pr.created');
    expect(headers['Content-Type']).toBe('application/json');
    const expectedSig = createHmac('sha256', 'topsecret')
      .update(init.body as string)
      .digest('hex');
    expect(headers['Luqen-Signature']).toBe(`sha256=${expectedSig}`);
  });

  it('omits Luqen-Signature when no secret', async () => {
    await storage.orgAggregatorWebhooks.create({
      orgId,
      url: 'https://example.com/hook',
    });
    await deliverAggregatorEvent(storage, orgId, 'coordinated_pr.rolled_back', {
      coordinated_pr_id: 'cpr_1',
    });
    const headers = fetchSpy.mock.calls[0][1] as { headers: Record<string, string> };
    expect(headers.headers['Luqen-Signature']).toBeUndefined();
  });

  it('fans out to multiple subscribers', async () => {
    await storage.orgAggregatorWebhooks.create({ orgId, url: 'https://a.example/h' });
    await storage.orgAggregatorWebhooks.create({ orgId, url: 'https://b.example/h' });
    await storage.orgAggregatorWebhooks.create({ orgId, url: 'https://c.example/h' });
    await deliverAggregatorEvent(storage, orgId, 'coordinated_pr.leg.opened', {});
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const calledUrls = fetchSpy.mock.calls.map((c) => c[0] as string).sort();
    expect(calledUrls).toEqual([
      'https://a.example/h',
      'https://b.example/h',
      'https://c.example/h',
    ]);
  });

  it('swallows fetch errors so callers never throw', async () => {
    await storage.orgAggregatorWebhooks.create({ orgId, url: 'https://oops/' });
    fetchSpy.mockRejectedValueOnce(new Error('network down'));
    const warned: string[] = [];
    const logger = { warn: (msg: string) => warned.push(msg) };
    await expect(
      deliverAggregatorEvent(
        storage,
        orgId,
        'coordinated_pr.created',
        {},
        logger,
      ),
    ).resolves.toBeUndefined();
    expect(warned.length).toBe(1);
    expect(warned[0]).toContain('aggregator webhook delivery failed');
  });

  it('skips dispatch entirely when no subscribers', async () => {
    await deliverAggregatorEvent(storage, orgId, 'coordinated_pr.created', {});
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
