/**
 * Accessibility Statement derivation.
 *
 * Pure, side-effect-free: given an org's statement config and an optional VPAT
 * report (built from the latest scan of the covered site), it produces the
 * view-model for a public, hostable accessibility statement.
 *
 * LEGAL DEFENSIBILITY: this never claims "fully conformant", "100%", or
 * "lawsuit-proof". It frames the site as *partially conformant* and surfaces
 * known limitations + criteria still pending manual evaluation, plus a
 * barrier-report channel that routes to the ORGANISATION. That honest,
 * good-faith framing is the point — an over-claim is the liability.
 */

import type { VpatReport, VpatRow } from './vpat-service.js';
import type { AccessibilityStatementRecord } from '../db/interfaces/accessibility-statement-repository.js';

export type ConformanceStatus = 'partially-conformant' | 'not-conformant';

export interface StatementLimitation {
  readonly criterion: string;
  readonly title: string;
  readonly conformance: 'Does Not Support' | 'Partially Supports';
  readonly remarks: string;
}

export interface AccessibilityStatementView {
  readonly entityName: string;
  readonly siteUrl: string;
  /** e.g. "WCAG 2.1 level AA". */
  readonly standardLabel: string;
  readonly wcagVersion: string;
  readonly wcagLevel: string;
  readonly conformanceStatus: ConformanceStatus;
  readonly knownLimitations: readonly StatementLimitation[];
  /** True when a scan informed this statement. */
  readonly hasAssessment: boolean;
  /** Scan date (ISO YYYY-MM-DD) when available. */
  readonly assessmentDate?: string;
  /** Statement publication date (ISO YYYY-MM-DD). */
  readonly statementDate: string;
  readonly contactEmail?: string;
  readonly contactUrl?: string;
  /** Public link to the org's full ACR/VPAT, shown as a "View our ACR" link. */
  readonly acrUrl?: string;
  /** Custom remediation-commitment prose; empty → template uses the default. */
  readonly commitment: string;
  /** Criteria that automated testing alone cannot confirm (pending manual review). */
  readonly notEvaluatedCount: number;
  readonly summary?: VpatReport['summary'];
}

export interface BuildStatementOptions {
  /** ISO date string (YYYY-MM-DD). Injectable for deterministic tests. */
  readonly generatedAt?: string;
  /** ISO date string (YYYY-MM-DD) of the assessment scan. */
  readonly assessmentDate?: string;
}

/** Cap the public limitations list so a noisy scan can't produce an endless page. */
const MAX_LIMITATIONS = 50;

function isLimitation(row: VpatRow): boolean {
  return row.conformance === 'Does Not Support' || row.conformance === 'Partially Supports';
}

/**
 * Builds the accessibility-statement view-model from config + an optional VPAT.
 */
export function buildAccessibilityStatement(
  config: AccessibilityStatementRecord,
  vpat: VpatReport | null,
  opts: BuildStatementOptions = {},
): AccessibilityStatementView {
  const generatedAt = opts.generatedAt ?? new Date().toISOString().slice(0, 10);
  const wcagVersion = config.wcagVersion || '2.1';
  const wcagLevel = config.wcagLevel || 'AA';

  const knownLimitations: StatementLimitation[] = vpat
    ? vpat.tablesByLevel
        .flatMap((t) => t.rows)
        .filter(isLimitation)
        .slice(0, MAX_LIMITATIONS)
        .map((r) => ({
          criterion: r.criterion,
          title: r.title,
          conformance: r.conformance as 'Does Not Support' | 'Partially Supports',
          remarks: r.remarks,
        }))
    : [];

  // Conservative status: only claim *partial* conformance when the assessment
  // shows the site supports at least some criteria. With no support evidence
  // (or no assessment yet), do not claim conformance.
  const supports = vpat?.summary.supports ?? 0;
  const conformanceStatus: ConformanceStatus =
    vpat !== null && supports > 0 ? 'partially-conformant' : 'not-conformant';

  return {
    entityName: (config.entityName ?? '').trim() || config.orgId,
    siteUrl: config.siteUrl ?? '',
    standardLabel: `WCAG ${wcagVersion} level ${wcagLevel}`,
    wcagVersion,
    wcagLevel,
    conformanceStatus,
    knownLimitations,
    hasAssessment: vpat !== null,
    statementDate: generatedAt,
    commitment: (config.commitment ?? '').trim(),
    notEvaluatedCount: vpat?.summary.notEvaluated ?? 0,
    ...(opts.assessmentDate !== undefined ? { assessmentDate: opts.assessmentDate } : {}),
    ...(config.contactEmail !== undefined ? { contactEmail: config.contactEmail } : {}),
    ...(config.contactUrl !== undefined ? { contactUrl: config.contactUrl } : {}),
    ...(config.acrUrl !== undefined && config.acrUrl.trim() !== '' ? { acrUrl: config.acrUrl.trim() } : {}),
    ...(vpat !== null ? { summary: vpat.summary } : {}),
  };
}
