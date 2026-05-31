/**
 * Revised Section 508 (36 CFR 1194, Appendix A & C) framing for the VPAT / ACR.
 *
 * Section 508 incorporates WCAG 2.0 Level A and AA by reference for electronic
 * content (E205.4); the WCAG conformance tables already produced by the VPAT
 * therefore double as the Section 508 success-criteria evidence. What 508 adds
 * on top is Chapter 3 — the Functional Performance Criteria (§302) — which
 * describe holistic outcomes for users with specific disabilities rather than
 * individual technical checks.
 *
 * This module derives a conservative Functional Performance Criteria table from
 * the already-derived WCAG rows. It is deliberately ONE-DIRECTIONAL: a mapped
 * WCAG failure ESCALATES a functional-need row to "Does Not Support", but a
 * clean scan NEVER upgrades a row to "Supports" — functional performance is an
 * end-to-end, assistive-technology judgement that automated scanning cannot
 * make. This mirrors the legal-defensibility stance of vpat-service.ts: never
 * over-claim. An over-broad crosswalk is therefore conservative-safe — it can
 * only surface a problem, never hide one.
 *
 * Pure, side-effect-free — unit-tests deterministically.
 */

import type { VpatConformance, VpatRow } from './vpat-service.js';

export interface FunctionalPerformanceRow {
  readonly id: string;
  readonly need: string;
  readonly conformance: VpatConformance;
  readonly remarks: string;
  /** WCAG success criteria mapped to this functional need (for transparency). */
  readonly relatedCriteria: readonly string[];
}

export interface Section508Report {
  readonly functionalPerformance: readonly FunctionalPerformanceRow[];
}

interface FpcDefinition {
  readonly id: string;
  readonly need: string;
  readonly related: readonly string[];
}

/**
 * Functional Performance Criteria, Revised Section 508 §302.1–302.9, each mapped
 * to the WCAG 2.x success criteria most relevant to that functional need. The
 * crosswalk is used ONLY to escalate a row to "Does Not Support" when a mapped
 * criterion fails, so an over-broad mapping is conservative-safe.
 */
export const FUNCTIONAL_PERFORMANCE_CRITERIA: readonly FpcDefinition[] = [
  {
    id: '302.1',
    need: 'Without vision',
    related: [
      '1.1.1', '1.2.1', '1.2.3', '1.2.5', '1.3.1', '1.3.2', '1.3.3', '1.4.1',
      '2.1.1', '2.1.2', '2.4.1', '2.4.2', '2.4.3', '2.4.4', '2.4.6', '3.1.1',
      '3.1.2', '3.2.1', '3.2.2', '3.3.1', '3.3.2', '4.1.2',
    ],
  },
  {
    id: '302.2',
    need: 'With limited vision',
    related: ['1.4.3', '1.4.4', '1.4.5', '1.4.10', '1.4.11', '1.4.12', '1.4.13', '2.4.7'],
  },
  { id: '302.3', need: 'Without perception of color', related: ['1.3.3', '1.4.1'] },
  { id: '302.4', need: 'Without hearing', related: ['1.2.1', '1.2.2', '1.2.4', '1.4.2'] },
  { id: '302.5', need: 'With limited hearing', related: ['1.2.2', '1.2.4', '1.4.7'] },
  { id: '302.6', need: 'Without speech', related: [] },
  {
    id: '302.7',
    need: 'With limited manipulation',
    related: ['2.1.1', '2.1.2', '2.4.7', '2.5.1', '2.5.2', '2.5.4'],
  },
  {
    id: '302.8',
    need: 'With limited reach and strength',
    related: ['2.5.1', '2.5.2', '2.5.4'],
  },
  {
    id: '302.9',
    need: 'With limited language, cognitive, and learning abilities',
    related: [
      '1.3.1', '2.4.2', '2.4.6', '3.1.1', '3.1.2', '3.2.1', '3.2.2', '3.2.3',
      '3.2.4', '3.3.1', '3.3.2', '3.3.3', '3.3.4',
    ],
  },
];

const NOT_EVALUATED_REMARK =
  'Functional performance is an end-to-end outcome that requires manual testing with '
  + 'assistive technology (e.g. screen reader, magnification, voice control); automated '
  + 'scanning alone cannot confirm it.';

const NO_SPEECH_REMARK =
  'The evaluated web content does not require speech for operation; end-to-end confirmation '
  + 'still requires manual testing.';

/**
 * Derives a conservative Section 508 Functional Performance Criteria table from
 * the WCAG rows produced by buildVpat.
 */
export function deriveSection508(rows: readonly VpatRow[]): Section508Report {
  const doesNotSupport = new Set(
    rows.filter((r) => r.conformance === 'Does Not Support').map((r) => r.criterion),
  );

  const functionalPerformance: FunctionalPerformanceRow[] = FUNCTIONAL_PERFORMANCE_CRITERIA.map(
    (fpc) => {
      const failing = fpc.related.filter((c) => doesNotSupport.has(c));
      if (failing.length > 0) {
        return {
          id: fpc.id,
          need: fpc.need,
          conformance: 'Does Not Support' as VpatConformance,
          remarks:
            `Related success criteria not supported: ${failing.join(', ')}. `
            + 'End-to-end confirmation requires manual testing with assistive technology.',
          relatedCriteria: fpc.related,
        };
      }
      return {
        id: fpc.id,
        need: fpc.need,
        conformance: 'Not Evaluated' as VpatConformance,
        remarks: fpc.related.length === 0 ? NO_SPEECH_REMARK : NOT_EVALUATED_REMARK,
        relatedCriteria: fpc.related,
      };
    },
  );

  return { functionalPerformance };
}
