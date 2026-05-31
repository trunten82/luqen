/**
 * Pure mapping from a Lighthouse accessibility result (LHR) to shared Issues.
 *
 * Kept free of any browser / Lighthouse runtime so it can be unit-tested in the
 * fast (non-browser) vitest tier. The runner (`./index.ts`) feeds the LHR's
 * `audits` map into {@link mapLighthouseAudits}.
 *
 * Conservative-by-design (matches the project's legal-defensibility stance):
 *  - Only AUDITS THAT ACTUALLY FAILED are mapped (score !== 1 with a binary or
 *    numeric scoreDisplayMode). `notApplicable`, `informative`, `manual` and
 *    passing audits are skipped.
 *  - An audit is only emitted when its id maps to a known WCAG criterion in
 *    {@link AUDIT_WCAG_MAP}. Unknown audits are skipped rather than emitted with
 *    an unattributable criterion.
 */

import type { Issue } from '../types.js';

/** Max nodes (details.items) emitted per failing audit, to avoid flooding. */
export const MAX_NODES_PER_AUDIT = 25;

/**
 * Lighthouse accessibility audit id → WCAG success criterion (underscore form).
 *
 * The criterion is embedded into the emitted Issue `code` so the downstream
 * `extractCriterion()` regex maps it. Most of these audits are axe-core rules
 * surfaced by Lighthouse's accessibility category.
 */
export const AUDIT_WCAG_MAP: Readonly<Record<string, string>> = {
  // Non-text content / images
  'image-alt': '1_1_1',
  'input-image-alt': '1_1_1',
  'object-alt': '1_1_1',
  'area-alt': '1_1_1',
  // Page / document structure
  'document-title': '2_4_2',
  'html-has-lang': '3_1_1',
  'html-lang-valid': '3_1_1',
  'valid-lang': '3_1_2',
  // Contrast
  'color-contrast': '1_4_3',
  // Forms / labels (Info and Relationships + Name, Role, Value)
  label: '1_3_1',
  'form-field-multiple-labels': '1_3_1',
  'select-name': '4_1_2',
  // Links / buttons (names)
  'link-name': '2_4_4',
  'button-name': '4_1_2',
  // ARIA (Name, Role, Value)
  'aria-allowed-attr': '4_1_2',
  'aria-allowed-role': '4_1_2',
  'aria-command-name': '4_1_2',
  'aria-dialog-name': '4_1_2',
  'aria-hidden-body': '4_1_2',
  'aria-hidden-focus': '4_1_2',
  'aria-input-field-name': '4_1_2',
  'aria-meter-name': '4_1_2',
  'aria-progressbar-name': '4_1_2',
  'aria-required-attr': '4_1_2',
  'aria-required-children': '1_3_1',
  'aria-required-parent': '1_3_1',
  'aria-roles': '4_1_2',
  'aria-text': '4_1_2',
  'aria-toggle-field-name': '4_1_2',
  'aria-tooltip-name': '4_1_2',
  'aria-treeitem-name': '4_1_2',
  'aria-valid-attr': '4_1_2',
  'aria-valid-attr-value': '4_1_2',
  // Lists / structure (Info and Relationships)
  list: '1_3_1',
  listitem: '1_3_1',
  'definition-list': '1_3_1',
  dlitem: '1_3_1',
  'heading-order': '1_3_1',
  'th-has-data-cells': '1_3_1',
  'td-headers-attr': '1_3_1',
  'table-fake-caption': '1_3_1',
  'table-duplicate-name': '1_3_1',
  // Identifiers / parsing (Name, Role, Value)
  'duplicate-id-active': '4_1_2',
  'duplicate-id-aria': '4_1_2',
  // Zoom / reflow / resize text
  'meta-viewport': '1_4_4',
  // Bypass blocks
  bypass: '2_4_1',
  // Order / tabindex
  tabindex: '2_4_3',
  // Frames (alternative text / titles)
  'frame-title': '4_1_2',
  // Video / audio captions
  'video-caption': '1_2_2',
  // Definition / accesskeys
  accesskeys: '4_1_2',
};

/** A node entry inside a Lighthouse audit's `details.items`. */
interface LhAuditNode {
  readonly node?: {
    readonly selector?: string;
    readonly snippet?: string;
    readonly nodeLabel?: string;
    readonly explanation?: string;
  };
  readonly selector?: string;
  readonly snippet?: string;
}

/** A single audit entry from an LHR `audits` map. */
export interface LhAudit {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  readonly score?: number | null;
  readonly scoreDisplayMode?: string;
  readonly details?: {
    readonly items?: readonly LhAuditNode[];
  };
}

/** Truncate a snippet/context to a bounded length. */
function clip(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/**
 * Decide whether an audit represents a genuine FAILURE worth emitting.
 *
 * Lighthouse marks non-applicable / informative / manual audits with a
 * `scoreDisplayMode` that is NOT a pass/fail signal — those are skipped. Only
 * `binary` and `numeric` audits carry a real score, and a failure is score < 1.
 */
function isFailedAudit(audit: LhAudit): boolean {
  const mode = audit.scoreDisplayMode;
  if (mode !== 'binary' && mode !== 'numeric') return false;
  if (typeof audit.score !== 'number') return false;
  return audit.score < 1;
}

/** Build the per-node Issue list for one failing audit. */
function issuesForAudit(audit: LhAudit, criterion: string): Issue[] {
  const code = `Luqen.Lighthouse.${criterion}.${audit.id}`;
  const baseMessage = audit.title?.trim() || audit.id;
  const description = audit.description?.trim();
  const message = description ? `${baseMessage} — ${clip(description, 240)}` : baseMessage;

  const items = audit.details?.items ?? [];
  if (items.length === 0) {
    // No node-level detail — emit a single page-level finding.
    return [
      {
        type: 'error',
        code,
        message,
        selector: 'html',
        context: '<html>',
        runner: 'lighthouse',
      },
    ];
  }

  const out: Issue[] = [];
  for (const item of items.slice(0, MAX_NODES_PER_AUDIT)) {
    const selector = item.node?.selector ?? item.selector ?? 'html';
    const snippet = item.node?.snippet ?? item.snippet ?? '';
    out.push({
      type: 'error',
      code,
      message,
      selector: selector || 'html',
      context: snippet ? clip(snippet) : '',
      runner: 'lighthouse',
    });
  }
  return out;
}

/**
 * Map an LHR `audits` map to the shared Issue list.
 *
 * Pure: no I/O, no globals. Only failed, attributable audits become Issues.
 */
export function mapLighthouseAudits(
  audits: Readonly<Record<string, LhAudit>> | undefined,
): Issue[] {
  if (!audits) return [];
  const out: Issue[] = [];
  for (const audit of Object.values(audits)) {
    if (!audit || typeof audit.id !== 'string') continue;
    if (!isFailedAudit(audit)) continue;
    const criterion = AUDIT_WCAG_MAP[audit.id];
    if (!criterion) continue; // Unattributable — skip (conservative).
    out.push(...issuesForAudit(audit, criterion));
  }
  return out;
}
