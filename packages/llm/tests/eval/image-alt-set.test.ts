// Content gate for packages/llm/tests/eval/sets/image-alt.v1.json (EVALSET-03/04/05).
//
// Every rule below is proven TWICE: once against the real committed set (must
// hold), and once against a structurally mutated clone built to violate
// EXACTLY that rule (must NOT hold). A content gate nobody has watched fire is
// indistinguishable from one that passes everything, and a gate whose pattern
// cannot match prints the same green as a satisfied one (Task 3 <behavior>).
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadImageAltSet } from '../../src/eval/load-reference-set.js';
import { MissingReferenceAssetError } from '../../src/eval/types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const SET_PATH = join(__dirname, 'sets', 'image-alt.v1.json');
const IMAGES_DIR = join(__dirname, 'images');
const LICENCES_PATH = join(__dirname, 'LICENCES.md');
const CATEGORIES = ['informative', 'complex', 'decorative', 'functional'] as const;
const MEDIA_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function loadRealData(): Json {
  return JSON.parse(readFileSync(SET_PATH, 'utf-8'));
}

function licencesText(): string {
  return readFileSync(LICENCES_PATH, 'utf-8');
}

function clone(data: Json): Json {
  return structuredClone(data);
}

// --- Table-driven content checks -------------------------------------------
// Each entry: `check(data)` must be true for the real set, false for the
// mutated clone `breakIt` produces.
interface ContentCheck {
  name: string;
  check: (data: Json) => boolean;
  breakIt: (data: Json) => Json;
}

const checks: ContentCheck[] = [
  {
    name: 'at least 12 items',
    check: (d) => d.items.length >= 12,
    breakIt: (d) => {
      const m = clone(d);
      m.items = m.items.slice(0, 3);
      return m;
    },
  },
  {
    name: 'each of the four categories appears at least 3 times',
    check: (d) => {
      const counts: Record<string, number> = {};
      for (const item of d.items) counts[item.category] = (counts[item.category] ?? 0) + 1;
      return CATEGORIES.every((c) => (counts[c] ?? 0) >= 3);
    },
    breakIt: (d) => {
      const m = clone(d);
      for (const item of m.items) item.category = 'informative';
      return m;
    },
  },
  {
    name: 'every item has expectedVerdict exactly "issue" or "pass"',
    check: (d) => d.items.every((i: Json) => i.expectedVerdict === 'issue' || i.expectedVerdict === 'pass'),
    breakIt: (d) => {
      const m = clone(d);
      m.items[0].expectedVerdict = 'uncertain';
      return m;
    },
  },
  {
    name: 'at least 4 items pass and at least 4 issue',
    check: (d) => {
      const pass = d.items.filter((i: Json) => i.expectedVerdict === 'pass').length;
      const issue = d.items.filter((i: Json) => i.expectedVerdict === 'issue').length;
      return pass >= 4 && issue >= 4;
    },
    breakIt: (d) => {
      const m = clone(d);
      for (const item of m.items) item.expectedVerdict = 'issue';
      return m;
    },
  },
  {
    name: "altClassification is 'decorative' exactly when category is 'decorative'",
    check: (d) =>
      d.items.every((i: Json) =>
        i.category === 'decorative'
          ? i.expected.altClassification === 'decorative'
          : i.expected.altClassification === 'informational',
      ),
    breakIt: (d) => {
      const m = clone(d);
      const decorative = m.items.find((i: Json) => i.category === 'decorative');
      decorative.expected.altClassification = 'informational';
      return m;
    },
  },
  {
    name: 'decorative items have empty suggestedAlt; non-decorative have non-empty',
    check: (d) =>
      d.items.every((i: Json) =>
        i.category === 'decorative' ? i.expected.suggestedAlt === '' : i.expected.suggestedAlt.length > 0,
      ),
    breakIt: (d) => {
      const m = clone(d);
      const decorative = m.items.find((i: Json) => i.category === 'decorative');
      decorative.expected.suggestedAlt = 'A decorative flourish';
      return m;
    },
  },
  {
    name: "every item's licence is complete and its fileUrl is recorded in LICENCES.md",
    check: (d) => {
      const manifest = licencesText();
      return d.items.every((i: Json) => {
        const lic = i.licence;
        return (
          !!lic?.id &&
          !!lic?.name &&
          !!lic?.author &&
          !!lic?.sourceUrl &&
          !!lic?.fileUrl &&
          !!lic?.retrievedAt &&
          manifest.includes(lic.fileUrl)
        );
      });
    },
    breakIt: (d) => {
      const m = clone(d);
      m.items[0].licence.fileUrl = 'https://example.invalid/not-in-manifest.jpg';
      return m;
    },
  },
  {
    name: 'every item id is a dot-free lowercase slug with no 4+ digit run',
    check: (d) => d.items.every((i: Json) => /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(i.id) && !/\d{4,}/.test(i.id)),
    breakIt: (d) => {
      const m = clone(d);
      m.items[0].id = 'shop.example.com-2024';
      return m;
    },
  },
  {
    name: 'at least 3 poison items with non-empty reason/candidate, and at least one false-PASS',
    check: (d) => {
      const poisoned = d.items.filter((i: Json) => i.poison);
      if (poisoned.length < 3) return false;
      const wellFormed = poisoned.every(
        (i: Json) => i.poison.expect === 'scored-down' && i.poison.reason?.length > 0 && !!i.poison.candidate,
      );
      const hasFalsePass = poisoned.some(
        (i: Json) => i.poison.candidate.verdict === 'pass' && i.expectedVerdict === 'issue',
      );
      return wellFormed && hasFalsePass;
    },
    breakIt: (d) => {
      const m = clone(d);
      for (const item of m.items) delete item.poison;
      return m;
    },
  },
  {
    name: "no poison candidate agrees with its own item's expected/expectedVerdict",
    check: (d) =>
      d.items
        .filter((i: Json) => i.poison)
        .every((i: Json) => {
          const correct = JSON.stringify({
            verdict: i.expectedVerdict,
            altClassification: i.expected.altClassification,
            suggestedAlt: i.expected.suggestedAlt,
          });
          const candidate = JSON.stringify({
            verdict: i.poison.candidate.verdict,
            altClassification: i.poison.candidate.altClassification,
            suggestedAlt: i.poison.candidate.suggestedAlt,
          });
          return correct !== candidate;
        }),
    breakIt: (d) => {
      const m = clone(d);
      const poisoned = m.items.find((i: Json) => i.poison);
      poisoned.poison.candidate = {
        verdict: poisoned.expectedVerdict,
        findings: [],
        altClassification: poisoned.expected.altClassification,
        suggestedAlt: poisoned.expected.suggestedAlt,
      };
      return m;
    },
  },
  {
    name: 'notes disclose both alt-text coverage and the heading-semantics gap',
    check: (d) => /alt-text/.test(String(d.notes)) && /heading-semantics/.test(String(d.notes)),
    breakIt: (d) => {
      const m = clone(d);
      m.notes = 'This set covers analyse-visual.';
      return m;
    },
  },
  // --- Checkpoint remediation (Change 2): licence allowlist -----------------
  // 83-03 Task 2 checkpoint required this be a re-runnable check, not a
  // sentence in a manifest someone has to remember to re-read.
  {
    name: 'every item licence id is cc0/public-domain except a named exception list',
    check: (d) => {
      const allowlist = ['cc0', 'public-domain'];
      const exceptions = ['img-informative-seed']; // CC BY 3.0, inherited from 83-01, attribution required
      return d.items.every((i: Json) => exceptions.includes(i.id) || allowlist.includes(i.licence.id));
    },
    breakIt: (d) => {
      const m = clone(d);
      const nonException = m.items.find((i: Json) => i.id !== 'img-informative-seed');
      nonException.licence.id = 'cc-by-sa-4.0';
      return m;
    },
  },
];

