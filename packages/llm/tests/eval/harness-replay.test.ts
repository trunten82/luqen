/**
 * `runHarness` — full-set replay run tests (Phase 84, HARNESS-01/HARNESS-02).
 *
 * TWO KINDS OF GREEN LIVE IN THIS FILE, and they mean different things:
 *
 * 1. The "Task 1 plumbing" describe block below feeds `runHarness` each
 *    item's OWN gold/expected answer, constructed inline by this test file.
 *    A green result there means the harness's PLUMBING works.
 *
 * 2. The "committed synthetic fixtures" describe block loads
 *    `tests/eval/fixtures/wcag-fixes.replay.json` and
 *    `tests/eval/fixtures/image-alt.replay.json` — hand-written response
 *    fixtures, labelled SYNTHETIC inside the artifact itself, deliberately
 *    including degraded shapes (not-valid-JSON, valid-JSON-missing-fields,
 *    markdown-fenced) so the diagnostic and failure paths are exercised
 *    rather than assumed.
 *
 * NEITHER kind means any model was measured. No trusted measurement of any
 * model exists from this file — that is Phase 86's baseline job, against a
 * real provider.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runHarness } from '../../src/eval/harness.js';
import { createFixtureAdapter } from '../../src/eval/fixture-adapter.js';
import { loadImageAltSet, loadWcagFixSet } from '../../src/eval/load-reference-set.js';
import { resolveReferenceSetPath } from '../../src/eval/set-paths.js';
import { goldResultFor } from '../../src/eval/score-generate-fix.js';
import { goldAnalyseVisualResultFor } from '../../src/eval/score-analyse-visual.js';
import { isFailedItem, isScoredItem, type ItemRecord } from '../../src/eval/report.js';
import type { GenerateFixScoreRecord } from '../../src/eval/score-generate-fix.js';
import type { AnalyseVisualScoreRecord } from '../../src/eval/score-analyse-visual.js';

const PACKAGE_ROOT = process.cwd();

/**
 * Loads a committed replay fixture file, separating its `_synthetic` label
 * (a synthetic-not-model-output marker living IN the artifact — see the
 * fixture files themselves) from the item-id-to-response-text map the
 * fixture adapter looks up.
 */
function loadReplayFixtureFile(relativePath: string): {
  readonly label: string;
  readonly responsesByItemId: Readonly<Record<string, string>>;
} {
  const raw = JSON.parse(readFileSync(join(PACKAGE_ROOT, relativePath), 'utf-8')) as Record<
    string,
    string
  >;
  const { _synthetic: label, ...responsesByItemId } = raw;
  return { label, responsesByItemId };
}

function fixtureAdapterFactoryFor(responsesByItemId: Record<string, string>) {
  return (itemId: string) => () =>
    createFixtureAdapter({ responsesByItemId, currentItemId: () => itemId });
}

function goldGenerateFixFixtures(): Record<string, string> {
  const set = loadWcagFixSet(resolveReferenceSetPath(PACKAGE_ROOT, 'wcag-fixes'), 'v1');
  const responses: Record<string, string> = {};
  for (const item of set.items) {
    responses[item.id] = JSON.stringify(goldResultFor(item));
  }
  return responses;
}

function goldAnalyseVisualFixtures(): Record<string, string> {
  const set = loadImageAltSet(resolveReferenceSetPath(PACKAGE_ROOT, 'image-alt'), 'v1');
  const responses: Record<string, string> = {};
  for (const item of set.items) {
    responses[item.id] = JSON.stringify(goldAnalyseVisualResultFor(item));
  }
  return responses;
}

