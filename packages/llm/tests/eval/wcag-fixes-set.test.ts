import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadWcagFixSet } from '../../src/eval/load-reference-set.js';
import type { WcagFixItem } from '../../src/eval/types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const WCAG_FIXES_V1_PATH = join(__dirname, 'sets', 'wcag-fixes.v1.json');
const SOURCES_MD_PATH = join(__dirname, 'SOURCES.md');

const TECHNIQUES_URL_PREFIX = 'https://www.w3.org/WAI/WCAG22/Techniques/';
// An id containing a run of 4+ digits (a year or a timestamp) or a dot could
// encode a real host, person, or time -- identifiers are content. Mirrors
// load-reference-set.ts's UNSAFE_ID_PATTERN (checked independently here so a
// content-only regression is caught even if the loader-level check drifts).
const ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const UNSAFE_ID_PATTERN = /\d{4,}|\./;

// ---------------------------------------------------------------------------
// Rule-check functions -- each returns true iff the WHOLE item array satisfies
// the rule. Applied to the real committed set (must be true) and to a
// structuredClone mutated to violate exactly one rule (must be false), so
// every rule in this file has been OBSERVED rejecting something.
// ---------------------------------------------------------------------------

function loadsWithoutThrowing(): boolean {
  loadWcagFixSet(WCAG_FIXES_V1_PATH, 'v1');
  return true;
}

function everyW3cItemHasBothCitations(items: readonly Json[]): boolean {
  return items.every((item) => {
    if (item.provenance.tier !== 'w3c') return true;
    const { failure, technique } = item.provenance;
    if (!failure?.id || !technique?.id) return false;
    if (!String(failure.url).startsWith(TECHNIQUES_URL_PREFIX)) return false;
    if (!String(technique.url).startsWith(TECHNIQUES_URL_PREFIX)) return false;
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(failure.retrievedAt))) return false;
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(technique.retrievedAt))) return false;
    return true;
  });
}

function noItemFixedHtmlEqualsInput(items: readonly Json[]): boolean {
  return items.every((item) => item.expected.fixedHtml !== item.input.htmlContext);
}

function everyDerivedItemHasW3cLabelSource(items: readonly Json[]): boolean {
  return items.every((item) => {
    if (item.provenance.tier !== 'derived') return true;
    const labelSource = item.provenance.labelSource;
    if (!labelSource || labelSource.tier !== 'w3c') return false;
    if (!labelSource.technique?.id) return false;
    return true;
  });
}

function everyIdIsSafe(items: readonly Json[]): boolean {
  return items.every(
    (item) => ID_PATTERN.test(item.id) && !UNSAFE_ID_PATTERN.test(item.id),
  );
}

function atLeastThreePoisonItemsCorrectlyShaped(items: readonly Json[]): boolean {
  const poisonItems = items.filter((item) => item.poison);
  if (poisonItems.length < 3) return false;
  return poisonItems.every((item) => {
    if (item.poison.expect !== 'scored-down') return false;
    if (!item.poison.reason || String(item.poison.reason).length === 0) return false;
    if (item.poison.candidate === undefined || item.poison.candidate === null) return false;
    // A poison candidate that matches the correct answer is not poison.
    if (item.poison.candidate.fixedHtml === item.expected.fixedHtml) return false;
    return true;
  });
}

function atLeastEightDistinctSuccessCriteria(items: readonly Json[]): boolean {
  const sc = new Set(items.map((item) => item.input.wcagCriterion));
  return sc.size >= 8;
}

// ---------------------------------------------------------------------------
// Real-set assertions
// ---------------------------------------------------------------------------

