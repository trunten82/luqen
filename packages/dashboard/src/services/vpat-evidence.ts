import type { ManualTestEvidenceRecord } from '../db/types.js';
import type { VpatReport } from './vpat-service.js';

/**
 * VPAT/ACR manual-test evidence artifacts (extends Slice C, which only surfaced
 * the per-criterion evidence COUNT in the remarks). This module groups the
 * actual uploaded files per criterion so the web VPAT and the PDF ACR can render
 * them — image thumbnails + document filename links — as a defensible,
 * evidenced testing record (US-lawsuit-protection direction).
 *
 * Pure + deterministic: no filesystem access. The web renderer fetches files via
 * the public `filePath` (`/uploads/...`); the PDF renderer resolves the on-disk
 * path from `filePath` itself.
 */

/** A single evidence file attached to a WCAG criterion. */
export interface VpatEvidenceItem {
  /** Original (sanitised) display filename. */
  readonly fileName: string;
  /** Public URL path under /uploads/... where the file is served. */
  readonly filePath: string;
  /** Stored MIME type (null when unknown). */
  readonly mimeType: string | null;
  /** True for image MIME types — rendered as a thumbnail in the web VPAT. */
  readonly isImage: boolean;
}

/** All evidence files recorded for one criterion. */
export interface VpatEvidenceGroup {
  /** WCAG success-criterion id (e.g. "1.1.1"); matches VpatRow.criterion. */
  readonly criterion: string;
  /** Human-readable criterion title, resolved from the VPAT rows ('' if absent). */
  readonly title: string;
  readonly items: readonly VpatEvidenceItem[];
}

/** Image MIME types that render as a thumbnail in the web VPAT. */
function isImageMime(mime: string | null): boolean {
  return mime !== null && mime.startsWith('image/');
}

/**
 * Group manual-test evidence records by criterion, resolving each criterion's
 * title from the VPAT rows. Criteria with no evidence are omitted. Groups are
 * sorted by criterion id (numeric-aware), and items keep their upload order
 * (the repository already returns them ordered by criterion then upload time).
 */
export function buildVpatEvidenceGroups(
  evidence: readonly ManualTestEvidenceRecord[],
  vpat: Pick<VpatReport, 'tablesByLevel'>,
): VpatEvidenceGroup[] {
  // Title lookup from the assembled VPAT rows (criterion id → title).
  const titleByCriterion = new Map<string, string>();
  for (const table of vpat.tablesByLevel) {
    for (const row of table.rows) {
      titleByCriterion.set(row.criterion, row.title);
    }
  }

  const byCriterion = new Map<string, VpatEvidenceItem[]>();
  for (const e of evidence) {
    const items = byCriterion.get(e.criterionId) ?? [];
    items.push({
      fileName: e.fileName,
      filePath: e.filePath,
      mimeType: e.mimeType,
      isImage: isImageMime(e.mimeType),
    });
    byCriterion.set(e.criterionId, items);
  }

  return [...byCriterion.entries()]
    .map(([criterion, items]) => ({
      criterion,
      title: titleByCriterion.get(criterion) ?? '',
      items,
    }))
    .sort((a, b) => a.criterion.localeCompare(b.criterion, undefined, { numeric: true }));
}
