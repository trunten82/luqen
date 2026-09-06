/**
 * `runHarness` — full-set replay run tests (Phase 84, HARNESS-01/HARNESS-02).
 *
 * A GREEN result here means the harness runs end to end for a whole
 * reference set. It does NOT mean any model was measured: every response
 * fed to the fixture adapter in this file is the item's own known-good
 * (gold) answer, constructed by this test, not model output. No trusted
 * measurement of any model exists from this test file — that is 84-04
 * Task 2's job (committed, labelled-synthetic fixtures) and Phase 86's
 * baseline job (a real model).
 */
import { describe, expect, it } from 'vitest';
import { runHarness } from '../../src/eval/harness.js';
import { createFixtureAdapter } from '../../src/eval/fixture-adapter.js';
import { loadImageAltSet, loadWcagFixSet } from '../../src/eval/load-reference-set.js';
import { resolveReferenceSetPath } from '../../src/eval/set-paths.js';
import { goldResultFor } from '../../src/eval/score-generate-fix.js';
import { goldAnalyseVisualResultFor } from '../../src/eval/score-analyse-visual.js';
import { isFailedItem, isScoredItem, type ItemRecord } from '../../src/eval/report.js';

const PACKAGE_ROOT = process.cwd();

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