describe('runHarness — full-set replay run (Task 1 plumbing)', () => {
  it('scores the whole wcag-fixes set in replay mode, sorted by id, with no bar/verdict field anywhere', async () => {
    const responsesByItemId = goldGenerateFixFixtures();

    const result = await runHarness({
      capability: 'generate-fix',
      mode: 'replay',
      packageRoot: PACKAGE_ROOT,
      setVersion: 'v1',
      adapterFactoryFor: fixtureAdapterFactoryFor(responsesByItemId),
    });

    expect(result.capability).toBe('generate-fix');
    const { report } = result;
    expect(report.items).toHaveLength(17);
    expect(report.failedCount).toBe(0);
    expect(report.runFunction.mode).toBe('replay');
    expect(report.runFunction.capability).toBe('generate-fix');
    expect(report.reportSchemaVersion).toBe('1');

    const ids = report.items.map((i) => i.itemId);
    expect(ids).toEqual([...ids].sort());
    expect(report.items.every(isScoredItem)).toBe(true);

    for (const item of report.items) {
      if (isScoredItem(item)) {
        expect(item.rawText).toBe(responsesByItemId[item.itemId]);
        expect(item.diagnosis.present).toBe(true);
        expect(item.score).toBeDefined();
      }
    }

    // No bar/threshold/verdict/margin field anywhere in the report — Phase
    // 84 measures, Phase 85 judges.
    const serialised = JSON.stringify(report);
    expect(serialised).not.toMatch(/"bar"|"threshold"|"margin"|"verdict"\s*:/);
  });

  it('scores the whole image-alt set in replay mode, with the four verdict-outcome counters pinned independently at the report layer', async () => {
    const responsesByItemId = goldAnalyseVisualFixtures();

    const result = await runHarness({
      capability: 'analyse-visual',
      mode: 'replay',
      packageRoot: PACKAGE_ROOT,
      setVersion: 'v1',
      adapterFactoryFor: fixtureAdapterFactoryFor(responsesByItemId),
    });

    expect(result.capability).toBe('analyse-visual');
    const { report } = result;
    expect(report.items).toHaveLength(13);
    expect(report.failedCount).toBe(0);
    expect(report.runFunction.mode).toBe('replay');
    expect(report.runFunction.capability).toBe('analyse-visual');

    // RE-ASSERT ANTI-FUSION (required, not merely inherited from 84-03's
    // aggregate.ts pin): the exact key set of the analyse-visual counters as
    // they appear in the SERIALISED report, by positive equality against a
    // literal list. Inheritance from aggregate.ts holds only while report.ts
    // keeps wrapping that object unchanged — this pin catches a fused field
    // added at THIS layer even if aggregate.ts's own pin stays green.
    const parsed = JSON.parse(JSON.stringify(report)) as { aggregate: Record<string, unknown> };
    expect(Object.keys(parsed.aggregate)).toEqual([
      'total',
      'correct',
      'falsePass',
      'falseIssue',
      'uncertain',
      'altClassificationMismatchCount',
      'suggestedAltFilenameShapedCount',
      'suggestedAltEmptyDespiteInformationalCount',
    ]);
  });

  it('records a per-item capability failure as a labelled failed item, never a silently-scored zero', async () => {
    const responsesByItemId = goldGenerateFixFixtures();
    const set = loadWcagFixSet(resolveReferenceSetPath(PACKAGE_ROOT, 'wcag-fixes'), 'v1');
    const missingId = set.items[0]!.id;
    delete responsesByItemId[missingId];

    const result = await runHarness({
      capability: 'generate-fix',
      mode: 'replay',
      packageRoot: PACKAGE_ROOT,
      setVersion: 'v1',
      adapterFactoryFor: fixtureAdapterFactoryFor(responsesByItemId),
    });

    expect(result.report.items).toHaveLength(17);
    expect(result.report.failedCount).toBe(1);
    // The aggregate counts only the 16 items that produced a result — the
    // failure is never folded into it as a zero-scoring item.
    expect(result.report.aggregate.total).toBe(16);

    const failedItem = result.report.items.find((i) => i.itemId === missingId) as
      | ItemRecord<unknown>
      | undefined;
    expect(failedItem).toBeDefined();
    expect(isFailedItem(failedItem!)).toBe(true);
    if (failedItem && isFailedItem(failedItem)) {
      expect(failedItem.failureReason).toContain('No fixture response recorded');
    }
  });

  it('two runs of the same run function serialise to identical JSON apart from the timestamp', async () => {
    const responsesByItemId = goldGenerateFixFixtures();
    const runOnce = () =>
      runHarness({
        capability: 'generate-fix',
        mode: 'replay',
        packageRoot: PACKAGE_ROOT,
        setVersion: 'v1',
        adapterFactoryFor: fixtureAdapterFactoryFor(responsesByItemId),
      });

    const a = await runOnce();
    const b = await runOnce();

    const stripTimestamp = (report: typeof a.report) =>
      JSON.stringify({ ...report, runFunction: { ...report.runFunction, timestamp: '' } });
    expect(stripTimestamp(a.report)).toBe(stripTimestamp(b.report));
  });
});

