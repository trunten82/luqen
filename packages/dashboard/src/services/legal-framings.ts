/**
 * Jurisdiction-driven legal framing for the VPAT / ACR.
 *
 * The report's legal context must reflect WHAT THE USER SELECTED for the scan
 * (jurisdictions + regulations), not a hardcoded US frame. Given the scan's
 * selected jurisdiction/regulation tokens, this pure module returns the ordered
 * legal-framing blocks to render, whether a Functional Performance table applies
 * (Section 508 §302 / EN 301 549 clause 4 share that concept), and the
 * "standards assessed" label for the attestation.
 *
 * LEGAL DEFENSIBILITY: every block is descriptive context, never a conformance
 * claim. When nothing distinctive matches, a generic block still lists exactly
 * what the user selected — so the report is always accurate and never silently
 * US-framed.
 *
 * Pure, side-effect-free — unit-tests deterministically.
 */

export interface LegalFraming {
  /** Stable id (for keys/tests). */
  readonly id: string;
  /** Section heading, e.g. "ADA Title II & Title III context". */
  readonly heading: string;
  /** One-paragraph descriptive body. */
  readonly body: string;
  /** Short label for the attestation "standards assessed" line. */
  readonly shortLabel: string;
}

export interface LegalFramingResult {
  readonly framings: readonly LegalFraming[];
  /**
   * Whether to render the Functional Performance table. True when Section 508
   * (§302) or EN 301 549 (clause 4 Functional Performance Statements) applies —
   * both express the same holistic, assistive-tech outcomes.
   */
  readonly includeFunctionalPerformance: boolean;
  /** Heading for the Functional Performance table when included. */
  readonly functionalPerformanceHeading: string;
  /** "Standards assessed" label for the attestation block. */
  readonly standardsLabel: string;
}

interface FramingDef {
  readonly id: string;
  readonly keywords: readonly string[];
  readonly heading: string;
  readonly body: string;
  readonly shortLabel: string;
  /** Implies the Functional Performance table. */
  readonly fpc?: boolean;
}

/**
 * Catalog of legal framings. Matched case-insensitively against the combined
 * jurisdiction + regulation tokens of the scan. Order here is render order.
 */
const FRAMINGS: readonly FramingDef[] = [
  {
    id: 'us-508',
    keywords: ['508'],
    heading: 'Section 508 conformance',
    body:
      'Revised Section 508 (36 CFR 1194, Appendix A) incorporates WCAG 2.0 Level A and AA by reference for '
      + 'electronic content (E205.4), so the WCAG conformance tables above constitute the Section 508 '
      + 'success-criteria evidence. The Functional Performance Criteria (§302) describe holistic outcomes for '
      + 'users with specific disabilities.',
    shortLabel: 'Section 508 (Revised)',
    fpc: true,
  },
  {
    id: 'us-ada',
    keywords: ['ada'],
    heading: 'ADA Title II & Title III context',
    body:
      'U.S. courts and the Department of Justice have repeatedly treated WCAG 2.x Level AA as the practical '
      + 'benchmark for the Americans with Disabilities Act, although the ADA itself names no single technical '
      + 'standard. Title III applies to private places of public accommodation; Title II applies to state and '
      + 'local government, for which the DOJ 2024 rule formally adopts WCAG 2.1 Level AA. This report supports a '
      + 'good-faith, documented remediation effort; it is not legal advice and does not certify compliance.',
    shortLabel: 'ADA Title II & III',
  },
  {
    id: 'us-unruh',
    keywords: ['unruh'],
    heading: 'California Unruh Civil Rights Act context',
    body:
      'California’s Unruh Civil Rights Act is frequently invoked in website-accessibility litigation, often '
      + 'alongside the ADA, and California courts commonly reference WCAG 2.x Level AA. This report documents a '
      + 'good-faith remediation effort; it is not legal advice and does not certify compliance.',
    shortLabel: 'CA Unruh',
  },
  {
    id: 'eu-eaa',
    keywords: ['eaa', 'european accessibility act'],
    heading: 'European Accessibility Act (EAA) context',
    body:
      'The European Accessibility Act (Directive (EU) 2019/882) requires a range of products and services to be '
      + 'accessible from 28 June 2025. Conformance is demonstrated in practice against the harmonised standard '
      + 'EN 301 549, which incorporates WCAG 2.1 Level AA for web content. This report supports a good-faith '
      + 'effort toward those requirements; it is not legal advice and does not certify compliance.',
    shortLabel: 'EU EAA',
  },
  {
    id: 'eu-wad',
    keywords: ['wad', 'web accessibility directive'],
    heading: 'EU Web Accessibility Directive context',
    body:
      'The EU Web Accessibility Directive (2016/2102) requires public-sector websites and mobile apps to meet '
      + 'EN 301 549 (WCAG 2.1 AA) and to publish an accessibility statement. This report supports that obligation '
      + 'as a transparency and remediation document; it is not legal advice and does not certify compliance.',
    shortLabel: 'EU WAD',
  },
  {
    id: 'en-301-549',
    keywords: ['301 549', '301549', 'en301', 'en 301'],
    heading: 'EN 301 549 context',
    body:
      'EN 301 549 is the European harmonised accessibility standard. For web content it incorporates WCAG 2.1 '
      + 'Level AA, and its clause 4 sets out Functional Performance Statements describing outcomes for users with '
      + 'specific disabilities (closely mirroring Section 508 §302). The WCAG tables above constitute that evidence.',
    shortLabel: 'EN 301 549',
    fpc: true,
  },
  {
    id: 'uk-ea',
    keywords: ['equality act', 'uk-ea', 'psbar'],
    heading: 'UK Equality Act context',
    body:
      'In the UK the Equality Act 2010 requires reasonable adjustments so disabled people are not placed at a '
      + 'substantial disadvantage; WCAG 2.x Level AA is the widely accepted benchmark, and the public-sector '
      + 'PSBAR regulations require EN 301 549 / WCAG 2.1 AA. This report supports a good-faith effort; it is not '
      + 'legal advice and does not certify compliance.',
    shortLabel: 'UK Equality Act',
  },
  {
    id: 'ca-aoda',
    keywords: ['aoda', 'ontario'],
    heading: 'Ontario AODA context',
    body:
      'Ontario’s Accessibility for Ontarians with Disabilities Act (AODA) and its Integrated Accessibility '
      + 'Standards Regulation require designated organisations to meet WCAG 2.0 Level AA for web content. This '
      + 'report supports that obligation as a good-faith remediation document; it is not legal advice and does '
      + 'not certify compliance.',
    shortLabel: 'AODA',
  },
  {
    id: 'ca-aca',
    keywords: ['aca', 'accessible canada'],
    heading: 'Accessible Canada Act context',
    body:
      'The Accessible Canada Act requires federally regulated organisations to identify and remove accessibility '
      + 'barriers, with WCAG 2.x Level AA as the practical web benchmark. This report supports a good-faith '
      + 'effort; it is not legal advice and does not certify compliance.',
    shortLabel: 'Accessible Canada Act',
  },
  {
    id: 'fr-rgaa',
    keywords: ['rgaa'],
    heading: 'France RGAA context',
    body:
      'France’s Référentiel général d’amélioration de l’accessibilité '
      + '(RGAA) operationalises EN 301 549 / WCAG for public bodies and large companies, requiring an '
      + 'accessibility statement and declared conformance level. This report supports that obligation as a '
      + 'transparency and remediation document; it is not legal advice and does not certify compliance.',
    shortLabel: 'RGAA',
  },
  {
    id: 'de-bitv',
    keywords: ['bitv'],
    heading: 'Germany BITV 2.0 context',
    body:
      'Germany’s Barrierefreie-Informationstechnik-Verordnung (BITV 2.0) implements EN 301 549 / WCAG for '
      + 'public bodies. This report supports that obligation as a good-faith remediation document; it is not '
      + 'legal advice and does not certify compliance.',
    shortLabel: 'BITV 2.0',
  },
  {
    id: 'au-dda',
    keywords: ['dda', 'disability discrimination'],
    heading: 'Australia DDA context',
    body:
      'Australia’s Disability Discrimination Act 1992 underpins web-accessibility obligations, with WCAG 2.x '
      + 'Level AA adopted for government under the Digital Service Standard. This report supports a good-faith '
      + 'effort; it is not legal advice and does not certify compliance.',
    shortLabel: 'AU DDA',
  },
];

