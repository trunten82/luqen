/**
 * Phase 32 Plan 03 — OrgRepository agent-display-name roundtrip tests.
 *
 * Tests for `getOrg().agentDisplayName` reads and the new
 * `updateOrgAgentDisplayName(id, displayName)` mutation.
 *
 * See 32-03-PLAN.md Task 1 Tests 6-10, plus a tampering guard
 * regression test for threat T-32-03-01 (SQL injection via
 * malicious display name).
 *
 * Note on naming: the plan calls the repo `OrganizationsRepository` and
 * the method `updateOrgAgentDisplayName`. The actual repo is named
 * `OrgRepository` in this codebase (pre-existing convention —
 * `packages/dashboard/src/db/interfaces/org-repository.ts`). This test
 * file uses the existing naming and documents the delta in the SUMMARY
 * (Rule 3 deviation — pre-existing interface shape).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-org-adn-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

// ---------------------------------------------------------------------------
// Group A — default + roundtrip (Plan Tests 6-8, 10)
// ---------------------------------------------------------------------------

describe('OrgRepository.agentDisplayName — default + roundtrip', () => {
  // Test 6
  it('getOrg returns agentDisplayName=null for a freshly-inserted org', async () => {
    const org = await storage.organizations.createOrg({ name: 'Acme', slug: 'acme' });
    const fetched = await storage.organizations.getOrg(org.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.agentDisplayName).toBeNull();
  });

  // Test 7
  it('updateOrgAgentDisplayName then getOrg roundtrips the name', async () => {
    const org = await storage.organizations.createOrg({ name: 'Acme', slug: 'acme' });
    await storage.organizations.updateOrgAgentDisplayName(org.id, 'Luna');
    const fetched = await storage.organizations.getOrg(org.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.agentDisplayName).toBe('Luna');
  });

  // Test 8
  it('updateOrgAgentDisplayName(id, null) resets the column to NULL', async () => {
    const org = await storage.organizations.createOrg({ name: 'Acme', slug: 'acme' });
    await storage.organizations.updateOrgAgentDisplayName(org.id, 'Luna');
    await storage.organizations.updateOrgAgentDisplayName(org.id, null);
    const fetched = await storage.organizations.getOrg(org.id);
    expect(fetched!.agentDisplayName).toBeNull();
  });

  // Test 10
  it('stores empty string as empty string (NOT coerced to NULL)', async () => {
    const org = await storage.organizations.createOrg({ name: 'Acme', slug: 'acme' });
    await storage.organizations.updateOrgAgentDisplayName(org.id, '');
    const fetched = await storage.organizations.getOrg(org.id);
    expect(fetched!.agentDisplayName).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Group B — non-existent org (Plan Test 9)
// ---------------------------------------------------------------------------

describe('OrgRepository.updateOrgAgentDisplayName — nonexistent org', () => {
  // Test 9
  it('is a silent no-op for a nonexistent org id (0 rows affected, no throw)', async () => {
    await expect(
      storage.organizations.updateOrgAgentDisplayName('nonexistent-org-id', 'X'),
    ).resolves.toBeUndefined();

    // getOrg still returns null for the missing org
    expect(await storage.organizations.getOrg('nonexistent-org-id')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Group C — listOrgs + getOrgBySlug include agentDisplayName
// (regression guard per plan Task 2 acceptance: SELECT column list must
// include agent_display_name)
// ---------------------------------------------------------------------------

describe('OrgRepository — agentDisplayName visible on listOrgs + getOrgBySlug', () => {
  it('listOrgs surfaces agentDisplayName on every row', async () => {
    const orgA = await storage.organizations.createOrg({ name: 'A', slug: 'a' });
    const orgB = await storage.organizations.createOrg({ name: 'B', slug: 'b' });
    await storage.organizations.updateOrgAgentDisplayName(orgA.id, 'Luna');

    const all = await storage.organizations.listOrgs();
    const aRow = all.find((o) => o.id === orgA.id);
    const bRow = all.find((o) => o.id === orgB.id);
    expect(aRow!.agentDisplayName).toBe('Luna');
    expect(bRow!.agentDisplayName).toBeNull();
  });

  it('getOrgBySlug surfaces agentDisplayName', async () => {
    const org = await storage.organizations.createOrg({ name: 'Acme', slug: 'acme' });
    await storage.organizations.updateOrgAgentDisplayName(org.id, 'Luna');
    const fetched = await storage.organizations.getOrgBySlug('acme');
    expect(fetched!.agentDisplayName).toBe('Luna');
  });
});

// ---------------------------------------------------------------------------
// Group D — tampering guard (T-32-03-01)
//
// Display names come from an untrusted surface (Plan 08 will be the
// write-site route). The repo MUST use parameterized queries so a
// malicious string cannot execute as SQL. Regression guard.
// ---------------------------------------------------------------------------

describe('OrgRepository.updateOrgAgentDisplayName — SQL-injection guard (T-32-03-01)', () => {
  it('stores a SQL-injection payload literally (never executes it)', async () => {
    const org = await storage.organizations.createOrg({ name: 'Acme', slug: 'acme' });
    const payload = "'; DROP TABLE organizations; --";

    await storage.organizations.updateOrgAgentDisplayName(org.id, payload);

    // Row is still there (table not dropped); value is stored verbatim.
    const fetched = await storage.organizations.getOrg(org.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.agentDisplayName).toBe(payload);

    // Double-check: organizations table still works for a fresh insert.
    const orgB = await storage.organizations.createOrg({ name: 'B', slug: 'b' });
    expect(orgB.id).toBeDefined();
  });
});
