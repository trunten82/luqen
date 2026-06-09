/**
 * Deterministic legal-exposure indicator for the VPAT / ACR workflow.
 *
 * Given a scan's open findings (by severity) + selected jurisdictions /
 * regulations, returns a conservative ordinal exposure band with the
 * drivers that determined it.
 *
 * LEGAL DEFENSIBILITY: The indicator reflects EXPOSURE only — never
 * "compliant", never "lawsuit-proof", never asserting fault. It is
 * framed as a transparency aid and is not legal advice.
 *
 * NOTE: The forbidden words (compliant, 100%, pass, lawsuit-proof,
 * will be sued, fault, guarantee) appear ONLY in this documentation
 * comment as the exhaustive list of terms that are prohibited from
 * all user-facing strings — they must NEVER appear in DISCLAIMER_TEXT
 * or any driver param value.
 *
 * Pure, side-effect-free — unit-tests deterministically.
 */

// ---------------------------------------------------------------------------
// Exported Types
// ---------------------------------------------------------------------------

/** Ordinal exposure band — never a number or percentage (D-01). */
export type ExposureBand = 'lower' | 'moderate' | 'elevated' | 'high';

/** A single transparent driver that contributed to the band. */
export interface ExposureDriver {
  /** Stable key used as i18n lookup, e.g. 'eaaInEffect', 'highFilingState'. */
  readonly key: string;
  /** Interpolation params for the i18n driver label template. */
  readonly params: Record<string, string>;
}

/**
 * The result of `deriveExposure`. Band is the only verdict — no numeric
 * score, percentage, or value field (D-01 enforcement).
 */
export interface ExposureResult {
  readonly band: ExposureBand;
  readonly drivers: readonly ExposureDriver[];
  /** ISO date string of the static data tables this computation is based on. */
  readonly asOf: string;
  /** Fixed disclaimer text — always present, never omitted. */
  readonly disclaimer: string;
}

/** Input shape for `deriveExposure`. Mirrors ScanRecord's stored fields. */
export interface ExposureInput {
  readonly jurisdictions: readonly string[];
  readonly regulations: readonly string[];
  /**
   * Finding counts by severity level using the REAL scan-store vocabulary
   * (ScanRecord.errors / .warnings / .notices + confirmedViolations).
   * Zero values are allowed.
   */
  readonly findings: {
    readonly errors: number;
    readonly warnings: number;
    readonly notices: number;
    readonly confirmedViolations: number;
  };
}

// ---------------------------------------------------------------------------
// Static constants — documented, dated, source-noted (D-03)
// ---------------------------------------------------------------------------

/**
 * The canonical disclaimer text rendered on every exposure indicator surface.
 * UI-SPEC Copywriting Contract, `exposure.disclaimer` key.
 */
export const DISCLAIMER_TEXT =
  'This is a legal exposure indicator, not legal advice. '
  + 'It reflects publicly known regulatory timelines and filing patterns. '
  + 'For legal questions, consult a qualified attorney.';

/**
 * ISO date when the static driver tables in this module were last reviewed.
 * Update this constant when refreshing the tables (D-03).
 */
export const DATA_AS_OF = '2026-06-07';

/**
 * EAA enforcement date — Directive (EU) 2019/882, effective 28 Jun 2025.
 * Already in effect as of DATA_AS_OF; contributes a 'high' band.
 */
export const EAA_DATE = '2025-06-28';

// ---------------------------------------------------------------------------
// Internal type for the static jurisdiction/regulation driver catalog
// ---------------------------------------------------------------------------

interface JurisdictionDriver {
  readonly id: string;
  /** Case-insensitive substrings matched against normalised tokens. */
  readonly keywords: readonly string[];
  /**
   * Band contribution — the highest contribution across all matched entries
   * forms the jurisdiction contribution to the final band.
   */
  readonly contribution: 'high' | 'elevated';
  /** Maps to ExposureDriver.key for i18n. */
  readonly driverKey: string;
  /** Fixed params to include with every emission of this driver. */
  readonly fixedParams?: Record<string, string>;
  /** ISO date when this entry was last reviewed. */
  readonly asOf: string;
  /** Source note (not user-facing). */
  readonly sourceNote: string;
}

/**
 * High-exposure jurisdiction drivers — coarse high/elevated classification.
 * Deliberately NOT a precise lawsuit count to avoid false-precision and
 * legal-advice framing (D-03: static, documented, dated).
 *
 * Sources reviewed as of DATA_AS_OF (2026-06-07):
 *   - EU/EAA: Directive (EU) 2019/882, in effect 28 Jun 2025.
 *   - New York: Consistently highest US ADA web-accessibility filing volume.
 *   - Florida: Second-highest US ADA web-accessibility filing volume.
 *   - Illinois: IITAA + ADA filing patterns; notably active plaintiff bar.
 *   - California: Unruh Act + ADA overlap; elevated but lower than NY/FL/IL.
 */
