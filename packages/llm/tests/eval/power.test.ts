/**
 * `power.test.ts` — Phase 85 Task 2: pinning the hand-rolled arithmetic.
 *
 * Three independent kinds of pin, because each catches something the others
 * cannot (85-02-PLAN.md Task 2):
 *   1. Closed-form values a reader can confirm with a calculator, no
 *      reference implementation — fair-coin binomial masses (exact rationals
 *      over powers of two) and the zero-event / b=n-1 closed forms.
 *   2. A cited external source — the SAME rule-of-three source
 *      85-RESEARCH.md already retrieved and verified (Wikipedia, "Rule of
 *      three (statistics)"), used as an asymptotic cross-check against the
 *      exact closed form. This module does not have live web access in this
 *      execution session; it reuses the citation this repository already
 *      vetted rather than inventing an unverifiable external digit — see
 *      85-02-SUMMARY.md for the documented reasoning.
 *   3. Property checks that hold regardless of the specific numbers: the
 *      bound satisfies its own defining equation, the CDF is monotone and
 *      reaches one, the achieved power falls as assumed discordance rises,
 *      the difference bound is non-decreasing in the baseline-better count
 *      and INVARIANT to the candidate-better count, and the certifying
 *      decision is monotone.
 *
 * Then the REPRODUCTION pin: every achieved-power and false-reassurance
 * figure the committed bar file records — read from its STRUCTURED fields,
 * not its prose — must be reproduced by these functions, independently
 * derived from the formula (never by importing 85-01's scratch working).
 */
import { describe, it, expect } from 'vitest';
import { loadDecisionBars } from '../../src/eval/decision-bars.js';
import {
  binomialPmf,
  binomialCdf,
  zeroEventUpperBound,
  clopperPearsonUpperBound,
  computeDifferenceUpperBound,
  ruleOfThreeUpperBound,
  achievedPowerToCertifyIdentical,
  worstCaseFalseReassuranceRate,
} from '../../src/eval/power.js';

const PACKAGE_ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Pin type 1: closed-form / hand-checkable values
// ---------------------------------------------------------------------------

describe('power — closed-form pin: fair-coin binomial masses', () => {
  it('binomialPmf(n, k, 0.5) reproduces exact rationals over powers of two', () => {
    // n=4: Pascal's triangle row [1,4,6,4,1], denominator 16.
    expect(binomialPmf(4, 0, 0.5)).toBeCloseTo(1 / 16, 12);
    expect(binomialPmf(4, 1, 0.5)).toBeCloseTo(4 / 16, 12);
    expect(binomialPmf(4, 2, 0.5)).toBeCloseTo(6 / 16, 12);
    expect(binomialPmf(4, 3, 0.5)).toBeCloseTo(4 / 16, 12);
    expect(binomialPmf(4, 4, 0.5)).toBeCloseTo(1 / 16, 12);

    // n=10, k=5: C(10,5) = 252, denominator 1024.
    expect(binomialPmf(10, 5, 0.5)).toBeCloseTo(252 / 1024, 12);
  });

  it('binomialCdf reaches the whole-distribution endpoint of 1 at k=n, for any p', () => {
    for (const p of [0.01, 0.1, 0.25, 0.5, 0.75, 0.99]) {
      for (const n of [1, 5, 13, 17]) {
        expect(binomialCdf(n, n, p)).toBeCloseTo(1, 9);
      }
    }
  });

  it('binomialCdf(n, 0, p) is the single-term (1-p)^n, checkable by hand', () => {
    expect(binomialCdf(17, 0, 0.25)).toBeCloseTo(Math.pow(0.75, 17), 12);
    expect(binomialCdf(13, 0, 0.25)).toBeCloseTo(Math.pow(0.75, 13), 12);
  });

  it('zeroEventUpperBound(n) reproduces the closed form 1 - alpha^(1/n)', () => {
    for (const n of [7, 13, 17, 20, 30]) {
      expect(zeroEventUpperBound(n)).toBeCloseTo(1 - Math.pow(0.05, 1 / n), 12);
    }
  });

  it('clopperPearsonUpperBound at b=n-1 matches the OTHER exact closed form: (1-alpha)^(1/n)', () => {
    // Beta(b+1, n-b) at b=n-1 is Beta(n, 1), whose CDF is x^n -- solving
    // x^n = 1-alpha gives x = (1-alpha)^(1/n) directly, no bisection needed
    // to VERIFY it (the implementation still bisects; this is an independent
    // closed-form check of the bisection's output at a second point, not
    // just the b=0 case).
    for (const n of [5, 10, 17]) {
      const expected = Math.pow(0.95, 1 / n);
      expect(clopperPearsonUpperBound(n - 1, n)).toBeCloseTo(expected, 6);
    }
  });
});

