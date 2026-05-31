import { describe, it, expect } from 'vitest';
import {
  deriveSection508,
  FUNCTIONAL_PERFORMANCE_CRITERIA,
} from '../../src/services/section508.js';
import type { VpatRow } from '../../src/services/vpat-service.js';

// Minimal VpatRow factory — deriveSection508 only reads `criterion` + `conformance`.
function row(criterion: string, conformance: VpatRow['conformance']): VpatRow {
  return {
    criterion,
    title: `Criterion ${criterion}`,
    level: 'A',
    version: '2.1',
    url: `https://example.com/${criterion}`,
    conformance,
    remarks: '',
  };
}

describe('deriveSection508', () => {
  it('returns all nine Functional Performance Criteria (§302.1–302.9)', () => {
    const { functionalPerformance } = deriveSection508([]);
    expect(functionalPerformance).toHaveLength(9);
    expect(functionalPerformance.map((f) => f.id)).toEqual([
      '302.1', '302.2', '302.3', '302.4', '302.5', '302.6', '302.7', '302.8', '302.9',
    ]);
  });

  it('marks every functional need "Not Evaluated" on a clean scan — never "Supports"', () => {
    // Even when every mapped criterion is recorded as Supports, functional
    // performance is a holistic outcome that automation cannot confirm.
    const cleanRows = FUNCTIONAL_PERFORMANCE_CRITERIA.flatMap((fpc) =>
      fpc.related.map((c) => row(c, 'Supports')),
    );
    const { functionalPerformance } = deriveSection508(cleanRows);
    for (const f of functionalPerformance) {
      expect(f.conformance).toBe('Not Evaluated');
    }
    expect(functionalPerformance.some((f) => f.conformance === 'Supports')).toBe(false);
  });

  it('escalates a functional need to "Does Not Support" when a mapped WCAG criterion fails', () => {
    // 1.1.1 maps to 302.1 (Without vision) but NOT to 302.2 (limited vision).
    const { functionalPerformance } = deriveSection508([row('1.1.1', 'Does Not Support')]);
    const withoutVision = functionalPerformance.find((f) => f.id === '302.1');
    const limitedVision = functionalPerformance.find((f) => f.id === '302.2');

    expect(withoutVision?.conformance).toBe('Does Not Support');
    expect(withoutVision?.remarks).toContain('1.1.1');
    expect(limitedVision?.conformance).toBe('Not Evaluated');
  });

  it('does not escalate for non-failure conformance values (warnings, NA, not-evaluated)', () => {
    const { functionalPerformance } = deriveSection508([
      row('1.4.3', 'Partially Supports'),
      row('1.4.4', 'Not Applicable'),
      row('1.4.10', 'Not Evaluated'),
    ]);
    // 302.2 maps to all three above — none is a "Does Not Support" failure.
    const limitedVision = functionalPerformance.find((f) => f.id === '302.2');
    expect(limitedVision?.conformance).toBe('Not Evaluated');
  });

  it('treats 302.6 (Without speech) as not requiring speech, pending manual testing', () => {
    const speech = deriveSection508([]).functionalPerformance.find((f) => f.id === '302.6');
    expect(speech?.relatedCriteria).toEqual([]);
    expect(speech?.conformance).toBe('Not Evaluated');
    expect(speech?.remarks.toLowerCase()).toContain('speech');
  });

  it('exposes the WCAG crosswalk on each row for transparency', () => {
    const withoutVision = deriveSection508([]).functionalPerformance.find((f) => f.id === '302.1');
    expect(withoutVision?.relatedCriteria).toContain('1.1.1');
    expect(withoutVision?.relatedCriteria).toContain('4.1.2');
  });

  it('lists every failing mapped criterion in the remark', () => {
    const { functionalPerformance } = deriveSection508([
      row('1.1.1', 'Does Not Support'),
      row('1.3.1', 'Does Not Support'),
    ]);
    const withoutVision = functionalPerformance.find((f) => f.id === '302.1');
    expect(withoutVision?.remarks).toContain('1.1.1');
    expect(withoutVision?.remarks).toContain('1.3.1');
  });
});
