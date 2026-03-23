// ---------------------------------------------------------------------------
// Maps axe-core rule metadata to WcagRule format
// ---------------------------------------------------------------------------

export interface WcagRule {
  readonly code: string;
  readonly description: string;
  readonly level: 'A' | 'AA' | 'AAA';
}

export interface AxeRuleMetadata {
  readonly ruleId: string;
  readonly description: string;
  readonly tags: readonly string[];
}

/**
 * Extracts a WCAG criterion string (e.g. "1.1.1") from an axe-core tag
 * like "wcag111" or "wcag143".
 *
 * Axe tags follow the pattern "wcag" + digits where the digits represent
 * the criterion with dots removed. We reconstruct the dotted form by
 * interpreting the last digit as the sub-criterion, the second-to-last
 * as the guideline, and any leading digits as the principle.
 */
export function parseWcagTag(tag: string): string | null {
  const match = tag.match(/^wcag(\d{3,})$/);
  if (!match) return null;

  const digits = match[1];
  if (digits.length < 3) return null;

  // The format is: principle (1+ digits) . guideline (1 digit) . criterion (1 digit)
  const criterion = digits[digits.length - 1];
  const guideline = digits[digits.length - 2];
  const principle = digits.slice(0, -2);

  return `${principle}.${guideline}.${criterion}`;
}

/**
 * Determines the WCAG conformance level from axe-core tags.
 * Tags like "wcag2a", "wcag2aa", "wcag2aaa", "wcag21a", "wcag21aa", etc.
 */
export function parseWcagLevel(tags: readonly string[]): 'A' | 'AA' | 'AAA' {
  let highest: 'A' | 'AA' | 'AAA' = 'A';

  for (const tag of tags) {
    if (/^wcag\d*aaa$/.test(tag)) return 'AAA';
    if (/^wcag\d*aa$/.test(tag)) highest = 'AA';
  }

  return highest;
}

/**
 * Converts an array of axe-core rule metadata objects into WcagRule[].
 * Only includes rules that have WCAG criterion tags.
 */
export function mapAxeRulesToWcagRules(
  axeRules: readonly AxeRuleMetadata[],
): readonly WcagRule[] {
  const results: WcagRule[] = [];

  for (const rule of axeRules) {
    // Find the first WCAG criterion tag (e.g. "wcag111")
    let criterionCode: string | null = null;
    for (const tag of rule.tags) {
      const parsed = parseWcagTag(tag);
      if (parsed !== null) {
        criterionCode = parsed;
        break;
      }
    }

    // Skip rules without WCAG criterion mapping
    if (criterionCode === null) continue;

    results.push({
      code: criterionCode,
      description: rule.description,
      level: parseWcagLevel(rule.tags),
    });
  }

  return results;
}

/**
 * Builds a lookup map from axe rule ID to WCAG criterion code.
 */
export function buildRuleIdToCriterionMap(
  axeRules: readonly AxeRuleMetadata[],
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();

  for (const rule of axeRules) {
    for (const tag of rule.tags) {
      const parsed = parseWcagTag(tag);
      if (parsed !== null) {
        map.set(rule.ruleId, parsed);
        break;
      }
    }
  }

  return map;
}