// ---------------------------------------------------------------------------
// Pin type 2: cited external source (rule of three)
// ---------------------------------------------------------------------------

describe('power — cited pin: rule of three (Wikipedia "Rule of three (statistics)", cited in 85-RESEARCH.md)', () => {
  it('ruleOfThreeUpperBound reproduces its defining ratio 3/n for several sample sizes', () => {
    for (const n of [7, 10, 13, 17, 30, 100]) {
      expect(ruleOfThreeUpperBound(n)).toBeCloseTo(3 / n, 12);
    }
  });

  it('for the false-PASS opportunity count (n=7), the EXACT zero-event bound is BELOW the rule-of-three approximation, not above it', () => {
    expect(zeroEventUpperBound(7)).toBeLessThan(ruleOfThreeUpperBound(7));
  });

  it('the exact zero-event bound converges to the rule-of-three ratio as n grows (asymptotic cross-check)', () => {
    // ln(0.05) ≈ -2.9957 ≈ -3, so 1 - 0.05^(1/n) ≈ 3/n for large n.
    for (const n of [500, 2000, 10000]) {
      const exact = zeroEventUpperBound(n);
      const approx = ruleOfThreeUpperBound(n);
      expect(Math.abs(exact - approx) / approx).toBeLessThan(0.01);
    }
  });
});

// ---------------------------------------------------------------------------
// Pin type 3: property checks
// ---------------------------------------------------------------------------

describe('power — property pin: the bound satisfies its own defining equation', () => {
  it('clopperPearsonUpperBound(b, n) satisfies binomialCdf(n, b, U) ≈ alpha to a tight tolerance', () => {
    for (const [b, n] of [
      [0, 17],
      [1, 17],
      [2, 17],
      [5, 17],
      [0, 13],
      [1, 13],
      [3, 13],
    ] as const) {
      const u = clopperPearsonUpperBound(b, n);
      expect(binomialCdf(n, b, u)).toBeCloseTo(0.05, 6);
    }
  });
});

describe('power — property pin: CDF monotonicity', () => {
  it('binomialCdf(n, k, p) is non-decreasing in k', () => {
    for (const p of [0.1, 0.25, 0.5]) {
      for (const n of [13, 17]) {
        let previous = 0;
        for (let k = 0; k <= n; k++) {
          const current = binomialCdf(n, k, p);
          expect(current).toBeGreaterThanOrEqual(previous - 1e-12);
          previous = current;
        }
      }
    }
  });
});

describe('power — property pin: the difference bound is non-decreasing in b, and INVARIANT to the candidate-better count', () => {
  it('computeDifferenceUpperBound(b, n, margin).upperBound is non-decreasing in b', () => {
    for (const n of [13, 17]) {
      let previous = 0;
      for (let b = 0; b <= n; b++) {
        const { upperBound } = computeDifferenceUpperBound(b, n, 3);
        expect(upperBound).toBeGreaterThanOrEqual(previous - 1e-12);
        previous = upperBound;
      }
    }
  });

  it('is invariant to the candidate-better count -- a 5th call-site argument is silently ignored by JS UNLESS the implementation has grown a real parameter that reads it, which this probes for directly (A-8, A-1)', () => {
    const first = computeDifferenceUpperBound(3, 17, 3);

    // The declared call: no candidate-better count exists to pass.
    for (const hypotheticalCandidateBetterCount of [0, 5, 10]) {
      void hypotheticalCandidateBetterCount;
      expect(computeDifferenceUpperBound(3, 17, 3)).toEqual(first);
    }

    // THE LOAD-BEARING PROBE. A function called with MORE arguments than it
    // formally declares silently ignores the extras at the JS runtime level
    // -- UNLESS the implementation has grown a real 5th parameter that reads
    // one. This calls past the declared 4-argument signature on purpose
    // (hence the loose cast) specifically to detect that regression: if the
    // rejected conditional method's candidate-better-count parameter is ever
    // reintroduced and wired into the computation, THIS assertion is the one
    // that catches it, because the two calls below differ only in the 5th
    // (formally nonexistent) argument.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loose = computeDifferenceUpperBound as unknown as (...args: any[]) => typeof first;
    expect(loose(3, 17, 3, 0.05, 0)).toEqual(loose(3, 17, 3, 0.05, 15));
  });
});

