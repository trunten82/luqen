/**
 * `power.ts` — hand-rolled exact statistical arithmetic for Phase 85's
 * non-inferiority decision rule (A-1, BARS-01/BARS-03).
 *
 * No statistics library exists anywhere in this monorepo and the milestone
 * forbids adding one (85-RESEARCH.md, "Don't Hand-Roll (inverted)"), so this
 * module hand-rolls the arithmetic from the formula the committed bar file
 * records (`tests/eval/bars/decision-bars.v1.json` →
 * `achievedPower.decisionRule`), NOT by importing or adapting any script
 * used to derive that file's recorded numbers (85-01 used a Python/scipy
 * scratch session; this module is an independent TypeScript reproduction —
 * see power.test.ts's reproduction pin and 85-02-SUMMARY.md).
 *
 * THE RULE THIS MODULE IMPLEMENTS IS THE MARGINAL BOUND, NOT THE CONDITIONAL
 * ONE (A-1). `computeDifferenceUpperBound` below takes the baseline-better
 * count and `n` alone — it has NO parameter for the candidate-better count.
 * This is deliberate: the textbook-natural move is to condition the bound on
 * the observed discordant-pair split, and that method was REJECTED (A-1,
 * A-2 layer 3) for being anti-conservative and non-monotone. A bound on the
 * baseline-better rate ALONE is a valid bound on the true difference (the
 * candidate-better rate is never negative, so subtracting it can only make
 * the true difference smaller, never larger) — one parameter, nothing
 * conditioned on, no nuisance split.
 *
 * n is at most 17 in this codebase (Phase 83's committed reference sets), so
 * this module uses exact integer/BigInt binomial coefficients — no
 * logarithmic gamma machinery, no overflow concern, and no normal
 * approximation (which would be both wrong and unnecessary at these n).
 */

/** Exact integer binomial coefficient C(n, k), via BigInt so intermediate products stay exact even though n is small enough that Number would also work. */
function binomialCoefficient(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let result = 1n;
  for (let i = 0; i < kk; i++) {
    result = (result * BigInt(n - i)) / BigInt(i + 1);
  }
  return Number(result);
}

/** Exact binomial probability mass P(X = k) for X ~ Binomial(n, p). */
export function binomialPmf(n: number, k: number, p: number): number {
  if (k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return binomialCoefficient(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k);
}

/** Exact binomial cumulative probability P(X <= k) for X ~ Binomial(n, p). */
export function binomialCdf(n: number, k: number, p: number): number {
  let sum = 0;
  for (let i = 0; i <= k; i++) {
    sum += binomialPmf(n, i, p);
  }
  return sum;
}

/**
 * The exact one-sided 95%(default) Clopper-Pearson upper bound at ZERO
 * observed events: `1 - alpha^(1/n)` (the committed bar file's
 * `achievedPower.decisionRule.closedFormAtZero`). Closed-form, checkable
 * with a calculator, no reference implementation needed — this is the case
 * the whole reachability argument in the bar file turns on.
 */
export function zeroEventUpperBound(n: number, alpha = 0.05): number {
  return 1 - Math.pow(alpha, 1 / n);
}

/**
 * The exact one-sided Clopper-Pearson upper confidence bound U(b, n) on a
 * binomial proportion, from `b` events observed over `n` trials, at
 * confidence `1 - alpha`. Defined as the value U such that
 * `P(X <= b | n, p = U) = alpha` (the CDF is monotonically decreasing in p,
 * so this is unique) — found by bisection over p in [0, 1], since no closed
 * form exists for general b. `b = 0` uses the closed form directly (exact,
 * no bisection floating-point error). `b = n` returns 1.0, matching the bar
 * file's `achievedPower.decisionRule.generalFormula` note ("or 1.0 when
 * b = n") since P(X <= n) = 1 for every p and the equation P(X<=n)=alpha has
 * no solution in [0,1).
 */
export function clopperPearsonUpperBound(b: number, n: number, alpha = 0.05): number {
  if (b === n) return 1.0;
  if (b === 0) return zeroEventUpperBound(n, alpha);

  let lo = 0;
  let hi = 1;
  for (let iteration = 0; iteration < 100; iteration++) {
    const mid = (lo + hi) / 2;
    const cdf = binomialCdf(n, b, mid);
    // CDF(p) is monotonically DECREASING in p. We want CDF(p) == alpha.
    if (cdf > alpha) {
      lo = mid; // p too small (CDF still above alpha) — increase it
    } else {
      hi = mid; // p at/past target — pull it back
    }
  }
  return (lo + hi) / 2;
}

export interface DifferenceUpperBoundResult {
  readonly upperBound: number;
  readonly marginProportion: number;
  readonly certifies: boolean;
}

/**
 * A-1's decision rule: does the exact one-sided Clopper-Pearson upper bound
 * on the baseline-better rate (computed from `baselineBetterCount` and `n`
 * ALONE) clear the margin, expressed as a proportion (`marginItems / n`)?
 *
 * DELIBERATELY takes no candidate-better-count parameter — the bound is
 * INVARIANT to it by construction (A-8, "no credit for improvements"). This
 * is what stops the rejected conditional-discordance method creeping back
 * in during a refactor: there is no `c` parameter for it to condition on.
 */
export function computeDifferenceUpperBound(
  baselineBetterCount: number,
  n: number,
  marginItems: number,
  alpha = 0.05,
): DifferenceUpperBoundResult {
  const upperBound = clopperPearsonUpperBound(baselineBetterCount, n, alpha);
  const marginProportion = marginItems / n;
  return { upperBound, marginProportion, certifies: upperBound < marginProportion };
}