describe('runHarness — committed synthetic fixtures (Task 2: the first full-set run)', () => {
  it('the fixture files are labelled SYNTHETIC in the artifact itself, not only in a commit message', () => {
    const wcag = loadReplayFixtureFile('tests/eval/fixtures/wcag-fixes.replay.json');
    const imageAlt = loadReplayFixtureFile('tests/eval/fixtures/image-alt.replay.json');
    expect(wcag.label).toMatch(/SYNTHETIC/);
    expect(wcag.label).toMatch(/not model output/);
    expect(imageAlt.label).toMatch(/SYNTHETIC/);
    expect(imageAlt.label).toMatch(/not model output/);
  });

  it('runs the whole wcag-fixes set end to end, completing with the expected item count and a populated aggregate — this GREEN means the harness runs, NOT that any model was measured', async () => {
    const { responsesByItemId } = loadReplayFixtureFile('tests/eval/fixtures/wcag-fixes.replay.json');

    const result = await runHarness({
      capability: 'generate-fix',
      mode: 'replay',
      packageRoot: PACKAGE_ROOT,
      setVersion: 'v1',
      adapterFactoryFor: (itemId) => () =>
        createFixtureAdapter({ responsesByItemId, currentItemId: () => itemId }),
    });

    const { report } = result;
    expect(report.items).toHaveLength(17);
    expect(report.failedCount).toBe(0);
    expect(report.runFunction.mode).toBe('replay');
    expect(report.aggregate.total).toBe(17);

    const byId = new Map(report.items.map((i) => [i.itemId, i] as const));

    // Not-valid-JSON degraded shape: unparseable raw text, degraded-default
    // score (emptyFix), never a silently-scored genuine attempt.
    const notJsonItem = byId.get('wcag-justified-text') as ItemRecord<GenerateFixScoreRecord>;
    expect(isScoredItem(notJsonItem)).toBe(true);
    if (isScoredItem(notJsonItem)) {
      expect(notJsonItem.diagnosis.parseable).toBe(false);
      expect(notJsonItem.score.emptyFix).toBe(true);
    }

    // Valid JSON missing fixedHtml/explanation/effort: parseable, but the
    // parser's degraded defaults apply (emptyFix).
    const missingFieldsItem = byId.get('wcag-autocomplete-wrong-token') as ItemRecord<GenerateFixScoreRecord>;
    expect(isScoredItem(missingFieldsItem)).toBe(true);
    if (isScoredItem(missingFieldsItem)) {
      expect(missingFieldsItem.diagnosis.parseable).toBe(true);
      expect(missingFieldsItem.score.emptyFix).toBe(true);
    }

    // Markdown-fenced valid JSON gold answer: fence-stripping recovers a
    // clean parse and an exact match.
    const fencedItem = byId.get('wcag-derived-heading-css-class-only') as ItemRecord<GenerateFixScoreRecord>;
    expect(isScoredItem(fencedItem)).toBe(true);
    if (isScoredItem(fencedItem)) {
      expect(fencedItem.diagnosis.parseable).toBe(true);
      expect(fencedItem.score.exactMatch).toBe(true);
    }
  });

  it('runs the whole image-alt set end to end, and the parser-manufactured false-PASS (analyse-visual.ts:51-53) arrives through the FULL pipeline, not only through 84-03s direct unit path', async () => {
    const { responsesByItemId } = loadReplayFixtureFile('tests/eval/fixtures/image-alt.replay.json');

    const result = await runHarness({
      capability: 'analyse-visual',
      mode: 'replay',
      packageRoot: PACKAGE_ROOT,
      setVersion: 'v1',
      adapterFactoryFor: (itemId) => () =>
        createFixtureAdapter({ responsesByItemId, currentItemId: () => itemId }),
    });

    const { report } = result;
    expect(report.items).toHaveLength(13);
    expect(report.failedCount).toBe(0);
    expect(report.aggregate.total).toBe(13);

    const byId = new Map(report.items.map((i) => [i.itemId, i] as const));

    // The manufactured false-PASS: valid JSON with no verdict and no
    // findings, against an item whose STORED expected verdict is 'issue'.
    // parseAnalyseVisualResponse silently computes verdict:'pass'
    // (findings.length === 0) at analyse-visual.ts:51-53. Landing in the
    // false-pass bucket here is that exact production behaviour arriving
    // through runHarness's full pipeline, not merely through the scorer
    // called directly (84-03's break-test).
    const manufacturedPass = byId.get('informative-telephone-icon') as ItemRecord<AnalyseVisualScoreRecord>;
    expect(isScoredItem(manufacturedPass)).toBe(true);
    if (isScoredItem(manufacturedPass)) {
      expect(manufacturedPass.diagnosis.parseable).toBe(true);
      expect(manufacturedPass.diagnosis.verdictAsserted).toBe(false);
      expect(manufacturedPass.score.verdictOutcome).toBe('false-pass');
    }

    // Not-valid-JSON: swallowed parse failure -> genuine 'uncertain', a
    // FOURTH outcome, never folded into either error bucket.
    const notJsonItem = byId.get('informative-fax-icon') as ItemRecord<AnalyseVisualScoreRecord>;
    expect(isScoredItem(notJsonItem)).toBe(true);
    if (isScoredItem(notJsonItem)) {
      expect(notJsonItem.diagnosis.parseable).toBe(false);
      expect(notJsonItem.score.verdictOutcome).toBe('uncertain');
    }

    // Markdown-fenced valid JSON gold answer: fence-stripping recovers a
    // clean parse and a correct verdict.
    const fencedItem = byId.get('decorative-wallpaper-corner') as ItemRecord<AnalyseVisualScoreRecord>;
    expect(isScoredItem(fencedItem)).toBe(true);
    if (isScoredItem(fencedItem)) {
      expect(fencedItem.diagnosis.parseable).toBe(true);
      expect(fencedItem.score.verdictOutcome).toBe('correct');
    }

    // Do NOT assert an aggregate quality figure or any threshold — there is
    // no bar in Phase 84 and these are not model answers.
    expect(JSON.stringify(report)).not.toMatch(/"bar"|"threshold"|"margin"/);
  });
});
