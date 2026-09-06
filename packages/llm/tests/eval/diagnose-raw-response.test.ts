/**
 * `diagnoseRawResponse` — five raw-response states, pure over the raw text
 * alone (Phase 84, HARNESS-06).
 *
 * This is the half of HARNESS-06 that makes the 84-01 seam (rawText on
 * CapabilityResult) worth having. Persisting the raw text is necessary and
 * not sufficient: an all-empty or degraded parse must be DISTINGUISHABLE
 * from a genuine low score, and at the PARSED layer it is not, in either
 * direction — `parseGenerateFixResponse` returns a real `effort: 'medium'`
 * on failure and a real model can legitimately return an empty `fixedHtml`;
 * `parseAnalyseVisualResponse` returns `verdict: 'uncertain'` on failure and
 * a real model can legitimately return `'uncertain'` as a genuine answer.
 * Each test below pairs the diagnostic's verdict about the RAW text with
 * the capability parser's verdict about the SAME text, so both facts are
 * visible together and only their combination is unambiguous.
 */
import { describe, it, expect } from 'vitest';
import { diagnoseRawResponse } from '../../src/eval/diagnose-raw-response.js';
import { parseAnalyseVisualResponse } from '../../src/capabilities/analyse-visual.js';
import { parseGenerateFixResponse } from '../../src/capabilities/generate-fix.js';

describe('diagnoseRawResponse — five states, pure over raw text alone (HARNESS-06)', () => {
  it('valid JSON with an explicit verdict of pass: present, parseable, verdict asserted', () => {
    const rawText = '{"verdict":"pass","findings":[]}';
    const diagnosis = diagnoseRawResponse(rawText);
    expect(diagnosis.present).toBe(true);
    expect(diagnosis.nonEmpty).toBe(true);
    expect(diagnosis.parseable).toBe(true);
    expect(diagnosis.verdictAsserted).toBe(true);

    // Paired capability fact: this is a GENUINE pass -- the model actually
    // said 'pass', not the parser's manufactured default.
    const parsed = parseAnalyseVisualResponse(rawText, 'alt-text');
    expect(parsed.verdict).toBe('pass');
  });

  it('valid JSON with no verdict and no findings: present, parseable, verdict NOT asserted -- while the capability reports pass', () => {
    const rawText = '{}';
    const diagnosis = diagnoseRawResponse(rawText);
    expect(diagnosis.present).toBe(true);
    expect(diagnosis.nonEmpty).toBe(true);
    expect(diagnosis.parseable).toBe(true);
    expect(diagnosis.verdictAsserted).toBe(false);

    // Paired capability fact: analyse-visual.ts:51-53 manufactures 'pass'
    // here even though the model never asserted a verdict. The diagnostic's
    // verdictAsserted=false is what separates this MANUFACTURED pass from
    // the genuine pass above -- at the parsed layer alone the two are
    // identical (both report verdict: 'pass').
    const parsed = parseAnalyseVisualResponse(rawText, 'alt-text');
    expect(parsed.verdict).toBe('pass');
  });

  it('text that is not valid JSON: present, not parseable -- while the capability swallows the failure into uncertain', () => {
    const rawText = 'the model rambled instead of returning JSON';
    const diagnosis = diagnoseRawResponse(rawText);
    expect(diagnosis.present).toBe(true);
    expect(diagnosis.nonEmpty).toBe(true);
    expect(diagnosis.parseable).toBe(false);
    expect(diagnosis.verdictAsserted).toBe(false);

    // Paired capability fact: a genuine low-confidence model answer can
    // ALSO produce verdict: 'uncertain' with no findings -- the parsed
    // layer alone cannot tell a swallowed parse failure from a real
    // uncertain answer. parseable=false is what makes this case legible.
    const parsed = parseAnalyseVisualResponse(rawText, 'alt-text');
    expect(parsed.verdict).toBe('uncertain');
    expect(parsed.findings).toEqual([]);

    // generate-fix's own degraded default on the same unparseable text.
    const genFixParsed = parseGenerateFixResponse(rawText);
    expect(genFixParsed.fixedHtml).toBe('');
    expect(genFixParsed.effort).toBe('medium');
  });

  it('an empty string: present but empty, distinctly from the not-parseable case', () => {
    const diagnosis = diagnoseRawResponse('');
    expect(diagnosis.present).toBe(true);
    expect(diagnosis.nonEmpty).toBe(false);
    expect(diagnosis.parseable).toBe(false);
    expect(diagnosis.verdictAsserted).toBe(false);
  });

  it('no raw response at all: reports absent, never silently read as any of the above', () => {
    const diagnosis = diagnoseRawResponse(undefined);
    expect(diagnosis.present).toBe(false);
    expect(diagnosis.nonEmpty).toBe(false);
    expect(diagnosis.parseable).toBe(false);
    expect(diagnosis.verdictAsserted).toBe(false);
  });

  it('is a pure function of the raw text alone -- takes no item, no expected value, no score', () => {
    // Type-level check: diagnoseRawResponse's signature is (rawText: string
    // | undefined) => RawResponseDiagnosis. Calling it with only raw text
    // and asserting deterministic output is the behavioral proof of purity.
    const rawText = '{"verdict":"issue","findings":[]}';
    expect(diagnoseRawResponse(rawText)).toEqual(diagnoseRawResponse(rawText));
  });

  it('handles fenced JSON the same way the capability parsers strip fences', () => {
    const rawText = '```json\n{"verdict":"pass","findings":[]}\n```';
    const diagnosis = diagnoseRawResponse(rawText);
    expect(diagnosis.parseable).toBe(true);
    expect(diagnosis.verdictAsserted).toBe(true);
  });
});
