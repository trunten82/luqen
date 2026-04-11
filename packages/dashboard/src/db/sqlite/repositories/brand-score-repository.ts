import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  BrandScoreRepository,
  BrandScoreScanContext,
  BrandScoreHistoryEntry,
} from '../../interfaces/brand-score-repository.js';
import type {
  ScoreResult,
  SubScore,
  CoverageProfile,
} from '../../../services/scoring/types.js';
import { brandScoreRowToResult } from './brand-score-row-mapper.js';

// ---------------------------------------------------------------------------
// Private row type — mirrors brand_scores column layout from migration 043
// ---------------------------------------------------------------------------

interface BrandScoreRow {
  id: string;
  scan_id: string;
  org_id: string;
  site_url: string;
  guideline_id: string | null;
  guideline_version: number | null;
  overall: number | null;
  color_contrast: number | null;
  typography: number | null;
  components: number | null;
  coverage_profile: string;
  subscore_details: string | null;
  unscorable_reason: string | null;
  brand_related_count: number;
  total_issues: number;
  mode: string;
  computed_at: string;
}

// ---------------------------------------------------------------------------
// Sentinel CoverageProfile for top-level unscorable rows
// ---------------------------------------------------------------------------

const UNSCORABLE_COVERAGE_PROFILE: CoverageProfile = {
  color: false,
  typography: false,
  components: false,
  contributingWeight: 0,
};

// ---------------------------------------------------------------------------
// Row -> ScoreResult mapping is imported from brand-score-row-mapper.ts
// (Phase 18-05 — extracted so the scan-repository LEFT JOIN trend path uses
// the exact same reconstruction logic. See that file for D-13 / D-15 notes.)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ScoreResult -> row column values mapping
// ---------------------------------------------------------------------------

interface InsertColumnValues {
  id: string;
  scan_id: string;
  org_id: string;
  site_url: string;
  guideline_id: string | null;
  guideline_version: number | null;
  overall: number | null;
  color_contrast: number | null;
  typography: number | null;
  components: number | null;
  coverage_profile: string;
  subscore_details: string | null;
  unscorable_reason: string | null;
  brand_related_count: number;
  total_issues: number;
  mode: string;
  computed_at: string;
}

function subValueOrNull(sub: SubScore): number | null {
  return sub.kind === 'scored' ? sub.value : null;
}

function buildInsertColumns(
  result: ScoreResult,
  context: BrandScoreScanContext,
): InsertColumnValues {
  const id = randomUUID();
  const computedAt = new Date().toISOString();
  const base = {
    id,
    scan_id: context.scanId,
    org_id: context.orgId,
    site_url: context.siteUrl,
    guideline_id: context.guidelineId ?? null,
    guideline_version: context.guidelineVersion ?? null,
    brand_related_count: context.brandRelatedCount,
    total_issues: context.totalIssues,
    mode: context.mode,
    computed_at: computedAt,
  };

  if (result.kind === 'scored') {
    return {
      ...base,
      overall: result.overall,
      color_contrast: subValueOrNull(result.color),
      typography: subValueOrNull(result.typography),
      components: subValueOrNull(result.components),
      coverage_profile: JSON.stringify(result.coverage),
      subscore_details: JSON.stringify({
        color: result.color,
        typography: result.typography,
        components: result.components,
      }),
      unscorable_reason: null,
    };
  }

  return {
    ...base,
    overall: null,
    color_contrast: null,
    typography: null,
    components: null,
    coverage_profile: JSON.stringify(UNSCORABLE_COVERAGE_PROFILE),
    subscore_details: null,
    unscorable_reason: result.reason,
  };
}

// ---------------------------------------------------------------------------
// SqliteBrandScoreRepository
// ---------------------------------------------------------------------------

const INSERT_SQL = `
INSERT INTO brand_scores (
  id, scan_id, org_id, site_url, guideline_id, guideline_version,
  overall, color_contrast, typography, components,
  coverage_profile, subscore_details, unscorable_reason,
  brand_related_count, total_issues, mode, computed_at
) VALUES (
  @id, @scan_id, @org_id, @site_url, @guideline_id, @guideline_version,
  @overall, @color_contrast, @typography, @components,
  @coverage_profile, @subscore_details, @unscorable_reason,
  @brand_related_count, @total_issues, @mode, @computed_at
)
`;

// ORDER BY includes `rowid DESC` as a deterministic tie-breaker. SQLite's
// implicit ROWID is monotonic across inserts on the same table, so when two
// rows share `computed_at` (millisecond-resolution ISO timestamps can collide
// on same-millisecond appends — e.g. a retag that fires two insert() calls
// back-to-back) the most-recently-inserted row is still returned first. This
// preserves the append-only "latest row wins" contract without requiring
// sub-millisecond timestamp precision.
const SELECT_BY_SCAN_SQL = `
SELECT * FROM brand_scores WHERE scan_id = ? ORDER BY computed_at DESC, rowid DESC LIMIT 1
`;

const SELECT_HISTORY_FOR_SITE_SQL = `
SELECT * FROM brand_scores WHERE org_id = ? AND site_url = ? ORDER BY computed_at DESC, rowid DESC LIMIT ?
`;

export class SqliteBrandScoreRepository implements BrandScoreRepository {
  constructor(private readonly db: Database.Database) {}

  async insert(result: ScoreResult, context: BrandScoreScanContext): Promise<void> {
    const cols = buildInsertColumns(result, context);
    this.db.prepare(INSERT_SQL).run(cols);
  }

  async getLatestForScan(scanId: string): Promise<ScoreResult | null> {
    const row = this.db.prepare(SELECT_BY_SCAN_SQL).get(scanId) as BrandScoreRow | undefined;
    if (row === undefined) {
      return null;
    }
    return brandScoreRowToResult(row);
  }

  async getHistoryForSite(
    orgId: string,
    siteUrl: string,
    limit: number,
  ): Promise<readonly BrandScoreHistoryEntry[]> {
    const rows = this.db
      .prepare(SELECT_HISTORY_FOR_SITE_SQL)
      .all(orgId, siteUrl, limit) as BrandScoreRow[];
    return rows.map((row) => ({
      computedAt: row.computed_at,
      result: brandScoreRowToResult(row),
    }));
  }
}
