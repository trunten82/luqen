import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import type { MarkIssueDismissalInput } from '../../src/db/interfaces/issue-dismissal-repository.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-issue-dismissal-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

const SITE_URL = 'https://Example.com/dev/en-us/';
const SITE_KEY = 'https://example.com/dev/en-us';

function markInput(overrides: Partial<MarkIssueDismissalInput> = {}): MarkIssueDismissalInput {
  return {
    orgId: 'org-a',
    siteUrl: SITE_URL,
    siteKey: SITE_KEY,
    code: 'WCAG2AA.1_4_3',
    selector: '#hero > p',
    reason: 'Contrast is computed on a hidden noscript copy',
    actor: 'alice',
    actorId: 'u-1',
    ...overrides,
  };
}

function count(table: string): number {
  const row = storage.getRawDatabase().prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
  return row.c;
}

describe('IssueDismissalRepository - migration 090', () => {
  it('records migration 090 and creates the partial unique index', () => {
    const db = storage.getRawDatabase();
    const applied = db.prepare("SELECT id FROM schema_migrations WHERE id = '090'").get();
    expect(applied).toBeTruthy();

    const indexes = db.prepare("PRAGMA index_list('issue_dismissals')").all() as Array<{
      name: string;
      unique: number;
      partial: number;
    }>;
    const active = indexes.find((i) => i.name === 'uq_issue_dismissals_active_key');
    expect(active).toBeDefined();
    expect(active?.unique).toBe(1);
    expect(active?.partial).toBe(1);
  });
});

describe('IssueDismissalRepository - mark', () => {
  it('creates an active dismissal storing raw site url and site key as given', async () => {
    const result = await storage.issueDismissals!.mark(markInput());

    expect(result.kind).toBe('created');
    if (result.kind !== 'created') throw new Error('unreachable');
    const d = result.dismissal;
    expect(d.status).toBe('active');
    expect(d.orgId).toBe('org-a');
    expect(d.siteUrl).toBe(SITE_URL);
    expect(d.siteKey).toBe(SITE_KEY);
    expect(d.code).toBe('WCAG2AA.1_4_3');
    expect(d.selector).toBe('#hero > p');
    expect(d.reason).toBe('Contrast is computed on a hidden noscript copy');
    expect(d.createdBy).toBe('alice');
    expect(d.createdById).toBe('u-1');
    expect(Number.isNaN(Date.parse(d.createdAt))).toBe(false);
    expect(new Date(d.createdAt).toISOString()).toBe(d.createdAt);
    expect(d.revokedBy).toBeNull();
    expect(d.revokedById).toBeNull();
    expect(d.revokedAt).toBeNull();
    expect(d.revokeComment).toBeNull();
  });

  it('is readable back through listActiveForSite, listEvents and the audit log', async () => {
    const result = await storage.issueDismissals!.mark(markInput());
    if (result.kind !== 'created') throw new Error('expected created');
    const id = result.dismissal.id;

    const active = await storage.issueDismissals!.listActiveForSite('org-a', SITE_KEY);
    expect(active).toHaveLength(1);
    expect(active[0]).toEqual(result.dismissal);

    const events = await storage.issueDismissals!.listEvents(id);
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('mark');
    expect(events[0].actor).toBe('alice');
    expect(events[0].actorId).toBe('u-1');
    expect(events[0].orgId).toBe('org-a');
    expect(events[0].dismissalId).toBe(id);
    expect(events[0].text).toBe('Contrast is computed on a hidden noscript copy');
    expect(events[0].at).toBe(result.dismissal.createdAt);

    const audit = await storage.audit.query({ resourceType: 'issue_dismissal' });
    expect(audit.total).toBe(1);
    expect(audit.entries[0].action).toBe('issue_dismissal.mark');
    expect(audit.entries[0].resourceId).toBe(id);
    expect(audit.entries[0].orgId).toBe('org-a');
    expect(audit.entries[0].actor).toBe('alice');
    const details = JSON.parse(String(audit.entries[0].details)) as Record<string, unknown>;
    expect(details).toEqual({
      siteUrl: SITE_URL,
      code: 'WCAG2AA.1_4_3',
      selector: '#hero > p',
      reason: 'Contrast is computed on a hidden noscript copy',
    });
  });

  it('persists nothing when the audit insert fails (atomic)', async () => {
    const db = storage.getRawDatabase();
    db.exec(
      `CREATE TRIGGER t BEFORE INSERT ON audit_log WHEN NEW.resource_type = 'issue_dismissal'
       BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`,
    );

    await expect(storage.issueDismissals!.mark(markInput())).rejects.toThrow(/audit unavailable/);

    expect(count('issue_dismissals')).toBe(0);
    expect(count('issue_dismissal_events')).toBe(0);
  });
});

describe('IssueDismissalRepository - conflict', () => {
  it('returns a conflict carrying the existing dismissal on re-mark of an active key', async () => {
    const first = await storage.issueDismissals!.mark(markInput());
    if (first.kind !== 'created') throw new Error('expected created');

    const second = await storage.issueDismissals!.mark(markInput({ actor: 'carol', reason: 'Other reason' }));

    expect(second.kind).toBe('conflict');
    if (second.kind !== 'conflict') throw new Error('unreachable');
    expect(second.existing.id).toBe(first.dismissal.id);
    expect(count('issue_dismissals')).toBe(1);
    expect(await storage.issueDismissals!.listEvents(first.dismissal.id)).toHaveLength(1);
    const audit = await storage.audit.query({ resourceType: 'issue_dismissal' });
    expect(audit.total).toBe(1);
  });
});

