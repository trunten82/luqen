import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import { defaultFreeCredits } from '../../src/db/adapter.js';

describe('credit ledger (Phase 80)', () => {
  let dbPath: string;
  let db: SqliteAdapter;

  beforeEach(async () => {
    dbPath = join(tmpdir(), `luqen-credits-${randomUUID()}.db`);
    db = new SqliteAdapter(dbPath);
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
    for (const p of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it('reports the default free allocation for an unknown org', async () => {
    const bal = await db.getCreditBalance('org-new');
    expect(bal.allocated).toBe(defaultFreeCredits());
    expect(bal.used).toBe(0);
    expect(bal.balance).toBe(defaultFreeCredits());
  });

  it('set allocation grants an absolute amount and resets usage', async () => {
    await db.consumeCredit('org-a', 3, 'generate-fix');
    const bal = await db.setCreditAllocation('org-a', 100, 'admin');
    expect(bal.allocated).toBe(100);
    expect(bal.used).toBe(0);
    expect(bal.balance).toBe(100);
  });

  it('consumes credits and decrements the balance', async () => {
    await db.setCreditAllocation('org-b', 5, 'admin');
    const r1 = await db.consumeCredit('org-b', 1, 'generate-fix');
    expect(r1.ok).toBe(true);
    expect(r1.balance.balance).toBe(4);
    expect(r1.balance.used).toBe(1);
    const r2 = await db.consumeCredit('org-b', 2, 'generate-fix');
    expect(r2.ok).toBe(true);
    expect(r2.balance.balance).toBe(2);
  });

  it('refuses to consume past zero and leaves state unchanged', async () => {
    await db.setCreditAllocation('org-c', 2, 'admin');
    expect((await db.consumeCredit('org-c', 2, 'generate-fix')).ok).toBe(true);
    const exhausted = await db.consumeCredit('org-c', 1, 'generate-fix');
    expect(exhausted.ok).toBe(false);
    expect(exhausted.balance.balance).toBe(0);
    // used must not have advanced past the allocation.
    const bal = await db.getCreditBalance('org-c');
    expect(bal.used).toBe(2);
  });

  it('top-up raises the allocation without resetting usage', async () => {
    await db.setCreditAllocation('org-d', 5, 'admin');
    await db.consumeCredit('org-d', 4, 'generate-fix');
    const bal = await db.addCredits('org-d', 10, 'admin', 'topup');
    expect(bal.allocated).toBe(15);
    expect(bal.used).toBe(4);
    expect(bal.balance).toBe(11);
  });

  it('writes an append-only ledger for grants, top-ups and consumption', async () => {
    await db.setCreditAllocation('org-e', 10, 'admin');
    await db.consumeCredit('org-e', 1, 'generate-fix');
    await db.addCredits('org-e', 5, 'admin', 'topup');
    const ledger = await db.listCreditLedger('org-e', 10);
    expect(ledger.length).toBe(3);
    // Newest first.
    expect(ledger[0].reason).toBe('topup');
    expect(ledger[0].delta).toBe(5);
    const consume = ledger.find((e) => e.reason === 'generate-fix');
    expect(consume?.delta).toBe(-1);
    expect(consume?.balanceAfter).toBe(9);
  });

  it('a new org can consume its default free credits without an explicit grant', async () => {
    const r = await db.consumeCredit('org-f', 1, 'generate-fix');
    expect(r.ok).toBe(true);
    expect(r.balance.allocated).toBe(defaultFreeCredits());
    expect(r.balance.balance).toBe(defaultFreeCredits() - 1);
  });
});