describe('wcag-fixes.v1.json content rules (real committed set)', () => {
  const rawSet = JSON.parse(readFileSync(WCAG_FIXES_V1_PATH, 'utf-8'));
  const items: WcagFixItem[] = rawSet.items;

  it('loads through loadWcagFixSet without throwing', () => {
    expect(loadsWithoutThrowing()).toBe(true);
  });

  it('every w3c-tier item cites both a Failure and a Technique with a valid URL and ISO retrievedAt', () => {
    expect(everyW3cItemHasBothCitations(items)).toBe(true);
  });

  it('no item\'s expected.fixedHtml is byte-identical to its input.htmlContext', () => {
    expect(noItemFixedHtmlEqualsInput(items)).toBe(true);
  });

  it('every derived-tier item has a labelSource whose tier is w3c and which carries a technique citation', () => {
    expect(everyDerivedItemHasW3cLabelSource(items)).toBe(true);
  });

  it('every item id is a safe synthetic slug (no dot, no 4+ digit run)', () => {
    expect(everyIdIsSafe(items)).toBe(true);
  });

  it('at least 3 items carry a correctly-shaped poison flag', () => {
    expect(atLeastThreePoisonItemsCorrectlyShaped(items)).toBe(true);
  });

  it('at least 8 distinct input.wcagCriterion values are present', () => {
    expect(atLeastEightDistinctSuccessCriteria(items)).toBe(true);
  });

  it('has at least 15 w3c-tier items (EVALSET-01 minimum)', () => {
    const w3cItems = items.filter((item) => item.provenance.tier === 'w3c');
    expect(w3cItems.length).toBeGreaterThanOrEqual(15);
  });
});

// ---------------------------------------------------------------------------
// APPLICABILITY CROSS-CHECK -- verifies the SET agrees with OUR RECORD
// (SOURCES.md), not with W3C directly. A wrong row in SOURCES.md propagates
// silently through this check; it only catches a set/SOURCES.md DISAGREEMENT,
// which is why Task 1 records which technique ids were actually opened.
// ---------------------------------------------------------------------------

function parseSourcesRows(markdown: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of markdown.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length > 5 && /^[FGHC][0-9]+$/.test(cells[1])) {
      rows.set(`${cells[1]}|${cells[2]}|${cells[4]}`, (cells[5] || '').toLowerCase());
    }
  }
  return rows;
}

function applicabilityCrossCheck(items: readonly Json[], rows: Map<string, string>): string[] {
  const problems: string[] = [];
  for (const item of items) {
    if (item.provenance.tier !== 'w3c') continue;
    const key = `${item.provenance.failure.id}|${item.provenance.technique.id}|${item.input.wcagCriterion}`;
    const recorded = rows.get(key);
    if (recorded === undefined) {
      problems.push(`${item.id}: no SOURCES.md row for ${key}`);
      continue;
    }
    if (!recorded.startsWith(item.provenance.techniqueRating)) {
      problems.push(
        `${item.id}: rating ${item.provenance.techniqueRating} but SOURCES.md says ${recorded}`,
      );
    }
  }
  return problems;
}

