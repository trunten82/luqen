/**
 * `decision-bars.test.ts` — Phase 85 Task 2: the loader, its refusals, and
 * the digest pin that makes editing the bar file loud.
 *
 * Every refusal below is exercised against a MUTATED COPY of the real
 * committed bar file in a fresh temp directory (mirroring
 * `refusals.test.ts`'s convention) — never against the committed file
 * itself, which must not be edited to prove a guard works.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadDecisionBars,
  getCapabilityBar,
  assertBarAppliesTo,
  assertWholePositiveItemCount,
  assertNoToleranceShapedField,
  InvalidDecisionBarsFileError,
  DecisionBarsVersionMismatchError,
  UnknownCapabilityBarError,
  BarSetNameMismatchError,
  BarSetVersionMismatchError,
  BarItemCountMismatchError,
  InvalidMarginError,
  FalsePassGateToleranceFieldError,
} from '../../src/eval/decision-bars.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const PACKAGE_ROOT = process.cwd();
const REAL_BAR_PATH = join(PACKAGE_ROOT, 'tests', 'eval', 'bars', 'decision-bars.v1.json');

function loadRealBarRaw(): Json {
  return JSON.parse(readFileSync(REAL_BAR_PATH, 'utf-8'));
}

/** Writes a MUTATED COPY of the real committed bar file into a fresh temp
 * package root, at the same package-relative path the loader resolves --
 * never a malformed file committed alongside the real one. */
function tempBarsPackageRoot(mutate: (data: Json) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'luqen-bars-'));
  mkdirSync(join(dir, 'tests', 'eval', 'bars'), { recursive: true });
  const data = structuredClone(loadRealBarRaw());
  mutate(data);
  writeFileSync(join(dir, 'tests', 'eval', 'bars', 'decision-bars.v1.json'), JSON.stringify(data));
  return dir;
}

/** Writes an arbitrary raw string at the resolved bar-file path -- for cases
 * that are not JSON at all, or not an object at the top level. */
function tempBarsPackageRootRaw(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'luqen-bars-'));
  mkdirSync(join(dir, 'tests', 'eval', 'bars'), { recursive: true });
  writeFileSync(join(dir, 'tests', 'eval', 'bars', 'decision-bars.v1.json'), content);
  return dir;
}

function captureError(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err;
  }
}

// ---------------------------------------------------------------------------
// Loading — fully typed record, every field present
// ---------------------------------------------------------------------------

describe('decision-bars — loading the committed pre-registration', () => {
  it('loadDecisionBars returns every top-level field, none optional', () => {
    const loaded = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const expectedKeys = [
      'barsVersion',
      'recordedAt',
      'capabilities',
      'preRegistrationGuarantee',
      'capabilityBars',
      'varianceAssumption',
      'achievedPower',
      'verdictPrecedence',
      'licenceStrings',
      'explicitExclusions',
      'lessonRecorded',
      'digestSha256',
    ].sort();
    expect(Object.keys(loaded).sort()).toEqual(expectedKeys);
  });

  it('carries the generate-fix bar exactly as pre-registered (D-85-2, D-85-3)', () => {
    const loaded = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const gf = loaded.capabilityBars['generate-fix'];
    expect(gf.setName).toBe('wcag-fixes');
    expect(gf.setVersion).toBe('v1');
    expect(gf.n).toBe(17);
    expect(gf.gatingAxis.counterName).toBe('exactMatchCount');
    expect(gf.nonGatingAxes).toHaveLength(5);
    expect(gf.nonInferiorityMargin.marginItems).toBe(3);
  });

  it('carries the analyse-visual bar as TWO separate mechanisms (D-85-1, D-85-4, A-3)', () => {
    const loaded = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const av = loaded.capabilityBars['analyse-visual'];
    expect(av.setName).toBe('image-alt');
    expect(av.setVersion).toBe('v1');
    expect(av.n).toBe(13);
    expect(av.falsePassScreeningGate.counterName).toBe('falsePass');
    expect(av.falsePassScreeningGate.opportunityDenominator.value).toBe(7);
    expect(av.falsePassScreeningGate.toleranceField).toBeNull();
    expect(av.nonInferiorityClause.counterName).toBe('correct');
    expect(av.nonInferiorityClause.marginItems).toBe(3);
  });

  it('carries all three layers of D-85-3s amendment history (A-2)', () => {
    const loaded = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const history = loaded.capabilityBars['generate-fix'].nonInferiorityMargin.history;
    expect(history.layer1Original.value).toContain('3 items');
    expect(history.layer2Amendment.value).toContain('amended from 3 to 4');
    expect(history.layer3Retraction.value).toContain('retracted back to 3');
  });
});