describe('power — property pin: achieved power to certify a genuinely identical candidate DECREASES as assumed discordance rises', () => {
  it('is monotonically decreasing across the assumed discordant-pair rate', () => {
    const rates = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5];
    for (const n of [17, 13]) {
      let previous = 1;
      for (const rate of rates) {
        const power = achievedPowerToCertifyIdentical(n, 3, rate);
        expect(power).toBeLessThan(previous);
        previous = power;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// A-1: worst-case false-reassurance below 5% at the least favourable
// configuration -- the validity property the whole method was chosen for.
// ---------------------------------------------------------------------------

describe('power — A-1 validity: worst-case false-reassurance is below 5% by construction', () => {
  it('at the committed margin, n=17 (generate-fix) and n=13 (analyse-visual correct)', () => {
    expect(worstCaseFalseReassuranceRate(17, 3)).toBeLessThan(0.05);
    expect(worstCaseFalseReassuranceRate(13, 3)).toBeLessThan(0.05);
  });
});

// ---------------------------------------------------------------------------
// A-7: THE MARGIN IS NOT A BUDGET -- pinned as a test, not left to prose.
// The certifying set is EXACTLY the zero-baseline-better case, at both n.
// ---------------------------------------------------------------------------

describe('power — A-7: the certifying set at the committed margin is EXACTLY the zero-baseline-better case', () => {
  it('at n=17, margin=3: only b=0 certifies', () => {
    const certifyingCounts = [];
    for (let b = 0; b <= 17; b++) {
      if (computeDifferenceUpperBound(b, 17, 3).certifies) certifyingCounts.push(b);
    }
    expect(certifyingCounts).toEqual([0]);
  });

  it('at n=13, margin=3: only b=0 certifies', () => {
    const certifyingCounts = [];
    for (let b = 0; b <= 13; b++) {
      if (computeDifferenceUpperBound(b, 13, 3).certifies) certifyingCounts.push(b);
    }
    expect(certifyingCounts).toEqual([0]);
  });

  it('at both n, a margin ONE item smaller (2 items) certifies NOTHING -- not even b=0', () => {
    expect(computeDifferenceUpperBound(0, 17, 2).certifies).toBe(false);
    expect(computeDifferenceUpperBound(0, 13, 2).certifies).toBe(false);
    // The committed margin (3) DOES certify at b=0, at both n -- confirming
    // 3 is the smallest reachable margin, not merely A reachable one.
    expect(computeDifferenceUpperBound(0, 17, 3).certifies).toBe(true);
    expect(computeDifferenceUpperBound(0, 13, 3).certifies).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A-8: no credit for improvements. Monotonicity: once a count fails to
// certify, no higher count certifies either -- the property whose absence
// disqualified the rejected Bonferroni-split method (A-2 layer 3).
// ---------------------------------------------------------------------------

describe('power — A-8 and monotonicity: no credit for improvements, and the certifying decision never re-certifies after failing once', () => {
  it('a baseline-better count of 1 does not certify, even though a real comparison at that count could have an arbitrarily large candidate-better count alongside it -- the bound cannot see it', () => {
    expect(computeDifferenceUpperBound(0, 17, 3).certifies).toBe(true);
    expect(computeDifferenceUpperBound(1, 17, 3).certifies).toBe(false);
  });

  it('the certifying decision is MONOTONE in the baseline-better count: once false, always false for every higher count', () => {
    for (const n of [13, 17]) {
      let sawFalse = false;
      for (let b = 0; b <= n; b++) {
        const certifies = computeDifferenceUpperBound(b, n, 3).certifies;
        if (sawFalse) {
          expect(certifies).toBe(false);
        }
        if (!certifies) sawFalse = true;
      }
      expect(sawFalse).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Reproduction pin -- independently reproduces the committed bar file's own
// STRUCTURED figures. If any disagrees, the operating notes require a HALT,
// not an adjustment to either side -- see 85-02-SUMMARY.md.
// ---------------------------------------------------------------------------

describe('power — reproduction pin: every structured figure the committed bar file records', () => {
  const bar = loadDecisionBars(PACKAGE_ROOT, 'v1');
  const ap = bar.achievedPower;

  it('reachability derivation: closed-form bound at zero, checked counts, smallest reachable margin (generate-fix, n=17)', () => {
    const gf = ap.reachabilityDerivation.generateFix;
    expect(zeroEventUpperBound(gf.n)).toBeCloseTo(gf.closedFormBoundAtZero, 4);
    for (const row of gf.checkedCounts) {
      expect(row.proportion).toBeCloseTo(row.m / gf.n, 4);
      expect(computeDifferenceUpperBound(0, gf.n, row.m).certifies).toBe(row.reachable);
    }
    expect(gf.smallestReachableMarginItems).toBe(3);
  });

  it('reachability derivation: closed-form bound at zero, checked counts, smallest reachable margin (analyse-visual correct, n=13)', () => {
    const av = ap.reachabilityDerivation.analyseVisualCorrect;
    expect(zeroEventUpperBound(av.n)).toBeCloseTo(av.closedFormBoundAtZero, 4);
    for (const row of av.checkedCounts) {
      expect(row.proportion).toBeCloseTo(row.m / av.n, 4);
      expect(computeDifferenceUpperBound(0, av.n, row.m).certifies).toBe(row.reachable);
    }
    expect(av.smallestReachableMarginItems).toBe(3);
  });

  it('worst-case false-reassurance: generate-fix (n=17, margin=3) and analyse-visual correct (n=13, margin=3)', () => {
    const values = ap.validityStatement.exactWorstCaseValues;
    expect(worstCaseFalseReassuranceRate(values.generateFix.n, values.generateFix.marginItems)).toBeCloseTo(
      values.generateFix.worstCaseFalseReassuranceRate,
      4,
    );
    expect(
      worstCaseFalseReassuranceRate(values.analyseVisualCorrect.n, values.analyseVisualCorrect.marginItems),
    ).toBeCloseTo(values.analyseVisualCorrect.worstCaseFalseReassuranceRate, 4);
  });

  it('worst-case false-reassurance cross-check: the rejected 4-item digit at n=17 (A-2 layer 3)', () => {
    const cross = ap.validityStatement.exactWorstCaseValues.crossCheckAgainstTheRejectedFourItemDigit;
    expect(worstCaseFalseReassuranceRate(cross.n, cross.marginItems)).toBeCloseTo(
      cross.worstCaseFalseReassuranceRate,
      4,
    );
  });

  it('achieved power to certify a genuinely identical candidate, at the assumed 0.25 discordance -- both capabilities', () => {
    const two = ap.twoFiguresPerCapability;
    expect(
      achievedPowerToCertifyIdentical(two.generateFix.n, 3, two.assumedDiscordantPairRateUsedHere),
    ).toBeCloseTo(two.generateFix.powerToCertifyGenuinelyIdenticalCandidate.value, 4);
    expect(
      achievedPowerToCertifyIdentical(two.analyseVisualCorrect.n, 3, two.assumedDiscordantPairRateUsedHere),
    ).toBeCloseTo(two.analyseVisualCorrect.powerToCertifyGenuinelyIdenticalCandidate.value, 4);
  });

  it('the full 9-row sensitivity table -- every row, both capabilities (18 reproduced values)', () => {
    for (const row of ap.sensitivityTable.rows) {
      expect(achievedPowerToCertifyIdentical(17, 3, row.assumedDiscordantPairRate)).toBeCloseTo(
        row.generateFixPowerToCertifyIdentical_n17,
        4,
      );
      expect(achievedPowerToCertifyIdentical(13, 3, row.assumedDiscordantPairRate)).toBeCloseTo(
        row.analyseVisualPowerToCertifyIdentical_n13,
        4,
      );
    }
  });

  it('the largest certifying baseline-better count matches the recorded value (0) at both n', () => {
    const entries = ap.observedResultsThatCanCertify;
    function largestCertifying(n: number, margin: number): number {
      let largest = -1;
      for (let b = 0; b <= n; b++) {
        if (computeDifferenceUpperBound(b, n, margin).certifies) largest = b;
      }
      return largest;
    }
    expect(largestCertifying(entries.generateFix.n, entries.generateFix.marginItems)).toBe(
      entries.generateFix.largestCertifyingBaselineBetterCount,
    );
    expect(largestCertifying(entries.analyseVisualCorrect.n, entries.analyseVisualCorrect.marginItems)).toBe(
      entries.analyseVisualCorrect.largestCertifyingBaselineBetterCount,
    );
  });

  it('the prose cross-check figures (U(1,n), U(2,n) at both n) -- 85-01-SUMMARY.md and the bar file crossCheckOfCoordinatorsFigures note', () => {
    // These four values exist only as PROSE inside
    // nonInferiorityMargin.history.layer3Retraction.crossCheckOfCoordinatorsFigures.note
    // (not a structured field), so they are hardcoded here as literals this
    // executing plan independently re-derived (see 85-02-SUMMARY.md), not
    // extracted programmatically from the bar file's text.
    expect(clopperPearsonUpperBound(1, 17)).toBeCloseTo(0.2501, 4);
    expect(clopperPearsonUpperBound(2, 17)).toBeCloseTo(0.3262, 4);
    expect(clopperPearsonUpperBound(1, 13)).toBeCloseTo(0.3163, 4);
    expect(clopperPearsonUpperBound(2, 13)).toBeCloseTo(0.4101, 4);
  });
});