describe('applicability cross-check against SOURCES.md', () => {
  const rawSet = JSON.parse(readFileSync(WCAG_FIXES_V1_PATH, 'utf-8'));
  const items: WcagFixItem[] = rawSet.items;
  const sourcesMd = readFileSync(SOURCES_MD_PATH, 'utf-8');

  it('every w3c-tier item\'s (failure, technique, SC) matches a SOURCES.md row with the same rating', () => {
    const rows = parseSourcesRows(sourcesMd);
    const problems = applicabilityCrossCheck(items, rows);
    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// RULE CONTROLS -- every rule above is shown FAILING against a structuredClone
// mutated to violate exactly that rule. A content gate nobody has watched
// fire is indistinguishable from one that passes everything.
// ---------------------------------------------------------------------------

describe('rule controls', () => {
  const rawSet = JSON.parse(readFileSync(WCAG_FIXES_V1_PATH, 'utf-8'));
  const realItems: WcagFixItem[] = rawSet.items;

  it('CONTROL: everyW3cItemHasBothCitations fails when a w3c item\'s technique citation is deleted', () => {
    const mutated = structuredClone(realItems) as Json[];
    const w3cItem = mutated.find((item) => item.provenance.tier === 'w3c');
    delete w3cItem.provenance.technique;
    expect(everyW3cItemHasBothCitations(mutated)).toBe(false);
    // Sanity: the real set still passes.
    expect(everyW3cItemHasBothCitations(realItems)).toBe(true);
  });

  it('CONTROL: everyW3cItemHasBothCitations fails when a citation URL is not a Techniques URL', () => {
    const mutated = structuredClone(realItems) as Json[];
    const w3cItem = mutated.find((item) => item.provenance.tier === 'w3c');
    w3cItem.provenance.failure.url = 'https://example.com/not-w3c';
    expect(everyW3cItemHasBothCitations(mutated)).toBe(false);
  });

  it('CONTROL: noItemFixedHtmlEqualsInput fails when a fix is set equal to its own input', () => {
    const mutated = structuredClone(realItems) as Json[];
    mutated[0].expected.fixedHtml = mutated[0].input.htmlContext;
    expect(noItemFixedHtmlEqualsInput(mutated)).toBe(false);
    expect(noItemFixedHtmlEqualsInput(realItems)).toBe(true);
  });

  it('CONTROL: everyDerivedItemHasW3cLabelSource fails when a derived item\'s labelSource is downgraded', () => {
    const mutated = structuredClone(realItems) as Json[];
    const derivedItem = mutated.find((item) => item.provenance.tier === 'derived');
    expect(derivedItem).toBeDefined();
    derivedItem.provenance.labelSource = {
      tier: 'owner',
      adjudicatedBy: 'someone',
      adjudicatedAt: '2026-09-05',
      rationale: 'no real citation',
    };
    expect(everyDerivedItemHasW3cLabelSource(mutated)).toBe(false);
    expect(everyDerivedItemHasW3cLabelSource(realItems)).toBe(true);
  });

  it('CONTROL: everyIdIsSafe fails on a dotted id and on a 4+ digit run', () => {
    const dotted = structuredClone(realItems) as Json[];
    dotted[0].id = 'shop.example.com-fix';
    expect(everyIdIsSafe(dotted)).toBe(false);

    const digitRun = structuredClone(realItems) as Json[];
    digitRun[0].id = 'wcag-20260905-fix';
    expect(everyIdIsSafe(digitRun)).toBe(false);

    expect(everyIdIsSafe(realItems)).toBe(true);
  });

  it('CONTROL: atLeastThreePoisonItemsCorrectlyShaped fails when poison count drops below 3', () => {
    const mutated = structuredClone(realItems) as Json[];
    let removed = 0;
    for (const item of mutated) {
      if (item.poison && removed < 1) {
        delete item.poison;
        removed += 1;
      }
    }
    expect(removed).toBe(1);
    expect(atLeastThreePoisonItemsCorrectlyShaped(mutated)).toBe(false);
    expect(atLeastThreePoisonItemsCorrectlyShaped(realItems)).toBe(true);
  });

  it('CONTROL: atLeastThreePoisonItemsCorrectlyShaped fails when a poison candidate matches its own expected answer', () => {
    const mutated = structuredClone(realItems) as Json[];
    const poisonItem = mutated.find((item) => item.poison);
    expect(poisonItem).toBeDefined();
    poisonItem.poison.candidate.fixedHtml = poisonItem.expected.fixedHtml;
    expect(atLeastThreePoisonItemsCorrectlyShaped(mutated)).toBe(false);
  });

  it('CONTROL: atLeastEightDistinctSuccessCriteria fails when items are collapsed onto one SC', () => {
    const mutated = structuredClone(realItems) as Json[];
    for (const item of mutated) {
      item.input.wcagCriterion = '1.1.1';
    }
    expect(atLeastEightDistinctSuccessCriteria(mutated)).toBe(false);
    expect(atLeastEightDistinctSuccessCriteria(realItems)).toBe(true);
  });

  it('CONTROL: applicabilityCrossCheck fails when an item claims a rating SOURCES.md disagrees with', () => {
    const sourcesMd = readFileSync(SOURCES_MD_PATH, 'utf-8');
    const rows = parseSourcesRows(sourcesMd);
    const mutated = structuredClone(realItems) as Json[];
    const w3cItem = mutated.find((item) => item.provenance.tier === 'w3c');
    w3cItem.provenance.techniqueRating =
      w3cItem.provenance.techniqueRating === 'sufficient' ? 'advisory' : 'sufficient';
    const problems = applicabilityCrossCheck(mutated, rows);
    expect(problems.length).toBeGreaterThan(0);
  });

  it('CONTROL: applicabilityCrossCheck fails when an item cites a pair with no SOURCES.md row at all', () => {
    const sourcesMd = readFileSync(SOURCES_MD_PATH, 'utf-8');
    const rows = parseSourcesRows(sourcesMd);
    const mutated = structuredClone(realItems) as Json[];
    const w3cItem = mutated.find((item) => item.provenance.tier === 'w3c');
    w3cItem.provenance.failure.id = 'F9999';
    const problems = applicabilityCrossCheck(mutated, rows);
    expect(problems.length).toBeGreaterThan(0);
  });
});
