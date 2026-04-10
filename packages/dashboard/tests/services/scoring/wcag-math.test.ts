import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  relativeLuminance,
  contrastRatio,
  wcagContrastPasses,
  classifyLargeText,
  LARGE_TEXT_PT_THRESHOLD,
  LARGE_TEXT_BOLD_PT_THRESHOLD,
} from '../../../src/services/scoring/wcag-math.js';

describe('relativeLuminance (WCAG 2.1)', () => {
  it('returns 1.0 for white (255,255,255)', () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1.0, 5);
  });

  it('returns 0.0 for black (0,0,0)', () => {
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0.0, 5);
  });

  it('returns approx 0.2126 for pure red (255,0,0)', () => {
    expect(relativeLuminance(255, 0, 0)).toBeCloseTo(0.2126, 4);
  });

  it('returns approx 0.7152 for pure green (0,255,0)', () => {
    expect(relativeLuminance(0, 255, 0)).toBeCloseTo(0.7152, 4);
  });

  it('returns approx 0.0722 for pure blue (0,0,255)', () => {
    expect(relativeLuminance(0, 0, 255)).toBeCloseTo(0.0722, 4);
  });
});

describe('contrastRatio', () => {
  it('returns 21 for white on black', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
  });

  it('is symmetric (order-independent)', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });

  it('returns 1 for identical colors', () => {
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('normalizes 3-digit hex via normalizeHex', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5);
  });

  it('handles lowercase hex', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
  });

  it('returns NaN for malformed hex (first arg)', () => {
    expect(Number.isNaN(contrastRatio('not-a-color', '#000'))).toBe(true);
  });

  it('returns NaN for malformed hex (second arg)', () => {
    expect(Number.isNaN(contrastRatio('#000', 'xyz'))).toBe(true);
  });
});

describe('wcagContrastPasses — AA normal text boundary (D-18)', () => {
  it('fails at 4.49', () => {
    expect(wcagContrastPasses(4.49, 'AA', false)).toBe(false);
  });

  it('passes at exactly 4.50 (inclusive boundary)', () => {
    expect(wcagContrastPasses(4.50, 'AA', false)).toBe(true);
  });

  it('passes at 4.51', () => {
    expect(wcagContrastPasses(4.51, 'AA', false)).toBe(true);
  });
});

describe('wcagContrastPasses — AAA normal text boundary (D-18)', () => {
  it('fails at 6.99', () => {
    expect(wcagContrastPasses(6.99, 'AAA', false)).toBe(false);
  });

  it('passes at exactly 7.00 (inclusive boundary)', () => {
    expect(wcagContrastPasses(7.00, 'AAA', false)).toBe(true);
  });

  it('passes at 7.01', () => {
    expect(wcagContrastPasses(7.01, 'AAA', false)).toBe(true);
  });
});

describe('wcagContrastPasses — AA large text boundary at 3.0 (D-18)', () => {
  it('fails at 2.99 for AA large text', () => {
    expect(wcagContrastPasses(2.99, 'AA', true)).toBe(false);
  });

  it('passes at exactly 3.00 for AA large text', () => {
    expect(wcagContrastPasses(3.00, 'AA', true)).toBe(true);
  });

  it('passes at 3.01 for AA large text', () => {
    expect(wcagContrastPasses(3.01, 'AA', true)).toBe(true);
  });
});

describe('wcagContrastPasses — AAA large text boundary at 4.5 (D-18)', () => {
  it('fails at 4.49 for AAA large text', () => {
    expect(wcagContrastPasses(4.49, 'AAA', true)).toBe(false);
  });

  it('passes at exactly 4.50 for AAA large text', () => {
    expect(wcagContrastPasses(4.50, 'AAA', true)).toBe(true);
  });
});

describe('wcagContrastPasses — non-finite inputs', () => {
  it('rejects NaN', () => {
    expect(wcagContrastPasses(Number.NaN, 'AA', false)).toBe(false);
  });
});

describe('classifyLargeText', () => {
  it('exports constants 18 (normal) and 14 (bold)', () => {
    expect(LARGE_TEXT_PT_THRESHOLD).toBe(18);
    expect(LARGE_TEXT_BOLD_PT_THRESHOLD).toBe(14);
  });

  it('normal 18pt is large (inclusive)', () => {
    expect(classifyLargeText(18, false)).toBe(true);
  });

  it('normal 17.99pt is not large', () => {
    expect(classifyLargeText(17.99, false)).toBe(false);
  });

  it('bold 14pt is large (inclusive)', () => {
    expect(classifyLargeText(14, true)).toBe(true);
  });

  it('bold 13.99pt is not large', () => {
    expect(classifyLargeText(13.99, true)).toBe(false);
  });

  it('non-positive or non-finite fontSize is not large', () => {
    expect(classifyLargeText(0, false)).toBe(false);
    expect(classifyLargeText(-1, true)).toBe(false);
    expect(classifyLargeText(Number.NaN, false)).toBe(false);
  });
});