const HIGH_EXPOSURE_JURISDICTIONS: readonly JurisdictionDriver[] = [
  {
    id: 'eu-eaa',
    keywords: ['eaa', 'european accessibility act', 'eu-eaa', 'eu'],
    contribution: 'high',
    driverKey: 'eaaInEffect',
    fixedParams: { date: '28 Jun 2025' },
    asOf: DATA_AS_OF,
    sourceNote: 'Directive (EU) 2019/882 — in effect 28 Jun 2025',
  },
  {
    id: 'us-ny',
    keywords: ['us-ny', 'new york', 'us-ny-web', 'us-ny-nyc'],
    contribution: 'high',
    driverKey: 'highFilingState',
    fixedParams: { name: 'New York' },
    asOf: DATA_AS_OF,
    sourceNote: 'New York — highest US ADA web-accessibility filing volume (coarse classification)',
  },
  {
    id: 'us-fl',
    keywords: ['us-fl', 'florida'],
    contribution: 'high',
    driverKey: 'highFilingState',
    fixedParams: { name: 'Florida' },
    asOf: DATA_AS_OF,
    sourceNote: 'Florida — second-highest US ADA web-accessibility filing volume (coarse classification)',
  },
  {
    id: 'us-il',
    keywords: ['us-il', 'illinois', 'iitaa'],
    contribution: 'high',
    driverKey: 'highFilingState',
    fixedParams: { name: 'Illinois' },
    asOf: DATA_AS_OF,
    sourceNote: 'Illinois — IITAA + notable ADA plaintiff activity (coarse classification)',
  },
  {
    id: 'us-ca',
    keywords: ['us-ca', 'california', 'unruh'],
    contribution: 'elevated',
    driverKey: 'elevatedFilingState',
    fixedParams: { name: 'California' },
    asOf: DATA_AS_OF,
    sourceNote: 'California — Unruh Act + ADA overlap; elevated filing activity (coarse classification)',
  },
];

/**
 * ADA Title II entity-size deadline tiers (§35.200 rule, 2024 final rule).
 * When entity size is unknown, the conservative default is the SOONEST applicable
 * deadline (large entity tier) — lean conservative (D-03).
 *
 * Sources: 89 Fed. Reg. 31320 (Apr 24 2024); reviewed 2026-06-07.
 */
interface AdaTitleIiTier {
  /** Human-readable tier label. */
  readonly label: string;
  /** ISO deadline date. */
  readonly date: string;
  readonly asOf: string;
}

/**
 * ADA Title II deadline tiers — static dated constants.
 * Thresholds: documented severity-weighted finding pressure table (D-03).
 *
 *   Large entities (pop ≥ 50,000 or budget ≥ $100M)         → 2026-04-24
 *   Mid-size entities (pop 10,000–49,999 or mid budget)      → 2027-04-26
 *   Small entities (pop < 10,000 / special district / other) → 2028-04-26
 *   Unknown / conservative default (soonest)                 → 2026-04-24
 */
const ADA_TITLE_II_DEADLINES: {
  readonly large: AdaTitleIiTier;
  readonly mid: AdaTitleIiTier;
  readonly small: AdaTitleIiTier;
  readonly conservativeDefault: AdaTitleIiTier;
} = {
  large: {
    label: 'Large entity (pop ≥ 50,000)',
    date: '2026-04-24',
    asOf: DATA_AS_OF,
  },
  mid: {
    label: 'Mid-size entity (pop 10,000–49,999)',
    date: '2027-04-26',
    asOf: DATA_AS_OF,
  },
  small: {
    label: 'Small entity (pop < 10,000)',
    date: '2028-04-26',
    asOf: DATA_AS_OF,
  },
  /**
   * When entity size is not known, use the SOONEST deadline — most conservative.
   */
  conservativeDefault: {
    label: 'Unknown entity size (conservative — earliest deadline)',
    date: '2026-04-24',
    asOf: DATA_AS_OF,
  },
} as const;

/** ADA Title II token patterns for normalised token matching. */
const ADA_TITLE_II_KEYWORDS = [
  'ada title ii',
  'ada-t2',
  'us-ada-t2',
  'ada t2',
  'title ii',
];

// ---------------------------------------------------------------------------
// Finding-pressure threshold table (D-02, D-03 — documented inline)
// ---------------------------------------------------------------------------

