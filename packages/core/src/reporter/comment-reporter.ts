/**
 * PR comment Markdown builder — produces the GitHub-flavored Markdown body
 * for the sticky accessibility gate PR comment.
 *
 * D-12: First line is exactly `<!-- luqen-gate -->` (upsert marker).
 * D-17: Output MUST NOT assert conformance.
 * See 79-CONTEXT.md D-17 for the full forbidden-string list (enforced by tests).
 * The disclaimer blockquote is emitted on EVERY variant (clean, findings, infra-error).
 *
 * Pure string builder — no I/O, no network, no ANSI codes.
 */

import type { BaselineDiff } from '../baseline/diff.js';
import type { BaselineFinding } from '../baseline/baseline.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Enrichment entries per finding code.
 * Matches the structure of `ComplianceEnrichment.issueAnnotations` from types.ts.
 */
export interface EnrichmentEntry {
  readonly jurisdictionName: string;
  readonly obligation?: string;
  readonly regulationName?: string;
}

/** Map from WCAG code to list of jurisdiction enrichment entries. */
export type EnrichmentByCode = ReadonlyMap<string, readonly EnrichmentEntry[]>;

/** The diff shape that the gate-output JSON may contain. */
interface DiffWithInfraError extends Omit<BaselineDiff, never> {
  readonly infraError?: boolean;
}

// ---------------------------------------------------------------------------
// Disclaimer (D-17 — mandatory on every variant)
// ---------------------------------------------------------------------------

const DISCLAIMER = '> Not legal advice. This report identifies new accessibility findings vs the stored baseline.\n> A zero-new result does not assert conformance.';

// ---------------------------------------------------------------------------
// formatPrComment
// ---------------------------------------------------------------------------

/**
 * Build the GitHub-Markdown PR comment body.
 *
 * @param diff           - BaselineDiff from `--gate-output` (may include `infraError: true`)
 * @param enrichmentByCode - Map of WCAG code → jurisdiction entries (empty = no enrichment)
 * @param baselinePath   - Path to baseline file (for display context)
 * @returns GitHub-Markdown string; first line is `<!-- luqen-gate -->`
 */
export function formatPrComment(
  diff: DiffWithInfraError,
  enrichmentByCode: EnrichmentByCode,
  baselinePath: string,
): string {
  const parts: string[] = [];

  // D-12: marker MUST be first line
  parts.push('<!-- luqen-gate -->');
  parts.push('## Luqen accessibility gate');
  parts.push('');

  // Handle infra-error case (degraded state — D-10)
  if ((diff as DiffWithInfraError & { infraError?: boolean }).infraError) {
    return formatInfraErrorBody(parts);
  }

  // Counts table
  parts.push('| | Count |');
  parts.push('|---|---|');
  parts.push(`| New findings | ${diff.newFindings.length} |`);
  parts.push(`| Fixed findings | ${diff.fixedFindings.length} |`);
  parts.push(`| Unchanged | ${diff.unchanged.length} |`);
  parts.push('');

  // Disclaimer (D-17 — always present)
  parts.push(DISCLAIMER);
  parts.push('');

  // Clean-run variant (no new findings)
  if (diff.newFindings.length === 0) {
    // D-17: exact wording locked
    let headline = 'No new findings vs baseline.';
    if (diff.fixedFindings.length > 0) {
      headline += ` ${diff.fixedFindings.length} previously recorded finding${diff.fixedFindings.length === 1 ? '' : 's'} remain${diff.fixedFindings.length === 1 ? 's' : ''} fixed.`;
    }
    parts.push(headline);

    return parts.join('\n');
  }

  // Findings variant — new findings details
  parts.push('<details>');
  parts.push(`<summary>New findings — ${diff.newFindings.length} (review required)</summary>`);
  parts.push('');
  parts.push('| Severity | WCAG | Selector | Finding | Jurisdiction context |');
  parts.push('|----------|------|----------|---------|---------------------|');
  for (const finding of diff.newFindings) {
    const severity = capitalize(finding.type);
    const wcag = extractWcagCode(finding.code);
    const selector = `\`${finding.selector}\``;
    const message = escapeTableCell(finding.message);
    const jurisdiction = formatJurisdictionCell(finding.code, enrichmentByCode);
    parts.push(`| ${severity} | ${wcag} | ${selector} | ${message} | ${jurisdiction} |`);
  }
  parts.push('');
  parts.push('</details>');
  parts.push('');

  // Fixed findings details
  if (diff.fixedFindings.length > 0) {
    parts.push('<details>');
    parts.push(`<summary>Fixed findings — ${diff.fixedFindings.length} (resolved vs baseline)</summary>`);
    parts.push('');
    parts.push('| WCAG | Selector | Finding |');
    parts.push('|------|----------|---------|');
    for (const finding of diff.fixedFindings) {
      const wcag = extractWcagCode(finding.code);
      const selector = `\`${finding.selector}\``;
      const message = escapeTableCell(finding.message);
      parts.push(`| ${wcag} | ${selector} | ${message} |`);
    }
    parts.push('');
    parts.push('</details>');
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Infra-error body (degraded state)
// ---------------------------------------------------------------------------

function formatInfraErrorBody(headerParts: string[]): string {
  const parts = [...headerParts];
  parts.push('Gate could not complete — scan engine or baseline unavailable.');
  parts.push('');
  parts.push(DISCLAIMER);
  parts.push('');
  parts.push('> Treat this run as unresolved until the gate can complete successfully.');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a short human-readable WCAG code from the full pa11y code string. */
function extractWcagCode(code: string): string {
  // Pa11y codes like: WCAG2AA.Principle1.Guideline1_1.1_1_1.H37
  // Extract the dotted numeric portion (e.g. "1.1.1")
  const match = code.match(/\b(\d+(?:\.\d+)+)\b(?!.*\d+(?:\.\d+)+\b)/);
  if (match) return match[1];
  // Fallback: return the last segment of the dot-separated code
  const parts = code.split('.');
  return parts[parts.length - 1] ?? code;
}

/** Format a jurisdiction cell for a finding code. */
function formatJurisdictionCell(
  code: string,
  enrichmentByCode: EnrichmentByCode,
): string {
  const entries = enrichmentByCode.get(code);
  if (!entries || entries.length === 0) {
    return 'No jurisdiction mapping for this criterion';
  }

  // Build a compact summary: "JurisdictionName: framing; ..."
  const parts = entries
    .filter((e) => e.obligation === 'mandatory' || !e.obligation)
    .slice(0, 3) // cap at 3 jurisdictions to keep table readable
    .map((e) => {
      const name = e.jurisdictionName;
      const reg = e.regulationName ? ` (${e.regulationName})` : '';
      return `${name}${reg}`;
    });

  if (parts.length === 0) {
    return 'No jurisdiction mapping for this criterion';
  }

  return parts.join('; ');
}

/** Capitalize first letter only. */
function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Escape pipe characters in table cell text to prevent breaking GFM table layout.
 * Also escape newlines.
 */
function escapeTableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