// --- D-07 enforcement: no literal WCAG thresholds in other scoring/ files ---

function listScoringSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      listScoringSourceFiles(full, acc);
    } else if (entry.endsWith('.ts') && entry !== 'wcag-math.ts') {
      acc.push(full);
    }
  }
  return acc;
}

describe('D-07 enforcement — no literal WCAG thresholds outside wcag-math.ts', () => {
  const scoringDir = resolve(__dirname, '../../../src/services/scoring');
  // D-07: Forbid literal WCAG threshold numbers outside wcag-math.ts.
  //
  // Two regex families:
  //   (1) Decimal forms 4.5 / 4.50 / 7.0 / 3.0 — always forbidden because they
  //       are unambiguous threshold values that have no legitimate non-threshold use.
  //   (2) Bare integers 3 / 7 (and the 4.5 decimal form) in COMPARISON contexts
  //       only — i.e. preceded by <, >, <=, or >=. This catches `ratio >= 3`,
  //       `contrast > 7`, etc. while deliberately NOT blocking bare arithmetic
  //       forms like `sum / 3` (which is the legitimate 3-heuristic mean used
  //       by typography-score.ts), `rgb(x, y, 3)`, or loop bounds `i < 3`.
  //
  // Rationale for NOT blocking bare integer 3 / 7 / 4.5 in all contexts:
  //   - `sum / 3` in typography-score.ts is a legitimate mean-of-3-booleans (D-02)
  //   - `Array(3)` / `.slice(0, 3)` / `rgb(...,3)` are not WCAG thresholds
  //   - Blocking all bare 3s would force absurd workarounds in unrelated code
  //
  // The comparison-context patterns close the main leak surface (the only way
  // a WCAG threshold literal shows up outside wcag-math.ts is in a pass/fail
  // comparison like `ratio >= 4.5`).
  const forbiddenPatterns = [
    // Decimal forms — always forbidden (unambiguous threshold values)
    /(?<![\w.])4\.50?(?![\w.])/,
    /(?<![\w.])7\.0?(?![\w.\d])/,
    /(?<![\w.])3\.0?(?![\w.\d])/,
    // Comparison-context forms — catch `ratio >= 3`, `x < 7`, `y <= 4.5`, etc.
    // Word boundary `(?![\w.\d])` prevents matching 30, 3.14, 7e5, 4.55, etc.
    /([<>]=?\s*)3(?![\w.\d])/,
    /([<>]=?\s*)4\.5(?![\w.\d])/,
    /([<>]=?\s*)7(?![\w.\d])/,
  ];

  it('finds zero literal WCAG threshold occurrences in scoring/ source files other than wcag-math.ts', () => {
    const files = listScoringSourceFiles(scoringDir);
    // Guard against vacuous pass: the scoring/ directory MUST contain at least
    // one .ts file other than wcag-math.ts by the time downstream plans (15-03,
    // 15-04) run. If this assertion ever fails in CI for 15-03+, it means the
    // directory walker is broken or files were moved — investigate before
    // trusting a "green" D-07 guard.
    //
    // In Plan 15-02 (this plan) the scoring/ directory only contains
    // wcag-math.ts + the Plan 15-01 files (types.ts, weights.ts), so
    // files.length will be ≥2. The assertion therefore holds starting from
    // this plan's run and remains meaningful for every subsequent plan.
    expect(files.length).toBeGreaterThan(0);
    const violations: Array<{ file: string; line: number; text: string }> = [];
    for (const file of files) {
      const contents = readFileSync(file, 'utf8').split('\n');
      contents.forEach((line, idx) => {
        // Skip comment lines — D-07 only forbids threshold numbers in executable code
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
          return;
        }
        for (const re of forbiddenPatterns) {
          if (re.test(line)) {
            violations.push({ file, line: idx + 1, text: line.trim() });
          }
        }
      });
    }
    expect(violations, `D-07 violations:\n${JSON.stringify(violations, null, 2)}`).toEqual([]);
  });
});
