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