describe('IssueDismissalRepository - revoke', () => {
  async function markOne(): Promise<string> {
    const r = await storage.issueDismissals!.mark(markInput());
    if (r.kind !== 'created') throw new Error('expected created');
    return r.dismissal.id;
  }

  it('revokes, keeps the row, records revoker and comment, appends event and audit row', async () => {
    const id = await markOne();

    const result = await storage.issueDismissals!.revoke({
      id,
      orgId: 'org-a',
      actor: 'bob',
      actorId: 'u-2',
      comment: 'Fixed upstream',
    });

    expect(result.kind).toBe('revoked');
    if (result.kind !== 'revoked') throw new Error('unreachable');
    expect(result.dismissal.status).toBe('revoked');
    expect(result.dismissal.revokedBy).toBe('bob');
    expect(result.dismissal.revokedById).toBe('u-2');
    expect(result.dismissal.revokedAt).toBeTruthy();
    expect(result.dismissal.revokeComment).toBe('Fixed upstream');
    expect(count('issue_dismissals')).toBe(1);

    const events = await storage.issueDismissals!.listEvents(id);
    expect(events.map((e) => e.action)).toEqual(['mark', 'revoke']);
    expect(events[1].actor).toBe('bob');
    expect(events[1].actorId).toBe('u-2');
    expect(events[1].text).toBe('Fixed upstream');

    const audit = await storage.audit.query({ resourceType: 'issue_dismissal', action: 'issue_dismissal.revoke' });
    expect(audit.total).toBe(1);
    expect(audit.entries[0].resourceId).toBe(id);
    expect(audit.entries[0].orgId).toBe('org-a');
    const details = JSON.parse(String(audit.entries[0].details)) as Record<string, unknown>;
    expect(details).toEqual({
      siteUrl: SITE_URL,
      code: 'WCAG2AA.1_4_3',
      selector: '#hero > p',
      comment: 'Fixed upstream',
    });
  });

  it('stores a null comment as null', async () => {
    const id = await markOne();
    const result = await storage.issueDismissals!.revoke({ id, orgId: 'org-a', actor: 'bob', comment: null });
    if (result.kind !== 'revoked') throw new Error('expected revoked');
    expect(result.dismissal.revokeComment).toBeNull();
    expect(result.dismissal.revokedById).toBeNull();
    const events = await storage.issueDismissals!.listEvents(id);
    expect(events[1].text).toBeNull();
  });

  it('second revoke returns already-revoked and writes no event or audit row', async () => {
    const id = await markOne();
    await storage.issueDismissals!.revoke({ id, orgId: 'org-a', actor: 'bob', comment: null });

    const again = await storage.issueDismissals!.revoke({ id, orgId: 'org-a', actor: 'dave', comment: 'late' });

    expect(again.kind).toBe('already-revoked');
    if (again.kind !== 'already-revoked') throw new Error('unreachable');
    expect(again.dismissal.revokedBy).toBe('bob');
    expect(await storage.issueDismissals!.listEvents(id)).toHaveLength(2);
    const audit = await storage.audit.query({ resourceType: 'issue_dismissal' });
    expect(audit.total).toBe(2);
  });

  it('returns not-found for an unknown id', async () => {
    const result = await storage.issueDismissals!.revoke({
      id: randomUUID(),
      orgId: 'org-a',
      actor: 'bob',
      comment: null,
    });
    expect(result.kind).toBe('not-found');
    expect(count('issue_dismissal_events')).toBe(0);
  });

  it('persists no state change when the revoke audit insert fails (atomic)', async () => {
    const id = await markOne();
    storage.getRawDatabase().exec(
      `CREATE TRIGGER t2 BEFORE INSERT ON audit_log WHEN NEW.action = 'issue_dismissal.revoke'
       BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`,
    );

    await expect(
      storage.issueDismissals!.revoke({ id, orgId: 'org-a', actor: 'bob', comment: null }),
    ).rejects.toThrow(/audit unavailable/);

    const still = await storage.issueDismissals!.getById(id);
    expect(still?.status).toBe('active');
    expect(await storage.issueDismissals!.listEvents(id)).toHaveLength(1);
  });

  it('allows re-marking after revoke and keeps both rows in history, newest first', async () => {
    const firstId = await markOne();
    await storage.issueDismissals!.revoke({ id: firstId, orgId: 'org-a', actor: 'bob', comment: null });

    const again = await storage.issueDismissals!.mark(markInput({ actor: 'erin' }));
    expect(again.kind).toBe('created');
    if (again.kind !== 'created') throw new Error('unreachable');
    expect(again.dismissal.id).not.toBe(firstId);

    const all = await storage.issueDismissals!.listForSite('org-a', SITE_KEY);
    expect(all).toHaveLength(2);
    expect(all.map((d) => d.status).sort()).toEqual(['active', 'revoked']);
    expect(all[0].createdAt >= all[1].createdAt).toBe(true);

    const active = await storage.issueDismissals!.listActiveForSite('org-a', SITE_KEY);
    expect(active.map((d) => d.id)).toEqual([again.dismissal.id]);
  });
});

describe('IssueDismissalRepository - getById', () => {
  it('returns the record, or null when absent', async () => {
    const r = await storage.issueDismissals!.mark(markInput());
    if (r.kind !== 'created') throw new Error('expected created');

    expect(await storage.issueDismissals!.getById(r.dismissal.id)).toEqual(r.dismissal);
    expect(await storage.issueDismissals!.getById(randomUUID())).toBeNull();
  });
});

describe('IssueDismissalRepository - append-only surface', () => {
  it('exposes no update or delete method', () => {
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(storage.issueDismissals));
    expect(methods.filter((m) => /^(update|delete|remove|destroy)/i.test(m))).toEqual([]);
  });
});