// ---------------------------------------------------------------------------
// Digest pin (T-85-01)
// ---------------------------------------------------------------------------

// Pinned raw-bytes sha256 of the committed bar file. A failure here means
// the bar file changed -- update this literal in the SAME commit as a
// deliberate, legitimate amendment (a v2 bar for a larger set); the failure
// is the point, not an inconvenience.
const PINNED_BAR_FILE_DIGEST = '99a7d1a35559cdea79b0e7515de7617d86b1ee7e0e5d7fd1b1657d5974d45ecc';

describe('decision-bars — digest pin (T-85-01)', () => {
  it('pins the raw-bytes sha256 digest of the committed bar file', () => {
    const loaded = loadDecisionBars(PACKAGE_ROOT, 'v1');
    expect(loaded.digestSha256).toBe(PINNED_BAR_FILE_DIGEST);
  });

  it('the digest changes when the bar file bytes change by even one whitespace character', () => {
    const root = tempBarsPackageRoot(() => {
      /* no mutation to the data -- the byte-level change is applied below */
    });
    const filePath = join(root, 'tests', 'eval', 'bars', 'decision-bars.v1.json');
    const original = readFileSync(filePath, 'utf-8');
    writeFileSync(filePath, `${original} `); // one trailing space -- still valid JSON
    const loaded = loadDecisionBars(root, 'v1');
    expect(loaded.digestSha256).not.toBe(PINNED_BAR_FILE_DIGEST);
  });
});

// ---------------------------------------------------------------------------
// Malformed top-level shape
// ---------------------------------------------------------------------------

describe('decision-bars — refuses a malformed top-level shape', () => {
  it('InvalidDecisionBarsFileError: capabilityBars deleted entirely', () => {
    const root = tempBarsPackageRoot((data) => {
      delete data.capabilityBars;
    });
    const err = captureError(() => loadDecisionBars(root, 'v1'));
    expect(err).toBeInstanceOf(InvalidDecisionBarsFileError);
  });

  it('InvalidDecisionBarsFileError: top-level value is an array, not an object', () => {
    const root = tempBarsPackageRootRaw(JSON.stringify([1, 2, 3]));
    const err = captureError(() => loadDecisionBars(root, 'v1'));
    expect(err).toBeInstanceOf(InvalidDecisionBarsFileError);
  });

  it('InvalidDecisionBarsFileError: invalid JSON entirely', () => {
    const root = tempBarsPackageRootRaw('{not valid json');
    const err = captureError(() => loadDecisionBars(root, 'v1'));
    expect(err).toBeInstanceOf(InvalidDecisionBarsFileError);
  });

  it('InvalidDecisionBarsFileError: a required nested field is missing (achievedPower.decisionRule)', () => {
    const root = tempBarsPackageRoot((data) => {
      delete data.achievedPower.decisionRule;
    });
    const err = captureError(() => loadDecisionBars(root, 'v1'));
    expect(err).toBeInstanceOf(InvalidDecisionBarsFileError);
  });
});

// ---------------------------------------------------------------------------
// Unknown bars version
// ---------------------------------------------------------------------------

describe('decision-bars — refuses an unknown bars version', () => {
  it('DecisionBarsVersionMismatchError: requesting v2, which has no registered file', () => {
    const err = captureError(() => loadDecisionBars(PACKAGE_ROOT, 'v2'));
    expect(err).toBeInstanceOf(DecisionBarsVersionMismatchError);
  });

  it('DecisionBarsVersionMismatchError: file content barsVersion does not match the requested version', () => {
    const root = tempBarsPackageRoot((data) => {
      data.barsVersion = 'v2';
    });
    const err = captureError(() => loadDecisionBars(root, 'v1'));
    expect(err).toBeInstanceOf(DecisionBarsVersionMismatchError);
    expect((err as DecisionBarsVersionMismatchError).expected).toBe('v1');
    expect((err as DecisionBarsVersionMismatchError).found).toBe('v2');
  });
});

