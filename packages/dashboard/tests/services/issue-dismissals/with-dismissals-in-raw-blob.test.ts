/**
 * Phase 88 Plan 04: the row's raw `jsonReport` follows the filtered report, but only
 * when a dismissal actually applied (identity otherwise, SC5).
 */
import { describe, expect, it } from 'vitest';
import { withDismissalsInRawBlob } from '../../../src/services/issue-dismissals/load-dismissed-report.js';

const row = { id: 'scan-1', jsonReport: '{"raw":true}' } as const;
const occurrence = { issue: {}, pageUrl: 'https://fabrikam.example/' } as never;

describe('withDismissalsInRawBlob', () => {
  it('returns the caller own row object when nothing was dismissed', () => {
    const out = withDismissalsInRawBlob(row, { report: { filtered: true }, dismissed: [] });
    expect(out).toBe(row);
  });

  it('returns the caller own row object when the row has no raw blob', () => {
    const noBlob = { id: 'scan-2' };
    const out = withDismissalsInRawBlob(noBlob, { report: { filtered: true }, dismissed: [occurrence] });
    expect(out).toBe(noBlob);
  });

  it('replaces the raw blob by the filtered report JSON without mutating the row', () => {
    const out = withDismissalsInRawBlob(row, { report: { filtered: true }, dismissed: [occurrence] });
    expect(out).not.toBe(row);
    expect(out.jsonReport).toBe('{"filtered":true}');
    expect(row.jsonReport).toBe('{"raw":true}');
    expect(out.id).toBe('scan-1');
  });
});
