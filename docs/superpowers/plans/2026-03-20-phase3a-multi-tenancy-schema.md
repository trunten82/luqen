# Phase 3a: Multi-Tenancy — Schema & Query Scoping

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add org-level data isolation to dashboard and compliance databases so scans, compliance data, and API access can be scoped per organization — while remaining invisible in single-user mode.

**Architecture:** Query-level isolation using an `org_id` column (default `'system'`) on all data tables. The dashboard owns organization management (new `organizations` + `org_members` tables). The compliance service receives org context via `X-Org-Id` HTTP header from the dashboard, trusted because requests are authenticated with a service-level API key. All existing queries get an `org_id` filter — in single-user mode this is always `'system'`, making multi-tenancy transparent.

**Tech Stack:** TypeScript, better-sqlite3, Fastify, Vitest

**Spec:** `docs/superpowers/specs/2026-03-20-plugin-system-multitenancy-design.md` (sections: Multi-Tenancy, Database Changes)

---

## File Structure

### Dashboard Package (`packages/dashboard/`)

| File | Action | Responsibility |
|------|--------|----------------|
| `src/db/scans.ts` | Modify | Add migration 005 (org tables + org_id columns), add `orgId` to `ScanRecord`, `ScanFilters`, all CRUD methods |
| `src/db/orgs.ts` | Create | `OrgDb` class — CRUD for organizations + org_members tables |
| `tests/db/orgs.test.ts` | Create | Tests for OrgDb |
| `tests/db/scans-org.test.ts` | Create | Tests for org-scoped scan CRUD |