describe('image-alt.v1.json content', () => {
  it('loads through loadImageAltSet(path, "v1") without throwing', () => {
    expect(() => loadImageAltSet(SET_PATH, 'v1')).not.toThrow();
  });

  for (const c of checks) {
    it(`real set satisfies: ${c.name}`, () => {
      expect(c.check(loadRealData())).toBe(true);
    });

    it(`BREAK TEST: mutated copy fails: ${c.name}`, () => {
      const mutated = c.breakIt(loadRealData());
      expect(c.check(mutated)).toBe(false);
    });
  }

  it('every asset file exists and its resolved extension agrees with mediaType', () => {
    const result = loadImageAltSet(SET_PATH, 'v1');
    for (const item of result.items) {
      expect(item.assetPath.endsWith(`.${MEDIA_EXT[item.mediaType]}`)).toBe(true);
      expect(existsSync(item.assetPath)).toBe(true);
    }
  });

  it('BREAK TEST: a mediaType/extension mismatch throws MissingReferenceAssetError', () => {
    // A single-item temp set built from ONE real item, mediaType flipped so
    // the loader's derived path can never match the copied file — exercises
    // the SAME refusal ladder 83-01 built, against this plan's own data.
    const real = loadRealData();
    const source = real.items.find((i: Json) => i.id === 'functional-home-icon');
    const mutated = clone(source);
    mutated.mediaType = 'image/gif'; // real file is .png; loader will look for .gif

    const dir = mkdtempSync(join(tmpdir(), 'luqen-eval-image-alt-'));
    mkdirSync(join(dir, 'sets'), { recursive: true });
    mkdirSync(join(dir, 'images'), { recursive: true });
    writeFileSync(
      join(dir, 'sets', 'image-alt.v1.json'),
      JSON.stringify({ set: 'image-alt', setVersion: 'v1', capability: 'analyse-visual', items: [mutated] }),
    );
    copyFileSync(join(IMAGES_DIR, 'functional-home-icon.png'), join(dir, 'images', 'functional-home-icon.png'));

    expect(() => loadImageAltSet(join(dir, 'sets', 'image-alt.v1.json'), 'v1')).toThrow(MissingReferenceAssetError);
  });

  // --- Checkpoint remediation (Change 3): repaired W3C-basename gate --------
  // The plan's original Task 1 <verify> grep, `(dog|family|peafowl|chart|
  // castle|kew)\.(jpg|jpeg|png)$`, matches any filename ENDING in e.g.
  // "chart.png" — a path-suffix match, not a whole-basename match — so it
  // false-positively rejected legitimately-sourced files such as
  // "complex-energy-chart.png". Anchored on the whole basename here instead.
  const W3C_TUTORIAL_BASENAME = /^(dog|family|peafowl|chart|castle|kew)\.(jpe?g|png)$/i;

  it('no committed asset basename matches an actual W3C wai-tutorial-images filename', () => {
    const basenames = readdirSync(IMAGES_DIR);
    expect(basenames.some((n) => W3C_TUTORIAL_BASENAME.test(n))).toBe(false);
  });

  it('BREAK TEST (repaired gate, direction a): still rejects a literal "chart.png"', () => {
    expect(W3C_TUTORIAL_BASENAME.test('chart.png')).toBe(true);
  });

  it('BREAK TEST (repaired gate, direction b): no longer over-matches "complex-energy-chart.png"', () => {
    // This is the exact shape the ORIGINAL suffix-matching grep rejected in
    // error during Task 1 (see 83-03-SUMMARY.md Deviations).
    expect(W3C_TUTORIAL_BASENAME.test('complex-energy-chart.png')).toBe(false);
  });
});