/**
 * Severity-weighted finding-pressure computation.
 *
 * Weights (documented, auditable):
 *   confirmedViolations  ×  10   (mandatory failures — highest weight)
 *   errors               ×   3   (scan-level errors)
 *   warnings             ×   1   (warnings)
 *   notices              ×   0.1  (informational, low weight)
 *
 * Band buckets (documented threshold table):
 *   pressureScore === 0                   → 'lower'
 *   0 < pressureScore < 15                → 'moderate'
 *   15 ≤ pressureScore < 40               → 'elevated'
 *   pressureScore ≥ 40                    → 'high'
 *
 * These thresholds are intentionally conservative — a modest number of
 * confirmed violations or errors moves the band up quickly.
 */
function computeFindingPressureBand(findings: ExposureInput['findings']): ExposureBand {
  const pressureScore =
    findings.confirmedViolations * 10
    + findings.errors * 3
    + findings.warnings * 1
    + findings.notices * 0.1;

  if (pressureScore === 0) return 'lower';
  if (pressureScore < 15) return 'moderate';
  if (pressureScore < 40) return 'elevated';
  return 'high';
}

// ---------------------------------------------------------------------------
// Ordinal band helpers
// ---------------------------------------------------------------------------

const BAND_ORDINAL: Record<ExposureBand, number> = {
  lower: 0,
  moderate: 1,
  elevated: 2,
  high: 3,
};

function maxBand(a: ExposureBand, b: ExposureBand): ExposureBand {
  return BAND_ORDINAL[a] >= BAND_ORDINAL[b] ? a : b;
}

// ---------------------------------------------------------------------------
// normalise() — copied verbatim from legal-framings.ts
// ---------------------------------------------------------------------------

function normalise(tokens: readonly string[]): string[] {
  return tokens
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.toLowerCase());
}

// ---------------------------------------------------------------------------
// deriveExposure — the single exported pure function
// ---------------------------------------------------------------------------

/**
 * Derives the conservative legal-exposure band for a scan.
 *
 * Inputs: open finding counts by severity + scan jurisdiction/regulation tokens.
 * Output: { band, drivers, asOf, disclaimer } — immutable, serialisable.
 *
 * The final band is the MAX (ordinal) of:
 *   (a) jurisdiction-applicability contribution (matching HIGH_EXPOSURE_JURISDICTIONS)
 *   (b) finding-pressure contribution (severity-weighted, threshold-bucketed)
 *
 * ADA Title II countdown driver is always emitted when an ADA Title II token
 * matches, regardless of its effect on the band.
 */
export function deriveExposure(input: ExposureInput): ExposureResult {
  const tokens = normalise([...input.jurisdictions, ...input.regulations]);

  const drivers: ExposureDriver[] = [];
  let jurisdictionBand: ExposureBand = 'lower';

  // ── Jurisdiction applicability ──────────────────────────────────────────
  for (const entry of HIGH_EXPOSURE_JURISDICTIONS) {
    const matched = entry.keywords.some((kw) => tokens.some((t) => t.includes(kw)));
    if (matched) {
      drivers.push({
        key: entry.driverKey,
        params: { ...(entry.fixedParams ?? {}) },
      });
      jurisdictionBand = maxBand(jurisdictionBand, entry.contribution);
    }
  }

  // ── ADA Title II deadline proximity ────────────────────────────────────
  const adaT2Matched = ADA_TITLE_II_KEYWORDS.some((kw) =>
    tokens.some((t) => t.includes(kw)),
  );
  if (adaT2Matched) {
    const tier = ADA_TITLE_II_DEADLINES.conservativeDefault;
    // Compare deadline to DATA_AS_OF (deterministic — no Date.now())
    const deadlineMs = new Date(tier.date).getTime();
    const asOfMs = new Date(DATA_AS_OF).getTime();
    const daysRemaining = Math.ceil((deadlineMs - asOfMs) / (1000 * 60 * 60 * 24));

    if (daysRemaining > 0) {
      drivers.push({
        key: 'adaTitleIiCountdown',
        params: {
          date: tier.date,
          days: String(daysRemaining),
        },
      });
    } else {
      drivers.push({
        // Key 'adaTitleIiDeadlineExpired' — renamed to avoid the word 'pass'
        // as a substring (D-07 forbidden-words check covers driver keys).
        // i18n key 'exposure.driver.adaTitleIiDeadlineExpired' maps to
        // "ADA Title II deadline: {{date}} (deadline expired)".
        key: 'adaTitleIiDeadlineExpired',
        params: {
          date: tier.date,
        },
      });
    }
  }

  // ── Finding pressure ────────────────────────────────────────────────────
  const findingBand = computeFindingPressureBand(input.findings);

  // ── Final band = MAX of jurisdiction + finding pressure ─────────────────
  const band = maxBand(jurisdictionBand, findingBand);

  return {
    band,
    drivers: [...drivers],
    asOf: DATA_AS_OF,
    disclaimer: DISCLAIMER_TEXT,
  };
}