// ---------------------------------------------------------------------------
// Unknown capability
// ---------------------------------------------------------------------------

describe('decision-bars — refuses an unknown capability', () => {
  it('UnknownCapabilityBarError: asking for a capability this file carries no bar for', () => {
    const loaded = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const err = captureError(() => getCapabilityBar(loaded, 'discover-branding'));
    expect(err).toBeInstanceOf(UnknownCapabilityBarError);
    expect((err as UnknownCapabilityBarError).requestedCapability).toBe('discover-branding');
  });

  it('assertBarAppliesTo refuses the same way when the RunFunction names an unbarred capability', () => {
    const loaded = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const err = captureError(() =>
      assertBarAppliesTo(loaded, {
        capability: 'extract-requirements',
        setName: 'whatever',
        setVersion: 'v1',
        itemCount: 1,
      }),
    );
    expect(err).toBeInstanceOf(UnknownCapabilityBarError);
  });
});

// ---------------------------------------------------------------------------
// assertBarAppliesTo — set name / set version / item count mismatches
// ---------------------------------------------------------------------------

describe('decision-bars — assertBarAppliesTo refuses a mismatched run', () => {
  it('positive control: a run matching the bar exactly is accepted', () => {
    const loaded = loadDecisionBars(PACKAGE_ROOT, 'v1');
    expect(() =>
      assertBarAppliesTo(loaded, {
        capability: 'generate-fix',
        setName: 'wcag-fixes',
        setVersion: 'v1',
        itemCount: 17,
      }),
    ).not.toThrow();
  });

  it('BarSetNameMismatchError: set name differs, naming both values', () => {
    const loaded = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const err = captureError(() =>
      assertBarAppliesTo(loaded, {
        capability: 'generate-fix',
        setName: 'a-different-set',
        setVersion: 'v1',
        itemCount: 17,
      }),
    );
    expect(err).toBeInstanceOf(BarSetNameMismatchError);
    expect((err as BarSetNameMismatchError).barSetName).toBe('wcag-fixes');
    expect((err as BarSetNameMismatchError).runSetName).toBe('a-different-set');
  });

  it('BarSetVersionMismatchError: set version differs, naming both values', () => {
    const loaded = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const err = captureError(() =>
      assertBarAppliesTo(loaded, {
        capability: 'generate-fix',
        setName: 'wcag-fixes',
        setVersion: 'v2',
        itemCount: 17,
      }),
    );
    expect(err).toBeInstanceOf(BarSetVersionMismatchError);
    expect((err as BarSetVersionMismatchError).barSetVersion).toBe('v1');
    expect((err as BarSetVersionMismatchError).runSetVersion).toBe('v2');
  });

  it('BarItemCountMismatchError: item count differs, naming both values -- the D-85-3 item-count enforcement', () => {
    const loaded = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const err = captureError(() =>
      assertBarAppliesTo(loaded, {
        capability: 'generate-fix',
        setName: 'wcag-fixes',
        setVersion: 'v1',
        itemCount: 34, // a hypothetical differently-sized set
      }),
    );
    expect(err).toBeInstanceOf(BarItemCountMismatchError);
    expect((err as BarItemCountMismatchError).barItemCount).toBe(17);
    expect((err as BarItemCountMismatchError).runItemCount).toBe(34);
  });

  it('the analyse-visual bar is checked against its own set (image-alt, n=13), independently of generate-fix', () => {
    const loaded = loadDecisionBars(PACKAGE_ROOT, 'v1');
    expect(() =>
      assertBarAppliesTo(loaded, {
        capability: 'analyse-visual',
        setName: 'image-alt',
        setVersion: 'v1',
        itemCount: 13,
      }),
    ).not.toThrow();
    const err = captureError(() =>
      assertBarAppliesTo(loaded, {
        capability: 'analyse-visual',
        setName: 'image-alt',
        setVersion: 'v1',
        itemCount: 7, // the false-pass OPPORTUNITY count, not the item count -- must not be confused
      }),
    );
    expect(err).toBeInstanceOf(BarItemCountMismatchError);
  });
});

// ---------------------------------------------------------------------------
// Margin must be a whole positive item count (D-85-3)
// ---------------------------------------------------------------------------

