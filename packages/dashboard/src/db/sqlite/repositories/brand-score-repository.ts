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
  UnscorableReason,
} from '../../../services/scoring/types.js';

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
// UnscorableReason literal whitelist (D-15 — defensive guard against schema
// drift; the SQLite column is plain TEXT so a bad write would otherwise be
// silently round-tripped)
// ---------------------------------------------------------------------------

const KNOWN_UNSCORABLE_REASONS: ReadonlySet<UnscorableReason> = new Set<UnscorableReason>([
  'no-guideline',
  'empty-guideline',
  'no-branded-issues',
  'no-typography-data',
  'no-component-tokens',
  'all-subs-unscorable',
]);

function assertUnscorableReason(value: string | null): UnscorableReason {
  if (value === null) {
    throw new Error('brand_scores row has NULL score columns but NULL unscorable_reason');
  }
  if (!KNOWN_UNSCORABLE_REASONS.has(value as UnscorableReason)) {
    throw new Error(`brand_scores row has unknown unscorable_reason: ${value}`);
  }
  return value as UnscorableReason;
}

// ---------------------------------------------------------------------------
// Row -> ScoreResult mapping
// ---------------------------------------------------------------------------

function rowToScoreResult(row: BrandScoreRow): ScoreResult {
  // A row is a top-level "scored" ScoreResult iff `overall` AND `subscore_details`
  // are both non-null. The per-dimension score columns (color_contrast, typography,
  // components) are denormalized caches of `subscore_details.*.value` for the
  // scored-sub case and are legitimately NULL when a nested sub-score is itself
  // unscorable (Phase 15 D-13 — the discriminated-union `SubScore` allows any
  // dimension to be unscorable inside an otherwise scored top-level result).
  // `subscore_details` is the authoritative per-dimension source on read.
  const isTopLevelScored = row.overall !== null && row.subscore_details !== null;

  if (!isTopLevelScored) {
    return {
      kind: 'unscorable',
      reason: assertUnscorableReason(row.unscorable_reason),
    };
  }

  // Type-narrowing assertions (already proven by the conjunction above)
  const overall = row.overall as number;
  const subscoreDetails = JSON.parse(row.subscore_details as string) as {
    color: SubScore;
    typography: SubScore;
    components: SubScore;
  };
  const coverage = JSON.parse(row.coverage_profile) as CoverageProfile;

  return {
    kind: 'scored',
    overall,
    color: subscoreDetails.color,
    typography: subscoreDetails.typography,
    components: subscoreDetails.components,
    coverage,
  };
}

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
    return rowToScoreResult(row);
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
      result: rowToScoreResult(row),
    }));
  }
}