### Compliance Package (`packages/compliance/`)

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types.ts` | Modify | Add `orgId` to filter interfaces |
| `src/db/adapter.ts` | Modify | Add `deleteOrgData(orgId)` method, add `orgId` to filter types |
| `src/db/sqlite-adapter.ts` | Modify | Add `org_id` columns to `createTables()`, implement `deleteOrgData()`, add org filtering to all queries |
| `src/api/routes/orgs.ts` | Create | `DELETE /api/v1/orgs/:id/data` endpoint |
| `src/api/server.ts` | Modify | Register org routes, add `X-Org-Id` extraction hook |
| `src/auth/middleware.ts` | Modify | Extract `X-Org-Id` header and attach to request |
| `tests/db/org-scoping.test.ts` | Create | Tests for org-scoped queries and data isolation |
| `tests/api/orgs.test.ts` | Create | Tests for org data cleanup endpoint |

---

## Task 1: Dashboard — Migration & Org Tables

**Files:**
- Modify: `packages/dashboard/src/db/scans.ts` (migrations array, lines 78-158)
- Create: `packages/dashboard/src/db/orgs.ts`
- Create: `packages/dashboard/tests/db/orgs.test.ts`

### Step 1.1: Write failing tests for OrgDb

- [ ] Create `packages/dashboard/tests/db/orgs.test.ts` with tests for:
  - `createOrg()` — creates an org with id, name, slug, createdAt
  - `getOrg()` — retrieves by id
  - `getOrgBySlug()` — retrieves by slug
  - `listOrgs()` — returns all orgs
  - `deleteOrg()` — removes org and cascades to org_members
  - `addMember()` — adds user to org with role
  - `removeMember()` — removes user from org
  - `listMembers()` — lists members of an org
  - `getUserOrgs()` — lists orgs a user belongs to
  - Slug uniqueness constraint

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { ScanDb } from '../../src/db/scans.js';
import { OrgDb } from '../../src/db/orgs.js';

function makeTempDb() {
  const path = join(tmpdir(), `test-orgs-${randomUUID()}.db`);
  const scanDb = new ScanDb(path);
  scanDb.initialize();
  const orgDb = new OrgDb(scanDb.getDatabase());
  return { scanDb, orgDb, path };
}

describe('OrgDb', () => {
  let scanDb: ScanDb;
  let orgDb: OrgDb;
  let dbPath: string;

  beforeEach(() => {
    const result = makeTempDb();
    scanDb = result.scanDb;
    orgDb = result.orgDb;
    dbPath = result.path;
  });

  afterEach(() => {
    scanDb.close();
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  describe('createOrg', () => {
    it('creates an organization', () => {
      const org = orgDb.createOrg({ name: 'Acme Corp', slug: 'acme' });
      expect(org.name).toBe('Acme Corp');
      expect(org.slug).toBe('acme');
      expect(org.id).toBeDefined();
      expect(org.createdAt).toBeDefined();
    });

    it('rejects duplicate slugs', () => {
      orgDb.createOrg({ name: 'Acme Corp', slug: 'acme' });
      expect(() => orgDb.createOrg({ name: 'Acme 2', slug: 'acme' })).toThrow();
    });
  });

  describe('getOrg / getOrgBySlug', () => {
    it('retrieves by id', () => {
      const created = orgDb.createOrg({ name: 'Test Org', slug: 'test' });
      const found = orgDb.getOrg(created.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Test Org');
    });

    it('retrieves by slug', () => {
      orgDb.createOrg({ name: 'Test Org', slug: 'test' });
      const found = orgDb.getOrgBySlug('test');
      expect(found).not.toBeNull();
      expect(found!.slug).toBe('test');
    });

    it('returns null for missing org', () => {
      expect(orgDb.getOrg('nonexistent')).toBeNull();
      expect(orgDb.getOrgBySlug('nope')).toBeNull();
    });
  });

  describe('listOrgs', () => {
    it('returns all orgs', () => {
      orgDb.createOrg({ name: 'Org A', slug: 'a' });
      orgDb.createOrg({ name: 'Org B', slug: 'b' });
      expect(orgDb.listOrgs()).toHaveLength(2);
    });
  });

  describe('deleteOrg', () => {
    it('removes org and its members', () => {
      const org = orgDb.createOrg({ name: 'Doomed', slug: 'doomed' });
      orgDb.addMember(org.id, 'user-1', 'admin');
      orgDb.deleteOrg(org.id);
      expect(orgDb.getOrg(org.id)).toBeNull();
      expect(orgDb.listMembers(org.id)).toHaveLength(0);
    });
  });

  describe('members', () => {
    it('adds and lists members', () => {
      const org = orgDb.createOrg({ name: 'Team', slug: 'team' });
      orgDb.addMember(org.id, 'user-1', 'admin');
      orgDb.addMember(org.id, 'user-2', 'member');
      const members = orgDb.listMembers(org.id);
      expect(members).toHaveLength(2);
      expect(members[0].role).toBe('admin');
    });

    it('removes a member', () => {
      const org = orgDb.createOrg({ name: 'Team', slug: 'team' });
      orgDb.addMember(org.id, 'user-1', 'admin');
      orgDb.removeMember(org.id, 'user-1');
      expect(orgDb.listMembers(org.id)).toHaveLength(0);
    });

    it('lists orgs for a user', () => {
      const org1 = orgDb.createOrg({ name: 'Org 1', slug: 'o1' });
      const org2 = orgDb.createOrg({ name: 'Org 2', slug: 'o2' });
      orgDb.addMember(org1.id, 'user-1', 'admin');
      orgDb.addMember(org2.id, 'user-1', 'member');
      const orgs = orgDb.getUserOrgs('user-1');
      expect(orgs).toHaveLength(2);
    });

    it('rejects duplicate membership', () => {
      const org = orgDb.createOrg({ name: 'Team', slug: 'team' });
      orgDb.addMember(org.id, 'user-1', 'admin');
      expect(() => orgDb.addMember(org.id, 'user-1', 'member')).toThrow();
    });
  });
});
```

- [ ] Run tests to verify they fail: `cd packages/dashboard && npx vitest run tests/db/orgs.test.ts`
  Expected: FAIL — `OrgDb` not found

### Step 1.2: Add migration 005 to DASHBOARD_MIGRATIONS

- [ ] Add migration to `packages/dashboard/src/db/scans.ts` after the `004` migration (line 157):

```typescript
  {
    id: '005',
    name: 'add-multi-tenancy',
    sql: `
ALTER TABLE scan_records ADD COLUMN org_id TEXT NOT NULL DEFAULT 'system';
CREATE INDEX IF NOT EXISTS idx_scan_records_org_id ON scan_records(org_id);

