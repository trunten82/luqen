/**
 * Phase 80 — Credit repository: opt-in metering, atomic consume, ledger.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;
let orgId: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-credits-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  const o = await storage.organizations.createOrg({ name: 'credit_org', slug: 'credit_org' });
  orgId = o.id;
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('default = unlimited (opt-in metering)', () => {
  it('getPlan returns unlimited for an org with no row', async () => {
    const plan = await storage.credits.getPlan(orgId);
    expect(plan.unlimited).toBe(true);
    expect(plan.balance).toBeNull();
    expect(plan.plan).toBe('free');
  });

  it('check allows by default', async () => {
    const c = await storage.credits.check(orgId);
    expect(c.allowed).toBe(true);
    expect(c.unlimited).toBe(true);
  });

  it('consume is a no-op on unlimited orgs (always allowed, no decrement)', async () => {
    const r = await storage.credits.consume(orgId, 1, 'generate-fix', 'u1');
    expect(r.allowed).toBe(true);
    expect(r.unlimited).toBe(true);
    expect(r.balanceAfter).toBeNull();
  });
});

describe('metered orgs', () => {
  it('setAllocation turns metering on and balance = allocated - used', async () => {
    const plan = await storage.credits.setAllocation(orgId, 3, 'admin');
    expect(plan.unlimited).toBe(false);
    expect(plan.allocated).toBe(3);
    expect(plan.balance).toBe(3);
  });

  it('consume decrements and gates at zero', async () => {
    await storage.credits.setAllocation(orgId, 2, 'admin');
    const a = await storage.credits.consume(orgId, 1, 'generate-fix', 'u1');
    expect(a).toMatchObject({ allowed: true, unlimited: false, balanceAfter: 1 });
    const b = await storage.credits.consume(orgId, 1, 'generate-fix', 'u1');
    expect(b).toMatchObject({ allowed: true, balanceAfter: 0 });
    const c = await storage.credits.consume(orgId, 1, 'generate-fix', 'u1');
    expect(c.allowed).toBe(false);
    expect(c.balanceAfter).toBe(0);
    // check() agrees the org is now exhausted
    expect((await storage.credits.check(orgId)).allowed).toBe(false);
  });

  it('topUp increases allocation and restores balance', async () => {
    await storage.credits.setAllocation(orgId, 1, 'admin');
    await storage.credits.consume(orgId, 1, 'generate-fix', 'u1');
    expect((await storage.credits.check(orgId)).allowed).toBe(false);
    const plan = await storage.credits.topUp(orgId, 5, 'admin');
    expect(plan.balance).toBe(5);
    expect((await storage.credits.check(orgId)).allowed).toBe(true);
  });

  it('setAllocation(null) reverts to unlimited', async () => {
    await storage.credits.setAllocation(orgId, 0, 'admin');
    expect((await storage.credits.check(orgId)).allowed).toBe(false);
    const plan = await storage.credits.setAllocation(orgId, null, 'admin');
    expect(plan.unlimited).toBe(true);
    expect((await storage.credits.check(orgId)).allowed).toBe(true);
  });

  it('setPlan changes the tier without touching the balance', async () => {
    await storage.credits.setAllocation(orgId, 10, 'admin');
    const plan = await storage.credits.setPlan(orgId, 'agency', 'admin');
    expect(plan.plan).toBe('agency');
    expect(plan.balance).toBe(10);
  });
});

describe('ledger', () => {
  it('records allocations and consumption newest-first', async () => {
    await storage.credits.setAllocation(orgId, 5, 'admin');
    await storage.credits.consume(orgId, 1, 'generate-fix', 'u1');
    await storage.credits.topUp(orgId, 2, 'admin');
    const ledger = await storage.credits.getLedger(orgId);
    expect(ledger.length).toBe(3);
    // newest first: topup (+2), then consume (-1), then set (+5)
    expect(ledger[0].reason).toBe('admin.topup');
    expect(ledger[0].delta).toBe(2);
    const consumeEntry = ledger.find((e) => e.reason === 'generate-fix');
    expect(consumeEntry?.delta).toBe(-1);
    expect(consumeEntry?.balanceAfter).toBe(4);
  });
});