function normalise(tokens: readonly string[]): string[] {
  return tokens
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.toLowerCase());
}

/**
 * Derives the legal-framing blocks + functional-performance + standards label
 * from the scan's selected jurisdictions and regulations.
 */
export function deriveLegalFramings(
  jurisdictions: readonly string[] = [],
  regulations: readonly string[] = [],
): LegalFramingResult {
  const tokens = normalise([...jurisdictions, ...regulations]);
  const has = (def: FramingDef): boolean =>
    def.keywords.some((kw) => tokens.some((t) => t.includes(kw)));

  const matched = FRAMINGS.filter(has);

  // Fallback: nothing distinctive matched but the user still selected
  // something — surface exactly what they chose, never a US default.
  const framings: LegalFraming[] = matched.map((f) => ({
    id: f.id,
    heading: f.heading,
    body: f.body,
    shortLabel: f.shortLabel,
  }));

  if (framings.length === 0) {
    const selected = [...new Set([...jurisdictions, ...regulations])].filter(
      (s) => typeof s === 'string' && s.trim() !== '',
    );
    if (selected.length > 0) {
      framings.push({
        id: 'generic',
        heading: 'Applicable laws & standards',
        body:
          'This report was generated for the following selected jurisdictions and regulations: '
          + `${selected.join(', ')}. Conformance is assessed against WCAG; consult the applicable local `
          + 'standard for any jurisdiction-specific requirements. This report supports a good-faith remediation '
          + 'effort; it is not legal advice and does not certify compliance.',
        shortLabel: selected.join(', '),
      });
    }
  }

  const includeFunctionalPerformance = matched.some((f) => f.fpc === true);
  // Prefer the 508 label when present, else EN 301 549 phrasing.
  const has508 = matched.some((f) => f.id === 'us-508');
  const functionalPerformanceHeading = has508
    ? 'Section 508 — Functional Performance Criteria (§302)'
    : 'EN 301 549 — Functional Performance Statements (clause 4)';

  const shortLabels = framings.map((f) => f.shortLabel);
  const standardsLabel =
    shortLabels.length > 0
      ? `WCAG 2.2 (incl. 2.0/2.1) · ${shortLabels.join(' · ')}`
      : 'WCAG 2.2 (incl. 2.0/2.1)';

  return {
    framings,
    includeFunctionalPerformance,
    functionalPerformanceHeading,
    standardsLabel,
  };
}
