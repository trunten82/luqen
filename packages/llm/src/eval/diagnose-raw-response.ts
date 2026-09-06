/**
 * `diagnoseRawResponse` — five raw-response states, pure over the raw text
 * alone (Phase 84, HARNESS-06).
 *
 * This sits BESIDE a score, not as a second opinion about it: it returns
 * labelled states, never a judgement and never a score. It is the half of
 * HARNESS-06 that makes persisting `CapabilityResult.rawText` (84-01) worth
 * having, because an all-empty or degraded parse is NOT distinguishable
 * from a genuine low score at the parsed layer alone, in either direction:
 *
 * - `parseGenerateFixResponse` returns `{ fixedHtml: '', explanation: '',
 *   effort: 'medium' }` on failure -- and a real model can legitimately
 *   return an empty `fixedHtml` for other reasons (one committed poison
 *   item encodes exactly this).
 * - `parseAnalyseVisualResponse` returns `{ verdict: 'uncertain', findings:
 *   [] }` on failure -- and `'uncertain'` is a real, valid value a
 *   successfully parsed response can also carry.
 * - `parseAnalyseVisualResponse` additionally MANUFACTURES `verdict: 'pass'`
 *   on a response that parses cleanly but carries no verdict and no
 *   findings (`analyse-visual.ts:51-53`) -- structurally identical, at the
 *   parsed layer, to a genuine confident pass.
 *
 * `diagnoseRawResponse` never infers a parse failure from any parsed field
 * value; it inspects the raw text directly, after the same fence-stripping
 * the capability parsers apply, and reports whether a `verdict` field was
 * actually asserted in it -- independent of what either capability's parser
 * produced from the same text.
 */

export interface RawResponseDiagnosis {
  /** false only when rawText itself is undefined -- the pre-84-01 state. */
  readonly present: boolean;
  /** false when rawText is undefined or empty/whitespace-only. */
  readonly nonEmpty: boolean;
  /** true iff the text parses as JSON after fence-stripping. */
  readonly parseable: boolean;
  /** true iff the parsed JSON carries an explicit, non-empty `verdict` string. */
  readonly verdictAsserted: boolean;
}

const ABSENT_OR_EMPTY: Omit<RawResponseDiagnosis, 'present' | 'nonEmpty'> = {
  parseable: false,
  verdictAsserted: false,
};

/** Mirrors the fence-stripping both capability parsers apply, so `parseable` reflects the same input they would see. */
function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

export function diagnoseRawResponse(rawText: string | undefined): RawResponseDiagnosis {
  if (rawText === undefined) {
    return { present: false, nonEmpty: false, ...ABSENT_OR_EMPTY };
  }

  const nonEmpty = rawText.trim().length > 0;
  if (!nonEmpty) {
    return { present: true, nonEmpty: false, ...ABSENT_OR_EMPTY };
  }

  const cleaned = stripFences(rawText);
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  const candidate = jsonMatch ? jsonMatch[0] : cleaned;

  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const verdictAsserted = typeof parsed === 'object'
      && parsed !== null
      && typeof parsed['verdict'] === 'string'
      && (parsed['verdict'] as string).length > 0;

    return { present: true, nonEmpty: true, parseable: true, verdictAsserted };
  } catch {
    return { present: true, nonEmpty: true, parseable: false, verdictAsserted: false };
  }
}
