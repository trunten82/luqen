import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import type { MarkIssueDismissalInput } from '../../src/db/interfaces/issue-dismissal-repository.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

// D-10: org + site-key isolation of the dismissal store.

let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-issue-dismissal-iso-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

const KEY_1 = 'https://example.com/dev/en-us';
const KEY_2 = 'https://example.com/dev/it-it';

function input(overrides: Partial<MarkIssueDismissalInput> = {}): MarkIssueDismissalInput {
  return {
    orgId: 'org-a',
    siteUrl: `${KEY_1}/`,
    siteKey: KEY_1,
    code: 'WCAG2AA.1_4_3',
    selector: '#hero > p',
    reason: 'Hidden copy',
    actor: 'alice',
    actorId: 'u-1',
    ...overrides,
  };
}

async function markCreated(overrides: Partial<MarkIssueDismissalInput> = {}): Promise<string> {
  const r = await storage.issueDismissals!.mark(input(overrides));
  if (r.kind !== 'created') throw new Error('expected created');
  return r.dismissal.id;
}

describe('IssueDismissalRepository isolation (D-10)', () => {
  it("listActiveForSite never returns another org's dismissal for the same site key", async () => {
    const aId = await markCreated({ orgId: 'org-a' });
    await markCreated({ orgId: 'org-b' });

    const list = await storage.issueDismissals!.listActiveForSite('org-a', KEY_1);

    expect(list.map((d) => d.id)).toEqual([aId]);
    expect(list.every((d) => d.orgId === 'org-a')).toBe(true);
  });

  it('listActiveForSite never returns a dismissal for another site key of the same org', async () => {
    const id1 = await markCreated({ siteKey: KEY_1 });
    await markCreated({ siteKey: KEY_2, siteUrl: `${KEY_2}/` });

    const list = await storage.issueDismissals!.listActiveForSite('org-a', KEY_1);

    expect(list.map((d) => d.id)).toEqual([id1]);
    expect(list.every((d) => d.siteKey === KEY_1)).toBe(true);
  });

  it("listForSite never returns another org's dismissal for the same site key", async () => {
    const aId = await markCreated({ orgId: 'org-a' });
    const bId = await markCreated({ orgId: 'org-b' });
    await storage.issueDismissals!.revoke({ id: bId, orgId: 'org-b', actor: 'bob', comment: null });

    const list = await storage.issueDismissals!.listForSite('org-a', KEY_1);

    expect(list.map((d) => d.id)).toEqual([aId]);
    expect(list.every((d) => d.orgId === 'org-a')).toBe(true);
  });

  it('listForSite never returns a dismissal for another site key of the same org', async () => {
    const id1 = await markCreated({ siteKey: KEY_1 });
    const id2 = await markCreated({ siteKey: KEY_2, siteUrl: `${KEY_2}/` });
    await storage.issueDismissals!.revoke({ id: id2, orgId: 'org-a', actor: 'bob', comment: null });

    const list = await storage.issueDismissals!.listForSite('org-a', KEY_1);

    expect(list.map((d) => d.id)).toEqual([id1]);
    expect(list.every((d) => d.siteKey === KEY_1)).toBe(true);
  });

  it('two orgs can each hold an active dismissal for the same site, code and selector', async () => {
    const a = await storage.issueDismissals!.mark(input({ orgId: 'org-a' }));
    const b = await storage.issueDismissals!.mark(input({ orgId: 'org-b' }));

    expect(a.kind).toBe('created');
    expect(b.kind).toBe('created');
    if (a.kind !== 'created' || b.kind !== 'created') throw new Error('unreachable');
    expect(a.dismissal.id).not.toBe(b.dismissal.id);
  });

  it("revoke never touches another org's dismissal", async () => {
    const aId = await markCreated({ orgId: 'org-a' });

    const result = await storage.issueDismissals!.revoke({
      id: aId,
      orgId: 'org-b',
      actor: 'mallory',
      comment: 'nope',
    });

    expect(result.kind).toBe('not-found');
    const still = await storage.issueDismissals!.getById(aId);
    expect(still?.status).toBe('active');
    expect(still?.revokedBy).toBeNull();
    expect(await storage.issueDismissals!.listEvents(aId)).toHaveLength(1);
    const audit = await storage.audit.query({ resourceType: 'issue_dismissal', action: 'issue_dismissal.revoke' });
    expect(audit.total).toBe(0);
  });
});
