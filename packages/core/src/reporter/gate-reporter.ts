/**
 * Gate reporter: formats the plain-text gate summary for console output.
 *
 * D-17: Output MUST NOT assert conformance. The forbidden word list is in 79-CONTEXT.md D-17.
 * Clean run prints EXACTLY "No new findings vs baseline."
 *
 * No I/O, no ANSI codes — pure string builder.
 */

import type { BaselineDiff } from '../baseline/diff.js';
import type { BaselineFinding } from '../baseline/baseline.js';

const DIVIDER = '─'.repeat(37);

/**
 * Format the CLI gate summary output.
 *
 * @param diff - result from diffBaseline()
 * @param baselinePath - path to the baseline file (for display)
 * @returns plain-text summary string (caller uses console.log)
 */
export function formatGateSummary(diff: BaselineDiff, baselinePath: string): string {
  const lines: string[] = [
    DIVIDER,
    'Luqen accessibility gate',
    `Baseline: ${baselinePath}`,
    DIVIDER,
    `  New findings:      ${diff.newFindings.length}`,
    `  Fixed findings:    ${diff.fixedFindings.length}`,
    `  Unchanged:        ${diff.unchanged.length}`,
    DIVIDER,
  ];

  if (diff.newFindings.length > 0) {
    lines.push('New findings (action required):');
    for (const finding of diff.newFindings) {
      lines.push(formatFindingRow(finding));
    }
    lines.push(DIVIDER);
  } else {
    // D-17: clean-run line — EXACT wording locked, never assert conformance
    lines.push('No new findings vs baseline.');
    lines.push(DIVIDER);
  }

  return lines.join('\n');
}

/**
 * Format a single finding row.
 * Layout: `  [severity]  WCAG-code  selector  message`
 * Two-space indent, no ANSI.
 */
function formatFindingRow(finding: BaselineFinding): string {
  return `  [${finding.type}]  ${finding.code}  ${finding.selector}  ${finding.message}`;
}
