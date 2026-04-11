import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { MigrationRunner, DASHBOARD_MIGRATIONS } from '../../src/db/sqlite/migrations.js';

interface PragmaTableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface PragmaIndexListRow {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface PragmaIndexInfoRow {
  seqno: number;
  cid: number;
  name: string;
}

function makeMigratedDb(): Database.Database {
  // Use :memory: for speed; brand_scores does not require WAL or persistence
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  new MigrationRunner(db).run(DASHBOARD_MIGRATIONS);
  return db;
}

describe('migration 043 — brand-scores-and-org-branding-mode', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeMigratedDb();
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // brand_scores table existence + structure
  // -------------------------------------------------------------------------

  it('creates the brand_scores table', () => {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='brand_scores'")
      .all();
    expect(rows).toHaveLength(1);
  });

  it('has the locked column structure with nullable score columns (Pitfall #3)', () => {
    const cols = db.prepare("PRAGMA table_info('brand_scores')").all() as PragmaTableInfoRow[];
    const byName = new Map(cols.map((c) => [c.name, c]));

    // Identifiers + relations
    // Note: SQLite's PRAGMA table_info reports notnull=0 for `TEXT PRIMARY KEY`
    // columns because SQLite preserves a historic quirk where non-INTEGER primary
    // keys do not imply NOT NULL. The PK constraint (pk=1) is what enforces
    // uniqueness; the repository is the only writer and always supplies an id.
    expect(byName.get('id')?.pk).toBe(1);
    expect(byName.get('scan_id')?.notnull).toBe(1);
    expect(byName.get('org_id')?.notnull).toBe(1);
    expect(byName.get('site_url')?.notnull).toBe(1);
    expect(byName.get('guideline_id')?.notnull).toBe(0);
    expect(byName.get('guideline_version')?.notnull).toBe(0);

    // Score columns — MUST be nullable (D-06, Pitfall #3)
    expect(byName.get('overall')?.type).toBe('INTEGER');
    expect(byName.get('overall')?.notnull).toBe(0);
    expect(byName.get('color_contrast')?.type).toBe('INTEGER');
    expect(byName.get('color_contrast')?.notnull).toBe(0);
    expect(byName.get('typography')?.type).toBe('INTEGER');
    expect(byName.get('typography')?.notnull).toBe(0);
    expect(byName.get('components')?.type).toBe('INTEGER');
    expect(byName.get('components')?.notnull).toBe(0);

    // Coverage profile — non-null JSON blob
    expect(byName.get('coverage_profile')?.type).toBe('TEXT');
    expect(byName.get('coverage_profile')?.notnull).toBe(1);

    // SubScoreDetail round-trip column (research-gap closure)
    expect(byName.get('subscore_details')?.type).toBe('TEXT');
    expect(byName.get('subscore_details')?.notnull).toBe(0); // NULL when top-level unscorable

    // Unscorable reason — nullable enum stored as TEXT
    expect(byName.get('unscorable_reason')?.type).toBe('TEXT');
    expect(byName.get('unscorable_reason')?.notnull).toBe(0);

    // Counters (always present, even on unscorable rows)
    expect(byName.get('brand_related_count')?.notnull).toBe(1);
    expect(byName.get('brand_related_count')?.dflt_value).toBe('0');
    expect(byName.get('total_issues')?.notnull).toBe(1);
    expect(byName.get('total_issues')?.dflt_value).toBe('0');

    // Mode + timestamp
    expect(byName.get('mode')?.notnull).toBe(1);
    expect(byName.get('computed_at')?.notnull).toBe(1);

    // Total expected columns
    expect(cols).toHaveLength(17);
  });

  // -------------------------------------------------------------------------
  // Indexes
  // -------------------------------------------------------------------------

  it('creates both required indexes on brand_scores', () => {
    const indexes = db.prepare("PRAGMA index_list('brand_scores')").all() as PragmaIndexListRow[];
    const names = indexes.map((i) => i.name).sort();
    expect(names).toContain('idx_brand_scores_scan');
    expect(names).toContain('idx_brand_scores_org_site');
  });

  it('idx_brand_scores_org_site indexes (org_id, site_url, computed_at) in that order', () => {
    const cols = db
      .prepare("PRAGMA index_info('idx_brand_scores_org_site')")
      .all() as PragmaIndexInfoRow[];
    expect(cols).toHaveLength(3);
    expect(cols[0].name).toBe('org_id');
    expect(cols[1].name).toBe('site_url');
    expect(cols[2].name).toBe('computed_at');
  });

  // -------------------------------------------------------------------------
  // organizations.branding_mode
  // -------------------------------------------------------------------------

  it('adds branding_mode column to organizations with default embedded', () => {
    const cols = db.prepare("PRAGMA table_info('organizations')").all() as PragmaTableInfoRow[];
    const brandingMode = cols.find((c) => c.name === 'branding_mode');
    expect(brandingMode).toBeDefined();
    expect(brandingMode?.notnull).toBe(1);
    // SQLite stores TEXT defaults wrapped in single quotes
    expect(brandingMode?.dflt_value).toBe("'embedded'");
  });

  it('applies the embedded default to a freshly inserted organization row', () => {
    const orgId = randomUUID();
    db.prepare(
      "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
    ).run(orgId, 'Acme', 'acme-' + orgId.slice(0, 8), new Date().toISOString());
    const row = db
      .prepare('SELECT branding_mode FROM organizations WHERE id = ?')
      .get(orgId) as { branding_mode: string } | undefined;
    expect(row?.branding_mode).toBe('embedded');
  });

  // -------------------------------------------------------------------------
  // Idempotency
  // -------------------------------------------------------------------------

  it('is idempotent — re-running DASHBOARD_MIGRATIONS does not re-execute 043', () => {
    // First run already happened in beforeEach. Second run must not throw.
    expect(() => new MigrationRunner(db).run(DASHBOARD_MIGRATIONS)).not.toThrow();
    const rows = db
      .prepare("SELECT COUNT(*) as n FROM schema_migrations WHERE id = '043'")
      .get() as { n: number };
    expect(rows.n).toBe(1);
  });

  // -------------------------------------------------------------------------
  // No backfill — existing scan_records are untouched
  // -------------------------------------------------------------------------

  it('does not touch existing scan_records rows (no backfill)', () => {
    // Build a parallel DB, insert a scan_record BEFORE 043 runs, then run 043
    // and assert the row is byte-identical.
    const parallel = new Database(':memory:');
    parallel.pragma('foreign_keys = ON');

    // Run all migrations EXCEPT 043
    const through042 = DASHBOARD_MIGRATIONS.filter((m) => m.id !== '043');
    new MigrationRunner(parallel).run(through042);

    const scanId = randomUUID();
    const createdAt = new Date().toISOString();
    // Note: scan_records.regulations was added by migration 039; this insert relies on
    // running the full DASHBOARD_MIGRATIONS array (which always includes 039 → 042 → 043).
    parallel.prepare(
      `INSERT INTO scan_records (id, site_url, status, standard, jurisdictions, regulations, created_by, created_at)
       VALUES (?, ?, 'completed', 'WCAG2AA', '[]', '[]', ?, ?)`,
    ).run(scanId, 'https://example.com', 'tester', createdAt);

    const before = parallel.prepare('SELECT * FROM scan_records WHERE id = ?').get(scanId);

    // Now run 043 on top
    new MigrationRunner(parallel).run(DASHBOARD_MIGRATIONS);

    const after = parallel.prepare('SELECT * FROM scan_records WHERE id = ?').get(scanId);

    expect(after).toEqual(before);
    parallel.close();
  });

  // -------------------------------------------------------------------------
  // CHECK constraint on mode
  // -------------------------------------------------------------------------

  it('rejects invalid mode values via CHECK constraint', () => {
    // Bootstrap a scan_records row to satisfy the FK
    const scanId = randomUUID();
    db.prepare(
      `INSERT INTO scan_records (id, site_url, status, standard, jurisdictions, regulations, created_by, created_at)
       VALUES (?, ?, 'completed', 'WCAG2AA', '[]', '[]', ?, ?)`,
    ).run(scanId, 'https://example.com', 'tester', new Date().toISOString());

    expect(() =>
      db.prepare(
        `INSERT INTO brand_scores
          (id, scan_id, org_id, site_url, coverage_profile, brand_related_count, total_issues, mode, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        scanId,
        'org-1',
        'https://example.com',
        '{}',
        0,
        0,
        'remote-but-typo', // invalid
        new Date().toISOString(),
      ),
    ).toThrow(/CHECK constraint/i);
  });

  // -------------------------------------------------------------------------
  // Foreign key cascade
  // -------------------------------------------------------------------------

  it('cascades brand_scores rows when scan_records row is deleted', () => {
    const scanId = randomUUID();
    db.prepare(
      `INSERT INTO scan_records (id, site_url, status, standard, jurisdictions, regulations, created_by, created_at)
       VALUES (?, ?, 'completed', 'WCAG2AA', '[]', '[]', ?, ?)`,
    ).run(scanId, 'https://example.com', 'tester', new Date().toISOString());

    const brandId = randomUUID();
    db.prepare(
      `INSERT INTO brand_scores
        (id, scan_id, org_id, site_url, coverage_profile, brand_related_count, total_issues, mode, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      brandId,
      scanId,
      'org-1',
      'https://example.com',
      '{"color":true,"typography":true,"components":true,"contributingWeight":1.0}',
      5,
      10,
      'embedded',
      new Date().toISOString(),
    );

    db.prepare('DELETE FROM scan_records WHERE id = ?').run(scanId);

    const remaining = db
      .prepare('SELECT COUNT(*) as n FROM brand_scores WHERE id = ?')
      .get(brandId) as { n: number };
    expect(remaining.n).toBe(0);
  });
});