ALTER TABLE api_keys ADD COLUMN org_id TEXT NOT NULL DEFAULT 'system';
CREATE INDEX IF NOT EXISTS idx_api_keys_org_id ON api_keys(org_id);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS org_members (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
    `,
  },
```

- [ ] Run existing migration tests to ensure no breakage: `cd packages/dashboard && npx vitest run tests/db/migrations.test.ts`
  Expected: PASS

### Step 1.3: Implement OrgDb

- [ ] Create `packages/dashboard/src/db/orgs.ts`:

```typescript
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface Organization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: string;
}

export interface OrgMember {
  readonly orgId: string;
  readonly userId: string;
  readonly role: string;
  readonly joinedAt: string;
}

export class OrgDb {
  constructor(private readonly db: Database.Database) {}

  createOrg(data: { name: string; slug: string }): Organization {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)',
    ).run(id, data.name, data.slug, createdAt);
    return { id, name: data.name, slug: data.slug, createdAt };
  }

  getOrg(id: string): Organization | null {
    const row = this.db.prepare('SELECT * FROM organizations WHERE id = ?').get(id) as
      | { id: string; name: string; slug: string; created_at: string }
      | undefined;
    return row != null ? { id: row.id, name: row.name, slug: row.slug, createdAt: row.created_at } : null;
  }

  getOrgBySlug(slug: string): Organization | null {
    const row = this.db.prepare('SELECT * FROM organizations WHERE slug = ?').get(slug) as
      | { id: string; name: string; slug: string; created_at: string }
      | undefined;
    return row != null ? { id: row.id, name: row.name, slug: row.slug, createdAt: row.created_at } : null;
  }

  listOrgs(): Organization[] {
    const rows = this.db.prepare('SELECT * FROM organizations ORDER BY created_at').all() as
      Array<{ id: string; name: string; slug: string; created_at: string }>;
    return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, createdAt: r.created_at }));
  }

  deleteOrg(id: string): void {
    this.db.prepare('DELETE FROM organizations WHERE id = ?').run(id);
  }

  addMember(orgId: string, userId: string, role: string): OrgMember {
    const joinedAt = new Date().toISOString();
    this.db.prepare(
      'INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
    ).run(orgId, userId, role, joinedAt);
    return { orgId, userId, role, joinedAt };
  }

  removeMember(orgId: string, userId: string): void {
    this.db.prepare('DELETE FROM org_members WHERE org_id = ? AND user_id = ?').run(orgId, userId);
  }

  listMembers(orgId: string): OrgMember[] {
    const rows = this.db.prepare(
      'SELECT * FROM org_members WHERE org_id = ? ORDER BY joined_at',
    ).all(orgId) as Array<{ org_id: string; user_id: string; role: string; joined_at: string }>;
    return rows.map((r) => ({ orgId: r.org_id, userId: r.user_id, role: r.role, joinedAt: r.joined_at }));
  }

  getUserOrgs(userId: string): Organization[] {
    const rows = this.db.prepare(`
      SELECT o.* FROM organizations o
      JOIN org_members m ON o.id = m.org_id
      WHERE m.user_id = ?
      ORDER BY o.created_at
    `).all(userId) as Array<{ id: string; name: string; slug: string; created_at: string }>;
    return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, createdAt: r.created_at }));
  }
}
```

- [ ] Run OrgDb tests: `cd packages/dashboard && npx vitest run tests/db/orgs.test.ts`
  Expected: PASS (all 10 tests)

- [ ] Commit:
```bash
git add packages/dashboard/src/db/orgs.ts packages/dashboard/src/db/scans.ts packages/dashboard/tests/db/orgs.test.ts
git commit -m "feat: add organizations tables and OrgDb for multi-tenancy"
```

---

## Task 2: Dashboard — Org-Scoped Scan CRUD

**Files:**
- Modify: `packages/dashboard/src/db/scans.ts` (ScanRecord, ScanFilters, ScanDb methods)
- Create: `packages/dashboard/tests/db/scans-org.test.ts`

### Step 2.1: Write failing tests for org-scoped scans

- [ ] Create `packages/dashboard/tests/db/scans-org.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { ScanDb } from '../../src/db/scans.js';

function makeTempDb() {
  const path = join(tmpdir(), `test-scans-org-${randomUUID()}.db`);
  const scanDb = new ScanDb(path);
  scanDb.initialize();
  return { scanDb, path };
}

describe('ScanDb org scoping', () => {
  let db: ScanDb;
  let dbPath: string;

  beforeEach(() => {
    const result = makeTempDb();
    db = result.scanDb;
    dbPath = result.path;
  });

  afterEach(() => {
    db.close();
    if (existsSync(dbPath)) rmSync(dbPath);
  });

  it('defaults org_id to system', () => {
    const scan = db.createScan({
      id: randomUUID(),
      siteUrl: 'https://example.com',
      standard: 'WCAG2AA',
      jurisdictions: [],
      createdBy: 'user-1',
      createdAt: new Date().toISOString(),
    });
    expect(scan.orgId).toBe('system');
  });

  it('creates scan with explicit orgId', () => {
    const scan = db.createScan({
      id: randomUUID(),
      siteUrl: 'https://example.com',
      standard: 'WCAG2AA',
      jurisdictions: [],
      createdBy: 'user-1',
      createdAt: new Date().toISOString(),
      orgId: 'org-1',
    });
    expect(scan.orgId).toBe('org-1');
  });

  it('listScans filters by orgId', () => {
    db.createScan({ id: randomUUID(), siteUrl: 'https://a.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'u', createdAt: new Date().toISOString(), orgId: 'org-1' });
    db.createScan({ id: randomUUID(), siteUrl: 'https://b.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'u', createdAt: new Date().toISOString(), orgId: 'org-2' });
    db.createScan({ id: randomUUID(), siteUrl: 'https://c.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'u', createdAt: new Date().toISOString() });

    const org1Scans = db.listScans({ orgId: 'org-1' });
    expect(org1Scans).toHaveLength(1);
    expect(org1Scans[0].siteUrl).toBe('https://a.com');

    const systemScans = db.listScans({ orgId: 'system' });
    expect(systemScans).toHaveLength(1);
  });

  it('deleteOrgScans removes all scans for an org', () => {
    db.createScan({ id: randomUUID(), siteUrl: 'https://a.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'u', createdAt: new Date().toISOString(), orgId: 'org-1' });
    db.createScan({ id: randomUUID(), siteUrl: 'https://b.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'u', createdAt: new Date().toISOString(), orgId: 'org-1' });
    db.createScan({ id: randomUUID(), siteUrl: 'https://c.com', standard: 'WCAG2AA', jurisdictions: [], createdBy: 'u', createdAt: new Date().toISOString() });

    db.deleteOrgScans('org-1');
    expect(db.listScans({ orgId: 'org-1' })).toHaveLength(0);
    expect(db.listScans({ orgId: 'system' })).toHaveLength(1);
  });
});
```

- [ ] Run tests to verify they fail: `cd packages/dashboard && npx vitest run tests/db/scans-org.test.ts`
  Expected: FAIL — `orgId` not in types

### Step 2.2: Add orgId to ScanRecord and ScanFilters

- [ ] In `packages/dashboard/src/db/scans.ts`:
  - Add `readonly orgId: string;` to `ScanRecord` interface (after line 21)
  - Add `readonly orgId?: string;` to `ScanFilters` interface (after line 29)
  - Add `org_id: string;` to `ScanRow` interface (after line 50)
  - Add `orgId: row.org_id,` to `rowToRecord()` function in the base object (after line 61)

### Step 2.3: Update ScanDb.createScan to accept orgId

- [ ] In `packages/dashboard/src/db/scans.ts`, update `createScan` method:
  - Add `orgId?: string;` to the data parameter type
  - Update SQL to include `org_id` in INSERT
  - Pass `orgId: data.orgId ?? 'system'` in the params

### Step 2.4: Update ScanDb.listScans to filter by orgId

- [ ] In `packages/dashboard/src/db/scans.ts`, add orgId filter to `listScans`:
  ```typescript
  if (filters.orgId !== undefined) {
    conditions.push('org_id = @orgId');
    params['orgId'] = filters.orgId;
  }
  ```

### Step 2.5: Add deleteOrgScans method

- [ ] In `packages/dashboard/src/db/scans.ts`, add after `deleteScan`:
  ```typescript
  deleteOrgScans(orgId: string): void {
    this.db.prepare('DELETE FROM scan_records WHERE org_id = ?').run(orgId);
  }
  ```

- [ ] Run org-scoping tests: `cd packages/dashboard && npx vitest run tests/db/scans-org.test.ts`
  Expected: PASS

- [ ] Run all dashboard tests to verify no breakage: `cd packages/dashboard && npx vitest run`
  Expected: PASS (existing tests unaffected — they don't set orgId, so DEFAULT 'system' applies)

- [ ] Commit:
```bash
git add packages/dashboard/src/db/scans.ts packages/dashboard/tests/db/scans-org.test.ts
git commit -m "feat: add org-scoped scan CRUD with orgId filtering"
```

---

## Task 3: Compliance — Add orgId to Types and Filter Interfaces

**Files:**
- Modify: `packages/compliance/src/types.ts` (lines 192-207, filter interfaces)

### Step 3.1: Add orgId to filter interfaces

- [ ] In `packages/compliance/src/types.ts`, add `readonly orgId?: string;` to:
  - `JurisdictionFilters` (line 193)
  - `RegulationFilters` (line 198)
  - `RequirementFilters` (line 204)

- [ ] Update the `listUpdateProposals` filters inline type to include orgId. In the `DbAdapter` interface at `packages/compliance/src/db/adapter.ts`, change:
  ```typescript
  listUpdateProposals(
    filters?: { status?: string },
  ): Promise<UpdateProposal[]>;
  ```
  to:
  ```typescript
  listUpdateProposals(
    filters?: { status?: string; orgId?: string },
  ): Promise<UpdateProposal[]>;
  ```

- [ ] Similarly update `listSources()` and `listWebhooks()` in the adapter to accept an optional orgId filter parameter:
  ```typescript
  listSources(filters?: { orgId?: string }): Promise<MonitoredSource[]>;
  listWebhooks(filters?: { orgId?: string }): Promise<Webhook[]>;
  ```

- [ ] Commit:
```bash
git add packages/compliance/src/types.ts
git commit -m "feat: add orgId to compliance filter interfaces"
```

---

## Task 4: Compliance — Add orgId to DbAdapter and SQLite Adapter

**Files:**
- Modify: `packages/compliance/src/db/adapter.ts`
- Modify: `packages/compliance/src/db/sqlite-adapter.ts`
- Create: `packages/compliance/tests/db/org-scoping.test.ts`

### Step 4.1: Write failing tests for org-scoped compliance queries

- [ ] Create `packages/compliance/tests/db/org-scoping.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DbAdapter } from '../../src/db/adapter.js';

async function makeSqliteAdapter(): Promise<DbAdapter> {
  const { SqliteAdapter } = await import('../../src/db/sqlite-adapter.js');
  const adapter = new SqliteAdapter(':memory:');
  await adapter.initialize();
  return adapter;
}

describe('Org-scoped compliance queries', () => {
  let db: DbAdapter;

  beforeEach(async () => {
    db = await makeSqliteAdapter();
  });

  afterEach(async () => {
    await db.close();
  });

  describe('jurisdictions', () => {
    it('defaults org_id to system', async () => {
      const j = await db.createJurisdiction({
        name: 'Test Country',
        type: 'country',
      });
      // Fetch all — should include system org data
      const all = await db.listJurisdictions();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(j.id);
    });

    it('filters by orgId', async () => {
      await db.createJurisdiction({ name: 'Global', type: 'country' });
      await db.createJurisdiction({ name: 'Org Custom', type: 'country', orgId: 'org-1' });

      const systemOnly = await db.listJurisdictions({ orgId: 'system' });
      expect(systemOnly).toHaveLength(1);
      expect(systemOnly[0].name).toBe('Global');

      const org1Only = await db.listJurisdictions({ orgId: 'org-1' });
      expect(org1Only).toHaveLength(1);
      expect(org1Only[0].name).toBe('Org Custom');
    });
  });

  describe('regulations', () => {
    it('filters by orgId', async () => {
      const j = await db.createJurisdiction({ name: 'Country', type: 'country' });
      await db.createRegulation({
        jurisdictionId: j.id,
        name: 'Global Reg',
        shortName: 'GR',
        reference: 'REF-1',
        url: 'https://example.com',
        enforcementDate: '2025-01-01',
        status: 'active',
        scope: 'public',
        sectors: [],
        description: 'A regulation',
      });
      await db.createRegulation({
        jurisdictionId: j.id,
        name: 'Org Reg',
        shortName: 'OR',
        reference: 'REF-2',
        url: 'https://example.com',
        enforcementDate: '2025-01-01',
        status: 'active',
        scope: 'public',
        sectors: [],
        description: 'Org regulation',
        orgId: 'org-1',
      });

      const systemRegs = await db.listRegulations({ orgId: 'system' });
      expect(systemRegs).toHaveLength(1);
      expect(systemRegs[0].name).toBe('Global Reg');
    });
  });

  describe('deleteOrgData', () => {
    it('removes all data for an org', async () => {
      const j = await db.createJurisdiction({ name: 'Org J', type: 'country', orgId: 'org-1' });
      await db.createRegulation({
        jurisdictionId: j.id,
        name: 'Org Reg',
        shortName: 'OR',
        reference: 'R1',
        url: 'https://x.com',
        enforcementDate: '2025-01-01',
        status: 'active',
        scope: 'public',
        sectors: [],
        description: 'test',
        orgId: 'org-1',
      });

      await db.deleteOrgData('org-1');

      expect(await db.listJurisdictions({ orgId: 'org-1' })).toHaveLength(0);
      expect(await db.listRegulations({ orgId: 'org-1' })).toHaveLength(0);
    });

    it('does not affect system data', async () => {
      await db.createJurisdiction({ name: 'Global', type: 'country' });
      await db.createJurisdiction({ name: 'Org', type: 'country', orgId: 'org-1' });

      await db.deleteOrgData('org-1');

      const systemData = await db.listJurisdictions({ orgId: 'system' });
      expect(systemData).toHaveLength(1);
      expect(systemData[0].name).toBe('Global');
    });

    it('refuses to delete system org data', async () => {
      await expect(db.deleteOrgData('system')).rejects.toThrow();
    });
  });
});
```

- [ ] Run tests to verify they fail: `cd packages/compliance && npx vitest run tests/db/org-scoping.test.ts`
  Expected: FAIL — orgId not in create inputs, deleteOrgData doesn't exist

### Step 4.2: Add orgId to CreateInput types

- [ ] In `packages/compliance/src/types.ts`, add `readonly orgId?: string;` to:
  - `CreateJurisdictionInput`
  - `CreateRegulationInput`
  - `CreateRequirementInput`
  - `CreateUpdateProposalInput`
  - `CreateSourceInput`
  - `CreateWebhookInput`

### Step 4.3: Add deleteOrgData to DbAdapter interface

- [ ] In `packages/compliance/src/db/adapter.ts`, add before the Lifecycle section (before line 105):
  ```typescript
  // Org data cleanup
  deleteOrgData(orgId: string): Promise<void>;
  ```

### Step 4.4: Update SQLite adapter — add org_id columns

- [ ] In `packages/compliance/src/db/sqlite-adapter.ts`, update `createTables()` (lines 266-360) to add `org_id TEXT NOT NULL DEFAULT 'system'` column to these tables:
  - `jurisdictions`
  - `regulations`
  - `requirements`
  - `update_proposals`
  - `monitored_sources`
  - `webhooks`
  - `users`
  - `oauth_clients`

  Add after each table's closing `)`:
  - `CREATE INDEX IF NOT EXISTS idx_<table>_org_id ON <table>(org_id);`

### Step 4.5: Update SQLite adapter — org-scoped queries

- [ ] Update `listJurisdictions()` to filter by orgId when present in filters:
  ```typescript
  if (filters?.orgId != null) {
    sql += ' AND org_id = ?';
    params.push(filters.orgId);
  }
  ```

- [ ] Apply same pattern to `listRegulations()`, `listRequirements()`, `listUpdateProposals()`, `listSources()`, `listWebhooks()`.

- [ ] Update create methods (`createJurisdiction`, `createRegulation`, etc.) to pass `data.orgId ?? 'system'` as the `org_id` value in INSERT statements.

### Step 4.6: Implement deleteOrgData

- [ ] Add to `SqliteAdapter`:
  ```typescript
  async deleteOrgData(orgId: string): Promise<void> {
    if (orgId === 'system') {
      throw new Error('Cannot delete system org data');
    }
    const transaction = this.db.transaction(() => {
      // Delete in dependency order (requirements → regulations → jurisdictions)
      this.db.prepare('DELETE FROM requirements WHERE org_id = ?').run(orgId);
      this.db.prepare('DELETE FROM regulations WHERE org_id = ?').run(orgId);
      this.db.prepare('DELETE FROM jurisdictions WHERE org_id = ?').run(orgId);
      this.db.prepare('DELETE FROM update_proposals WHERE org_id = ?').run(orgId);
      this.db.prepare('DELETE FROM monitored_sources WHERE org_id = ?').run(orgId);
      this.db.prepare('DELETE FROM webhooks WHERE org_id = ?').run(orgId);
      this.db.prepare('DELETE FROM oauth_clients WHERE org_id = ?').run(orgId);
      this.db.prepare('DELETE FROM users WHERE org_id = ?').run(orgId);
    });
    transaction();
  }
  ```

- [ ] Run org-scoping tests: `cd packages/compliance && npx vitest run tests/db/org-scoping.test.ts`
  Expected: PASS

- [ ] Run all compliance tests: `cd packages/compliance && npx vitest run`
  Expected: PASS (existing tests unaffected — they don't set orgId, DEFAULT 'system' applies)

- [ ] Commit:
```bash
git add packages/compliance/src/types.ts packages/compliance/src/db/adapter.ts packages/compliance/src/db/sqlite-adapter.ts packages/compliance/tests/db/org-scoping.test.ts
git commit -m "feat: add org_id columns and org-scoped queries to compliance service"
```

---

## Task 5: Compliance — X-Org-Id Header Extraction

**Files:**
- Modify: `packages/compliance/src/auth/middleware.ts`
- Modify: `packages/compliance/src/api/server.ts`

### Step 5.1: Write failing test for X-Org-Id extraction

- [ ] Create `packages/compliance/tests/api/orgs.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, type TestContext } from './helpers.js';

describe('X-Org-Id header handling', () => {
  let ctx: TestContext;
  let app: FastifyInstance;

  beforeEach(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });

  afterEach(async () => {
    await app.close();
  });

  it('passes X-Org-Id to jurisdiction queries', async () => {
    // Create a jurisdiction with org context
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/jurisdictions',
      headers: {
        authorization: `Bearer ${ctx.adminToken}`,
        'x-org-id': 'org-1',
      },
      payload: { name: 'Org Country', type: 'country' },
    });
    expect(createRes.statusCode).toBe(201);

    // List with org filter — should see it
    const org1Res = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
      headers: {
        authorization: `Bearer ${ctx.adminToken}`,
        'x-org-id': 'org-1',
      },
    });
    const org1Body = JSON.parse(org1Res.body);
    expect(org1Body.data.some((j: { name: string }) => j.name === 'Org Country')).toBe(true);

    // List without org filter — should NOT see org-specific data (system only)
    const systemRes = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
      headers: {
        authorization: `Bearer ${ctx.adminToken}`,
      },
    });
    const systemBody = JSON.parse(systemRes.body);
    expect(systemBody.data.some((j: { name: string }) => j.name === 'Org Country')).toBe(false);
  });
});

describe('DELETE /api/v1/orgs/:id/data', () => {
  let ctx: TestContext;
  let app: FastifyInstance;

  beforeEach(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });

  afterEach(async () => {
    await app.close();
  });

  it('deletes all data for an org', async () => {
    // Create org-specific data
    await app.inject({
      method: 'POST',
      url: '/api/v1/jurisdictions',
      headers: { authorization: `Bearer ${ctx.adminToken}`, 'x-org-id': 'org-1' },
      payload: { name: 'Org J', type: 'country' },
    });

    // Delete org data
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/orgs/org-1/data',
      headers: { authorization: `Bearer ${ctx.adminToken}` },
    });
    expect(res.statusCode).toBe(204);

    // Verify data is gone
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/jurisdictions',
      headers: { authorization: `Bearer ${ctx.adminToken}`, 'x-org-id': 'org-1' },
    });
    expect(JSON.parse(listRes.body).data).toHaveLength(0);
  });

  it('rejects deleting system org', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/orgs/system/data',
      headers: { authorization: `Bearer ${ctx.adminToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires admin scope', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/orgs/org-1/data',
      headers: { authorization: `Bearer ${ctx.readToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] Run tests to verify they fail: `cd packages/compliance && npx vitest run tests/api/orgs.test.ts`
  Expected: FAIL

### Step 5.2: Add X-Org-Id extraction to request lifecycle

- [ ] In `packages/compliance/src/api/server.ts`, add a `preHandler` hook that extracts `X-Org-Id` and decorates the request:

  Before the route registrations (after line 102), add:
  ```typescript
  // Decorate request with orgId from X-Org-Id header
  app.decorateRequest('orgId', 'system');
  app.addHook('preHandler', async (request) => {
    const headerVal = request.headers['x-org-id'];
    if (typeof headerVal === 'string' && headerVal.length > 0) {
      (request as FastifyRequest & { orgId: string }).orgId = headerVal;
    }
  });
  ```

### Step 5.3: Update route handlers to use orgId from request

- [ ] Update `packages/compliance/src/api/routes/jurisdictions.ts`:
  - In GET handler, pass orgId from request to the filter:
    ```typescript
    const orgId = (request as FastifyRequest & { orgId?: string }).orgId;
    if (orgId != null) filters.orgId = orgId;
    ```
  - In POST handler, pass orgId to create:
    ```typescript
    const orgId = (request as FastifyRequest & { orgId?: string }).orgId ?? 'system';
    const jurisdiction = await crud.createJurisdiction(db, { ...body, orgId });
    ```

  Apply the same pattern to `regulations.ts`, `requirements.ts`, `updates.ts`, `sources.ts`, `webhooks.ts`.

### Step 5.4: Create org data cleanup route

- [ ] Create `packages/compliance/src/api/routes/orgs.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import type { DbAdapter } from '../../db/adapter.js';
import { requireScope } from '../../auth/middleware.js';

export async function registerOrgRoutes(
  app: FastifyInstance,
  db: DbAdapter,
): Promise<void> {
  app.delete('/api/v1/orgs/:id/data', {
    preHandler: [requireScope('admin')],
  }, async (request, reply) => {
    try {
      const { id: orgId } = request.params as { id: string };
      if (orgId === 'system') {
        await reply.status(400).send({ error: 'Cannot delete system org data', statusCode: 400 });
        return;
      }
      await db.deleteOrgData(orgId);
      await reply.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      await reply.status(500).send({ error: message, statusCode: 500 });
    }
  });
}
```

### Step 5.5: Register org routes in server

- [ ] In `packages/compliance/src/api/server.ts`:
  - Add import: `import { registerOrgRoutes } from './routes/orgs.js';`
  - Add after line 124: `await registerOrgRoutes(app, db);`

- [ ] Run org API tests: `cd packages/compliance && npx vitest run tests/api/orgs.test.ts`
  Expected: PASS

- [ ] Run all compliance tests: `cd packages/compliance && npx vitest run`
  Expected: PASS

- [ ] Commit:
```bash
git add packages/compliance/src/auth/middleware.ts packages/compliance/src/api/server.ts packages/compliance/src/api/routes/orgs.ts packages/compliance/src/api/routes/jurisdictions.ts packages/compliance/tests/api/orgs.test.ts
git commit -m "feat: add X-Org-Id header extraction and org data cleanup endpoint"
```

---

## Task 6: Cross-Service Integration & Full Test Suite

**Files:**
- All modified files from Tasks 1-5

### Step 6.1: Run full dashboard test suite

- [ ] `cd packages/dashboard && npx vitest run`
  Expected: PASS — all existing + new tests

### Step 6.2: Run full compliance test suite

- [ ] `cd packages/compliance && npx vitest run`
  Expected: PASS — all existing + new tests

### Step 6.3: Run full monorepo build + test

- [ ] `npm run build --workspaces`
  Expected: PASS — TypeScript compiles cleanly

- [ ] `npm test --workspaces`
  Expected: PASS — all ~1040+ tests pass

### Step 6.4: Commit and tag

- [ ] Update `CHANGELOG.md` with Phase 3a entry under a new `## v0.10.0` heading
- [ ] Commit:
```bash
git add CHANGELOG.md
git commit -m "docs: add v0.10.0 changelog for multi-tenancy schema"
```

---

## Summary

| Task | Description | Tests Added |
|------|-------------|-------------|
| 1 | Dashboard migration 005 + OrgDb | ~10 tests |
| 2 | Org-scoped scan CRUD | ~4 tests |
| 3 | Compliance filter type changes | 0 (type-only) |
| 4 | Compliance org_id columns + deleteOrgData | ~6 tests |
| 5 | X-Org-Id header + cleanup endpoint | ~5 tests |
| 6 | Full integration verification | 0 (runs existing) |

**Total new tests:** ~25
**Estimated new/modified files:** 12
