# Multi-Database Storage Plugin Design

**Date:** 2026-03-22
**Status:** Approved
**Version:** 1.0

---

## Problem

The Luqen dashboard uses SQLite (better-sqlite3) with 132 direct SQL calls in a single 1,883-line god class (`ScanDb`). This prevents:

- Production deployments requiring PostgreSQL for concurrent writes
- Enterprise customers mandating specific DB platforms
- Cloud-native managed DB usage (RDS, Azure SQL, Cloud SQL)
- MongoDB for document-heavy report storage

## Solution

Database backends as **storage plugins** using the existing plugin system. SQLite remains the built-in default. PostgreSQL and MongoDB are optional plugins installed like any other Luqen plugin.

## Architecture

### Hybrid Bootstrap

A minimal SQLite file (`plugins.db`) always handles bootstrap:

| Always SQLite | Pluggable (SQLite default, or Postgres/MongoDB via plugin) |
|--------------|-----------------------------------------------------------|
| plugins registry | scan_records + json_report |
| dashboard_settings | dashboard_users + roles + role_permissions |
| api_keys | organizations + org_members |
| schema_migrations | teams, schedules, assignments, repos |
| | email_reports, smtp_config, manual_tests |
| | page_hashes, audit_log |

**Startup sequence:**

1. Read `plugins.db` (SQLite) to discover active storage plugin
2. If no storage plugin: use built-in SQLite for everything
3. If storage plugin found: connect to external DB
4. If external DB unreachable: boot in degraded mode (login works, scans show error)
5. Run pending migrations on application DB
6. Start serving

### StorageAdapter Interface

```typescript
interface StorageAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  migrate(): Promise<void>;
  healthCheck(): Promise<boolean>;

  scans: ScanRepository;
  users: UserRepository;
  schedules: ScheduleRepository;
  assignments: AssignmentRepository;
  roles: RoleRepository;
  teams: TeamRepository;
  repos: RepoRepository;
  email: EmailRepository;
  audit: AuditRepository;
  plugins: PluginRepository;
  organizations: OrgRepository;
}
```

### Repository Interfaces

**ScanRepository** (15 methods — largest):

```typescript
interface ScanRepository {
  getScan(id: string): Promise<ScanRecord | null>;
  listScans(filters: ScanFilters): Promise<ScanRecord[]>;
  countScans(filters: ScanFilters): Promise<number>;
  createScan(data: CreateScanInput): Promise<void>;
  updateScan(id: string, data: ScanUpdateData): Promise<ScanRecord>;
  deleteScan(id: string): Promise<void>;
  deleteOrgScans(orgId: string): Promise<void>;
  getReport(id: string): Promise<Record<string, unknown> | null>;
  getTrendData(orgId?: string): Promise<ScanRecord[]>;
  getPageHashes(siteUrl: string, orgId: string): Promise<Map<string, string>>;
  upsertPageHashes(entries: readonly PageHashEntry[]): Promise<void>;
  getManualTests(scanId: string): Promise<ManualTestResult[]>;
  saveManualTest(data: ManualTestInput): Promise<void>;
  deleteManualTests(scanId: string): Promise<void>;
}
```

**RoleRepository** (9 methods):

```typescript
interface RoleRepository {
  listRoles(orgId?: string): Promise<Role[]>;
  getRole(id: string): Promise<Role | null>;
  getRoleByName(name: string): Promise<Role | null>;
  createRole(data: CreateRoleInput): Promise<Role>;
  updateRole(id: string, data: UpdateRoleInput): Promise<void>;
  deleteRole(id: string): Promise<void>;
  getRolePermissions(roleId: string): Promise<string[]>;
  setRolePermissions(roleId: string, permissions: string[]): Promise<void>;
  getUserPermissions(userId: string): Promise<Set<string>>;
}
```

**ScheduleRepository** (6 methods):

```typescript
interface ScheduleRepository {
  listSchedules(orgId?: string): Promise<ScanSchedule[]>;
  getSchedule(id: string): Promise<ScanSchedule | null>;
  createSchedule(data: CreateScheduleInput): Promise<ScanSchedule>;
  updateSchedule(id: string, data: Partial<ScheduleUpdate>): Promise<void>;
  deleteSchedule(id: string): Promise<void>;
  getDueSchedules(): Promise<ScanSchedule[]>;
}
```

**Remaining repositories:**

