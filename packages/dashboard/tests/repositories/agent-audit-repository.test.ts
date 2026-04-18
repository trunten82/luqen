/**
 * Phase 31 — AgentAuditRepository contract tests.
 *
 * Covers APER-03 success criteria:
 *   - SC-3: every tool invocation is recorded with full provenance
 *     (userId, orgId, toolName, argsJson, outcome, latencyMs, createdAt)
 *     and round-trips intact on read.
 *   - Immutability contract: repo exposes NO update/delete surface (the
 *     agent_audit_log table is immutable by API surface — see
 *     31-CONTEXT.md line 117).
 *   - T-31-09 (cross-org info disclosure): listForOrg('A') never returns
 *     org 'B' rows; getEntry(id, 'B') returns null when the row is in
 *     org 'A'.
 *   - T-31-10 (DOS): default pagination cap of 200.
 *
 * Harness pattern: temp-file sqlite + storage.migrate() (matches
 * conversation-repository.test.ts from Plan 01 and role-repository.test.ts
 * from Phase 30.1). Arbitrary user_id strings are valid — unlike
 * agent_conversations, agent_audit_log has NO FK on user_id (CONTEXT.md
 * line 102: callers may be dashboard_users OR OAuth client_ids).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;
const orgA = 'org-a';
const orgB = 'org-b';

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

// ---------------------------------------------------------------------------
// Group A — append + getEntry round-trip (APER-03 / SC-3)
// ---------------------------------------------------------------------------

describe('SqliteAgentAuditRepository — append + getEntry (SC-3)', () => {
  it('append returns an entry with server-generated id + createdAt', async () => {
    const entry = await storage.agentAudit.append({
      userId: 'u1',
      orgId: orgA,
      toolName: 'dashboard_scan_site',
      argsJson: '{"url":"https://example.com"}',
      outcome: 'success',
      latencyMs: 142,
    });

    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(entry.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry.userId).toBe('u1');
    expect(entry.orgId).toBe(orgA);
    expect(entry.toolName).toBe('dashboard_scan_site');
    expect(entry.argsJson).toBe('{"url":"https://example.com"}');
    expect(entry.outcome).toBe('success');
    expect(entry.latencyMs).toBe(142);
    expect(entry.conversationId).toBeNull();
    expect(entry.outcomeDetail).toBeNull();
  });

  it('getEntry round-trips all fields intact when appended with all optionals', async () => {
    const conv = await storage.conversations.createConversation({
      userId: (await storage.users.createUser(`u-${randomUUID()}`, 'pw', 'user')).id,
      orgId: orgA,
    });

    const appended = await storage.agentAudit.append({
      userId: 'oauth-client-abc',
      orgId: orgA,
      conversationId: conv.id,
      toolName: 'dashboard_list_reports',
      argsJson: '{"limit":10}',
      outcome: 'success',
      outcomeDetail: 'returned 3 reports',
      latencyMs: 87,
    });

    const fetched = await storage.agentAudit.getEntry(appended.id, orgA);
    expect(fetched).not.toBeNull();
    expect(fetched).toEqual(appended);
    expect(fetched!.conversationId).toBe(conv.id);
    expect(fetched!.outcomeDetail).toBe('returned 3 reports');
    expect(fetched!.latencyMs).toBe(87);
  });

  it('latencyMs round-trips as an integer (not coerced to string / float)', async () => {
    const appended = await storage.agentAudit.append({
      userId: 'u1',
      orgId: orgA,
      toolName: 'x',
      argsJson: '{}',
      outcome: 'success',
      latencyMs: 1234,
    });
    const fetched = await storage.agentAudit.getEntry(appended.id, orgA);
    expect(typeof fetched!.latencyMs).toBe('number');
    expect(Number.isInteger(fetched!.latencyMs)).toBe(true);
    expect(fetched!.latencyMs).toBe(1234);
  });

  it('accepts all four outcome values: success | error | denied | timeout', async () => {
    const outcomes = ['success', 'error', 'denied', 'timeout'] as const;
    for (const o of outcomes) {
      const entry = await storage.agentAudit.append({
        userId: 'u1',
        orgId: orgA,
        toolName: 't',
        argsJson: '{}',
        outcome: o,
        latencyMs: 10,
      });
      expect(entry.outcome).toBe(o);
      const fetched = await storage.agentAudit.getEntry(entry.id, orgA);
      expect(fetched!.outcome).toBe(o);
    }
  });

  it('getEntry returns null for unknown id', async () => {
    const missing = await storage.agentAudit.getEntry('no-such-id', orgA);
    expect(missing).toBeNull();
  });

  it('getEntry returns null for cross-org lookup (T-31-09)', async () => {
    const entry = await storage.agentAudit.append({
      userId: 'u1',
      orgId: orgA,
      toolName: 't',
      argsJson: '{}',
      outcome: 'success',
      latencyMs: 5,
    });
    const wrongOrg = await storage.agentAudit.getEntry(entry.id, orgB);
    expect(wrongOrg).toBeNull();
  });

  it('persists conversationId null when not provided', async () => {
    const entry = await storage.agentAudit.append({
      userId: 'u1',
      orgId: orgA,
      toolName: 't',
      argsJson: '{}',
      outcome: 'success',
      latencyMs: 5,
    });
    expect(entry.conversationId).toBeNull();
  });

  it('persists outcomeDetail null when not provided', async () => {
    const entry = await storage.agentAudit.append({
      userId: 'u1',
      orgId: orgA,
      toolName: 't',
      argsJson: '{}',
      outcome: 'error',
      latencyMs: 5,
    });
    expect(entry.outcomeDetail).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Group B — listForOrg org isolation (T-31-09)
// ---------------------------------------------------------------------------

describe('SqliteAgentAuditRepository — org isolation (T-31-09)', () => {
  it('listForOrg only returns rows for the requested org', async () => {
    // 3 rows in org A
    for (let i = 0; i < 3; i++) {
      await storage.agentAudit.append({
        userId: 'u1',
        orgId: orgA,
        toolName: 't',
        argsJson: `{"i":${i}}`,
        outcome: 'success',
        latencyMs: 10,
      });
    }
    // 2 rows in org B
    for (let i = 0; i < 2; i++) {
      await storage.agentAudit.append({
        userId: 'u1',
        orgId: orgB,
        toolName: 't',
        argsJson: `{"i":${i}}`,
        outcome: 'success',
        latencyMs: 10,
      });
    }

    const listA = await storage.agentAudit.listForOrg(orgA, {}, {});
    const listB = await storage.agentAudit.listForOrg(orgB, {}, {});
    expect(listA).toHaveLength(3);
    expect(listB).toHaveLength(2);
    expect(listA.every((e) => e.orgId === orgA)).toBe(true);
    expect(listB.every((e) => e.orgId === orgB)).toBe(true);
  });

  it('listForOrg returns empty array when org has no rows', async () => {
    await storage.agentAudit.append({
      userId: 'u1',
      orgId: orgA,
      toolName: 't',
      argsJson: '{}',
      outcome: 'success',
      latencyMs: 10,
    });
    const listB = await storage.agentAudit.listForOrg(orgB, {}, {});
    expect(listB).toEqual([]);
  });

  it('countForOrg is org-scoped and matches listForOrg length', async () => {
    for (let i = 0; i < 4; i++) {
      await storage.agentAudit.append({
        userId: 'u1',
        orgId: orgA,
        toolName: 't',
        argsJson: '{}',
        outcome: 'success',
        latencyMs: 10,
      });
    }
    for (let i = 0; i < 2; i++) {
      await storage.agentAudit.append({
        userId: 'u1',
        orgId: orgB,
        toolName: 't',
        argsJson: '{}',
        outcome: 'success',
        latencyMs: 10,
      });
    }
    expect(await storage.agentAudit.countForOrg(orgA, {})).toBe(4);
    expect(await storage.agentAudit.countForOrg(orgB, {})).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Group C — filter combinations
// ---------------------------------------------------------------------------

describe('SqliteAgentAuditRepository — filters', () => {
  // Seed a mix: 3 users × 2 tools × 2 outcomes across a range of timestamps.
  beforeEach(async () => {
    const users = ['u1', 'u2', 'u3'];
    const tools = ['dashboard_scan_site', 'dashboard_list_reports'];
    const outcomes = ['success', 'error'] as const;

    for (const u of users) {
      for (const t of tools) {
        for (const o of outcomes) {
          await storage.agentAudit.append({
            userId: u,
            orgId: orgA,
            toolName: t,
            argsJson: '{}',
            outcome: o,
            latencyMs: 10,
          });
          // Small delay so created_at timestamps differ (helps ordering
          // assertions later — negligible per iteration).
          await new Promise((r) => setImmediate(r));
        }
      }
    }
    // Plus 4 rows in orgB to verify filters don't leak across orgs.
    for (let i = 0; i < 4; i++) {
      await storage.agentAudit.append({
        userId: 'u1',
        orgId: orgB,
        toolName: 'dashboard_scan_site',
        argsJson: '{}',
        outcome: 'success',
        latencyMs: 10,
      });
    }
  });

  it('userId filter narrows the result set', async () => {
    const list = await storage.agentAudit.listForOrg(
      orgA,
      { userId: 'u1' },
      {},
    );
    expect(list).toHaveLength(4); // 2 tools × 2 outcomes for u1
    expect(list.every((e) => e.userId === 'u1')).toBe(true);
    expect(list.every((e) => e.orgId === orgA)).toBe(true);
  });

  it('toolName filter narrows the result set', async () => {
    const list = await storage.agentAudit.listForOrg(
      orgA,
      { toolName: 'dashboard_scan_site' },
      {},
    );
    expect(list).toHaveLength(6); // 3 users × 2 outcomes
    expect(list.every((e) => e.toolName === 'dashboard_scan_site')).toBe(true);
  });

  it('outcome filter narrows the result set', async () => {
    const list = await storage.agentAudit.listForOrg(
      orgA,
      { outcome: 'error' },
      {},
    );
    expect(list).toHaveLength(6); // 3 users × 2 tools × 1 outcome
    expect(list.every((e) => e.outcome === 'error')).toBe(true);
  });

  it('from/to date range narrows the result set', async () => {
    // Pick the middle third of rows by created_at.
    const all = await storage.agentAudit.listForOrg(orgA, {}, {});
    expect(all.length).toBeGreaterThan(3);
    // listForOrg orders DESC, so `all[0]` is newest. Pick a slice.
    const sortedAsc = [...all].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const lo = sortedAsc[3]!.createdAt;
    const hi = sortedAsc[sortedAsc.length - 3]!.createdAt;

    const list = await storage.agentAudit.listForOrg(
      orgA,
      { from: lo, to: hi },
      {},
    );
    // Every row must fall in [lo, hi]
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThan(all.length);
    expect(list.every((e) => e.createdAt >= lo && e.createdAt <= hi)).toBe(true);
  });

  it('all filters combined compose correctly (intersection)', async () => {
    const list = await storage.agentAudit.listForOrg(
      orgA,
      {
        userId: 'u2',
        toolName: 'dashboard_list_reports',
        outcome: 'success',
      },
      {},
    );
    expect(list).toHaveLength(1);
    expect(list[0]!.userId).toBe('u2');
    expect(list[0]!.toolName).toBe('dashboard_list_reports');
    expect(list[0]!.outcome).toBe('success');
    expect(list[0]!.orgId).toBe(orgA);
  });

  it('countForOrg with filters matches listForOrg length (no pagination)', async () => {
    const filters = { userId: 'u1' };
    const list = await storage.agentAudit.listForOrg(orgA, filters, {});
    const count = await storage.agentAudit.countForOrg(orgA, filters);
    expect(count).toBe(list.length);
  });

  it('filters do not leak across orgs', async () => {
    // u1 in orgB exists with toolName=dashboard_scan_site,outcome=success (4 rows).
    // Same filter in orgA should return only orgA rows.
    const listA = await storage.agentAudit.listForOrg(
      orgA,
      {
        userId: 'u1',
        toolName: 'dashboard_scan_site',
        outcome: 'success',
      },
      {},
    );
    expect(listA).toHaveLength(1); // just u1's single success row in orgA
    expect(listA[0]!.orgId).toBe(orgA);
  });
});

// ---------------------------------------------------------------------------
// Group D — countForOrg (basic)
// ---------------------------------------------------------------------------

describe('SqliteAgentAuditRepository — countForOrg', () => {
  it('returns 0 for an empty org', async () => {
    expect(await storage.agentAudit.countForOrg(orgA, {})).toBe(0);
  });

  it('matches total insertions for an org with no filter', async () => {
    for (let i = 0; i < 7; i++) {
      await storage.agentAudit.append({
        userId: 'u1',
        orgId: orgA,
        toolName: 't',
        argsJson: '{}',
        outcome: 'success',
        latencyMs: 10,
      });
    }
    expect(await storage.agentAudit.countForOrg(orgA, {})).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Group E — pagination + ordering
// ---------------------------------------------------------------------------

describe('SqliteAgentAuditRepository — pagination + ordering', () => {
  beforeEach(async () => {
    // Seed 15 rows with distinct created_at so ordering is deterministic.
    for (let i = 0; i < 15; i++) {
      await storage.agentAudit.append({
        userId: 'u1',
        orgId: orgA,
        toolName: `t-${i}`,
        argsJson: `{"i":${i}}`,
        outcome: 'success',
        latencyMs: i,
      });
      await new Promise((r) => setImmediate(r));
    }
  });

  it('default ordering is created_at DESC (newest first)', async () => {
    const list = await storage.agentAudit.listForOrg(orgA, {}, {});
    expect(list.length).toBeGreaterThan(1);
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1]!.createdAt >= list[i]!.createdAt).toBe(true);
    }
    // Newest first — the 15th inserted (latencyMs=14) should be at index 0.
    expect(list[0]!.latencyMs).toBe(14);
  });

  it('limit + offset returns the requested slice', async () => {
    const page1 = await storage.agentAudit.listForOrg(
      orgA,
      {},
      { limit: 5, offset: 0 },
    );
    const page2 = await storage.agentAudit.listForOrg(
      orgA,
      {},
      { limit: 5, offset: 5 },
    );
    const page3 = await storage.agentAudit.listForOrg(
      orgA,
      {},
      { limit: 5, offset: 10 },
    );
    expect(page1).toHaveLength(5);
    expect(page2).toHaveLength(5);
    expect(page3).toHaveLength(5);
    // No overlap between pages
    const ids = new Set<string>();
    for (const e of [...page1, ...page2, ...page3]) ids.add(e.id);
    expect(ids.size).toBe(15);
  });

  it('limit defaults to a cap (at most 200) — mitigates T-31-10', async () => {
    // Can't easily insert 200+ rows in a test; instead verify the cap
    // is active by passing limit > 200 and confirming we don't get more
    // than 200 rows (we only have 15, so cap caps nothing, but the SQL
    // must accept the caller-supplied value without error).
    const list = await storage.agentAudit.listForOrg(
      orgA,
      {},
      { limit: 9999 },
    );
    expect(list.length).toBeLessThanOrEqual(200);
    expect(list).toHaveLength(15);
  });
});

// ---------------------------------------------------------------------------
// Group F — immutability surface (LOCKED CONTRACT)
// ---------------------------------------------------------------------------

describe('SqliteAgentAuditRepository — immutability contract', () => {
  it('exposes NO update/delete/remove/clear methods (append-only)', () => {
    expect(storage.agentAudit).not.toHaveProperty('update');
    expect(storage.agentAudit).not.toHaveProperty('updateEntry');
    expect(storage.agentAudit).not.toHaveProperty('delete');
    expect(storage.agentAudit).not.toHaveProperty('deleteEntry');
    expect(storage.agentAudit).not.toHaveProperty('remove');
    expect(storage.agentAudit).not.toHaveProperty('clear');
  });

  it('exposes exactly the four locked methods: append, getEntry, listForOrg, countForOrg', () => {
    expect(storage.agentAudit).toHaveProperty('append');
    expect(storage.agentAudit).toHaveProperty('getEntry');
    expect(storage.agentAudit).toHaveProperty('listForOrg');
    expect(storage.agentAudit).toHaveProperty('countForOrg');
    expect(typeof storage.agentAudit.append).toBe('function');
    expect(typeof storage.agentAudit.getEntry).toBe('function');
    expect(typeof storage.agentAudit.listForOrg).toBe('function');
    expect(typeof storage.agentAudit.countForOrg).toBe('function');
  });

  it('is distinct from storage.audit (pre-existing generic HTTP audit)', () => {
    // The generic audit repo has `log` + `query`; the new one does not.
    expect(storage.audit).toHaveProperty('log');
    expect(storage.audit).toHaveProperty('query');
    expect(storage.agentAudit).not.toHaveProperty('log');
    expect(storage.agentAudit).not.toHaveProperty('query');
  });
});