describe('decision-bars — margin must be a whole positive item count (D-85-3)', () => {
  it('a valid whole positive item count is accepted', () => {
    expect(() => assertWholePositiveItemCount('scratch.marginItems', 3)).not.toThrow();
  });

  it.each([
    ['a percentage-like float (17.6, the derived percentage substituted for the item count)', 17.6],
    ['a fractional item count', 3.5],
    ['a numeric string', '3'],
    ['zero', 0],
    ['a negative number', -3],
    ['not a number at all', 'three'],
  ])('InvalidMarginError: %s is refused', (_label, badValue) => {
    const err = captureError(() => assertWholePositiveItemCount('scratch.marginItems', badValue));
    expect(err).toBeInstanceOf(InvalidMarginError);
  });

  it('the loader itself refuses a scratch bar file whose generate-fix margin is a percentage, not an item count', () => {
    const root = tempBarsPackageRoot((data) => {
      data.capabilityBars['generate-fix'].nonInferiorityMargin.marginItems = 17.6;
    });
    const err = captureError(() => loadDecisionBars(root, 'v1'));
    expect(err).toBeInstanceOf(InvalidMarginError);
  });

  it('the loader itself refuses a scratch bar file whose analyse-visual correct margin is zero', () => {
    const root = tempBarsPackageRoot((data) => {
      data.capabilityBars['analyse-visual'].nonInferiorityClause.marginItems = 0;
    });
    const err = captureError(() => loadDecisionBars(root, 'v1'));
    expect(err).toBeInstanceOf(InvalidMarginError);
  });
});

// ---------------------------------------------------------------------------
// False-PASS gate refuses any tolerance-shaped field (D-85-4)
// ---------------------------------------------------------------------------

describe('decision-bars — false-PASS gate refuses any tolerance-shaped field (D-85-4)', () => {
  it('positive control: the committed gate object, unmodified, is accepted', () => {
    const loaded = loadDecisionBars(PACKAGE_ROOT, 'v1');
    expect(() =>
      assertNoToleranceShapedField(
        loaded.capabilityBars['analyse-visual'].falsePassScreeningGate as unknown as Record<string, unknown>,
      ),
    ).not.toThrow();
  });

  it('FalsePassGateToleranceFieldError: a scratch copy with a new tolerance field added is refused', () => {
    const loaded = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const scratchGate = {
      ...loaded.capabilityBars['analyse-visual'].falsePassScreeningGate,
      tolerance: 0.05,
    };
    const err = captureError(() =>
      assertNoToleranceShapedField(scratchGate as unknown as Record<string, unknown>),
    );
    expect(err).toBeInstanceOf(FalsePassGateToleranceFieldError);
    expect((err as FalsePassGateToleranceFieldError).unexpectedKey).toBe('tolerance');
  });

  it('FalsePassGateToleranceFieldError: a scratch copy with a new epsilon field added is refused', () => {
    const loaded = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const scratchGate = {
      ...loaded.capabilityBars['analyse-visual'].falsePassScreeningGate,
      epsilon: 0.01,
    };
    const err = captureError(() =>
      assertNoToleranceShapedField(scratchGate as unknown as Record<string, unknown>),
    );
    expect(err).toBeInstanceOf(FalsePassGateToleranceFieldError);
    expect((err as FalsePassGateToleranceFieldError).unexpectedKey).toBe('epsilon');
  });

  it('FalsePassGateToleranceFieldError: a scratch copy with toleranceField widened from null to a number is refused', () => {
    const loaded = loadDecisionBars(PACKAGE_ROOT, 'v1');
    const scratchGate = {
      ...loaded.capabilityBars['analyse-visual'].falsePassScreeningGate,
      toleranceField: 0.05,
    };
    const err = captureError(() =>
      assertNoToleranceShapedField(scratchGate as unknown as Record<string, unknown>),
    );
    expect(err).toBeInstanceOf(FalsePassGateToleranceFieldError);
    expect((err as FalsePassGateToleranceFieldError).unexpectedKey).toBe('toleranceField');
  });

  it('the loader itself refuses a scratch bar file whose false-PASS gate carries an added tolerance field', () => {
    const root = tempBarsPackageRoot((data) => {
      data.capabilityBars['analyse-visual'].falsePassScreeningGate.tolerance = 0.1;
    });
    const err = captureError(() => loadDecisionBars(root, 'v1'));
    expect(err).toBeInstanceOf(FalsePassGateToleranceFieldError);
  });
});
