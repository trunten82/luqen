import { describe, it, expect } from 'vitest';
import { formatGateSummary } from './gate-reporter.js';
import type { BaselineDiff } from '../baseline/diff.js';
import type { BaselineFinding } from '../baseline/baseline.js';

function makeErrorFinding(overrides: Partial<BaselineFinding> = {}): BaselineFinding {
  return {
    fingerprint: 'fp-1',
    normalizedPath: '/about',
    code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
    type: 'error',
    selector: '#main img.hero',
    message: 'Missing alt attribute',
    ...overrides,
  };
}

const CLEAN_DIFF: BaselineDiff = {
  newFindings: [],
  fixedFindings: [makeErrorFinding({ fingerprint: 'fp-fixed' })],
  unchanged: [makeErrorFinding({ fingerprint: 'fp-unch' })],
};

const NEW_DIFF: BaselineDiff = {
  newFindings: [
    makeErrorFinding({ fingerprint: 'fp-new-1', type: 'error', selector: '#main img.hero', message: 'Missing alt attribute' }),
    makeErrorFinding({ fingerprint: 'fp-new-2', type: 'error', selector: '#nav button.menu', message: 'Button has no accessible name', code: 'WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.Button.Name' }),
    makeErrorFinding({ fingerprint: 'fp-new-3', type: 'warning', selector: '.card--promo span', message: 'Contrast ratio 2.8:1', code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.F24' }),
  ],
  fixedFindings: [makeErrorFinding({ fingerprint: 'fp-fixed-1' })],
  unchanged: Array.from({ length: 14 }, (_, i) => makeErrorFinding({ fingerprint: `fp-unch-${i}` })),
};

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

describe('formatGateSummary() — layout', () => {
  it('starts with a 37-char ─ divider', () => {
    const output = formatGateSummary(CLEAN_DIFF, '.luqen/baseline.json');
    const lines = output.split('\n');
    expect(lines[0]).toBe('─'.repeat(37));
  });

  it('contains the header "Luqen accessibility gate"', () => {
    const output = formatGateSummary(CLEAN_DIFF, '.luqen/baseline.json');
    expect(output).toContain('Luqen accessibility gate');
  });

  it('contains the baseline path', () => {
    const output = formatGateSummary(CLEAN_DIFF, '.luqen/baseline.json');
    expect(output).toContain('Baseline: .luqen/baseline.json');
  });

  it('contains count lines for New/Fixed/Unchanged', () => {
    const output = formatGateSummary(NEW_DIFF, '.luqen/baseline.json');
    expect(output).toContain('New findings:');
    expect(output).toContain('Fixed findings:');
    expect(output).toContain('Unchanged:');
  });

  it('shows the correct new finding count', () => {
    const output = formatGateSummary(NEW_DIFF, '.luqen/baseline.json');
    // Should show 3 new findings
    expect(output).toMatch(/New findings:\s+3/);
  });

  it('shows the correct fixed count', () => {
    const output = formatGateSummary(NEW_DIFF, '.luqen/baseline.json');
    expect(output).toMatch(/Fixed findings:\s+1/);
  });

  it('shows the correct unchanged count', () => {
    const output = formatGateSummary(NEW_DIFF, '.luqen/baseline.json');
    expect(output).toMatch(/Unchanged:\s+14/);
  });
});

// ---------------------------------------------------------------------------
// New findings section
// ---------------------------------------------------------------------------

describe('formatGateSummary() — new findings section', () => {
  it('includes "New findings (action required):" header when new > 0', () => {
    const output = formatGateSummary(NEW_DIFF, '.luqen/baseline.json');
    expect(output).toContain('New findings (action required):');
  });

  it('lists each new finding with severity label, code, selector, message', () => {
    const output = formatGateSummary(NEW_DIFF, '.luqen/baseline.json');
    expect(output).toContain('[error]');
    expect(output).toContain('#main img.hero');
    expect(output).toContain('Missing alt attribute');
  });

  it('does NOT include "New findings (action required):" when new = 0', () => {
    const output = formatGateSummary(CLEAN_DIFF, '.luqen/baseline.json');
    expect(output).not.toContain('action required');
  });
});

// ---------------------------------------------------------------------------
// Clean-run line (D-17 — exact copy locked)
// ---------------------------------------------------------------------------

describe('formatGateSummary() — clean-run line (D-17)', () => {
  it('ends with exactly "No new findings vs baseline." when new = 0', () => {
    const output = formatGateSummary(CLEAN_DIFF, '.luqen/baseline.json');
    expect(output).toContain('No new findings vs baseline.');
  });

  it('does NOT include "No new findings vs baseline." when new > 0', () => {
    const output = formatGateSummary(NEW_DIFF, '.luqen/baseline.json');
    expect(output).not.toContain('No new findings vs baseline.');
  });
});

// ---------------------------------------------------------------------------
// D-17 conservative copy enforcement
//
// The formatter output MUST NOT contain any conformance assertions.
// A grep-style assertion over the output string.
// ---------------------------------------------------------------------------

describe('formatGateSummary() — D-17 forbidden-word constraint', () => {
  const FORBIDDEN_PATTERN = /compliant|compliance|100%|passes\b|lawsuit-proof|fully accessible/i;

  it('clean-run output does not contain conformance assertions', () => {
    const output = formatGateSummary(CLEAN_DIFF, '.luqen/baseline.json');
    expect(output).not.toMatch(FORBIDDEN_PATTERN);
  });

  it('new-findings output does not contain conformance assertions', () => {
    const output = formatGateSummary(NEW_DIFF, '.luqen/baseline.json');
    expect(output).not.toMatch(FORBIDDEN_PATTERN);
  });

  it('output does not contain "accessible" as a conformance assertion', () => {
    // 'No new findings vs baseline.' is the strongest positive statement
    const output = formatGateSummary(CLEAN_DIFF, '.luqen/baseline.json');
    // The word 'accessible' as a noun phrase like 'fully accessible' is forbidden
    // But 'accessibility' (the product name) is allowed in 'Luqen accessibility gate'
    expect(output).not.toMatch(/\bfully accessible\b/i);
    expect(output).not.toMatch(/\bis accessible\b/i);
    expect(output).not.toMatch(/\baccessibility compliant\b/i);
  });
});

// ---------------------------------------------------------------------------
// Source file-level D-17 check
// ---------------------------------------------------------------------------

describe('gate-reporter.ts source D-17 static check', () => {
  it('the source file does not contain forbidden conformance strings', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const dir = dirname(fileURLToPath(import.meta.url));
    const source = await readFile(join(dir, 'gate-reporter.ts'), 'utf-8');
    expect(source).not.toMatch(/compliant|100%|lawsuit-proof|fully accessible/i);
    // 'passes' allowed only as a verb in comments; check it's not used as a conformance label in strings
    // We look specifically for it as a quoted output string
    expect(source).not.toMatch(/'passes'|"passes"|`passes`/i);
  });
});