| Repository | Methods | Entities |
|-----------|---------|----------|
| AssignmentRepository | 7 | issue_assignments |
| TeamRepository | 8 | teams, team_members |
| RepoRepository | 5 | connected_repos |
| EmailRepository | 6 | email_reports, smtp_config |
| AuditRepository | 3 | audit_log |
| OrgRepository | 6 | organizations, org_members |
| UserRepository | 6 | dashboard_users |

**Total: 11 repositories, ~70 methods.**

## Plugin Packages

### PostgreSQL Plugin

```
packages/plugins/storage-postgres/
├── src/
│   ├── index.ts              # Plugin manifest + activate/deactivate
│   ├── connection.ts         # Drizzle + pg pool setup
│   ├── repositories/         # All 11 repository implementations
│   └── migrations/           # Drizzle-generated SQL
├── package.json              # depends on drizzle-orm, pg
└── tsconfig.json
```

Config:
```json
{
  "connectionUrl": "postgres://user:pass@host:5432/luqen",
  "poolMin": 2,
  "poolMax": 10,
  "ssl": true
}
```

### MongoDB Plugin

```
packages/plugins/storage-mongodb/
├── src/
│   ├── index.ts
│   ├── connection.ts         # MongoDB native driver
│   ├── repositories/         # All 11 repository implementations
│   └── indexes.ts            # Index definitions applied on connect
├── package.json              # depends on mongodb
└── tsconfig.json
```

Config:
```json
{
  "connectionUrl": "mongodb+srv://user:pass@cluster.mongodb.net/luqen",
  "replicaSet": "rs0"
}
```

### MongoDB-Specific Handling

Reports stored as native BSON documents in a `reports` collection (efficient for large JSON). Scan metadata in a `scans` collection. Other entities map naturally to collections.

## File Structure (Dashboard Core)

```
packages/dashboard/src/db/
├── adapter.ts                # StorageAdapter + all Repository interfaces
├── types.ts                  # Shared types (ScanRecord, Role, etc.)
├── bootstrap.ts              # SQLite bootstrap (plugins.db)
├── sqlite/                   # Built-in SQLite implementation
│   ├── index.ts              # SqliteStorageAdapter
│   ├── connection.ts         # Drizzle + better-sqlite3
│   ├── schema.ts             # Drizzle table definitions
│   ├── repositories/         # 11 repository implementations
│   └── migrations.ts         # Sequential SQL migrations
├── index.ts                  # Factory: resolveStorageAdapter()
└── migrate-data.ts           # CLI data migration between backends
```

## Migration Strategy

| Backend | Approach |
|---------|----------|
| SQLite (built-in) | Current sequential SQL migrations (`schema_migrations` table) |
| PostgreSQL | Drizzle-generated SQL migrations stored in plugin package |
| MongoDB | No schema migrations — index creation on startup |

### Data Migration CLI

```bash
luqen-dashboard migrate --from sqlite --to postgres
```

- Reads all tables from SQLite
- Writes to Postgres via plugin adapter
- Validates row counts match
- Idempotent (safe to re-run)
- Supports `--dry-run` for verification

## Implementation Order

1. **Define interfaces** — `StorageAdapter` + all 11 `Repository` interfaces + shared types
2. **Refactor ScanDb** — split into SQLite repositories implementing the interfaces (no behavior change)
3. **Wire up** — `resolveStorageAdapter()` factory, update server.ts to use adapter
4. **Build Postgres plugin** — Drizzle schema, pg connection pool, all repositories
5. **Build MongoDB plugin** — native driver, all repositories, index setup
6. **Data migration CLI** — `migrate --from --to` command
7. **Tests** — adapter-agnostic test suite that runs against all backends

## Testing Strategy

A shared test suite that runs against each adapter:

```typescript
function testScanRepository(createAdapter: () => Promise<StorageAdapter>) {
  it('creates and retrieves a scan', async () => { ... });
  it('filters by status', async () => { ... });
  it('stores and retrieves JSON report', async () => { ... });
  // ... all 15 ScanRepository methods tested
}

// Run against each backend
describe('SQLite', () => testScanRepository(createSqliteAdapter));
describe('Postgres', () => testScanRepository(createPostgresAdapter));
describe('MongoDB', () => testScanRepository(createMongoAdapter));
```

## Backward Compatibility

- Default behavior unchanged — SQLite works out of the box
- Existing `dashboard.db` file continues to work
- No migration required for existing users
- Plugin activation is opt-in
- API and UI are DB-agnostic — no user-facing changes

## Out of Scope

- MySQL plugin (future — Drizzle supports it, community contribution)
- Multi-master replication
- Sharding
- Read replicas (could be added to Postgres plugin config later)
