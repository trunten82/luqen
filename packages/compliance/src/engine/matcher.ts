export interface ParsedIssueCode {
  readonly criterion: string;
  readonly level: 'A' | 'AA' | 'AAA';
}

const CRITERION_PATTERN = /(\d+_\d+_\d+)/;
const LEVEL_PATTERN = /^WCAG2(AAA|AA|A)\./;

export function extractCriterion(code: string): string | null {
  const match = CRITERION_PATTERN.exec(code);
  if (!match) return null;
  return match[1].replace(/_/g, '.');
}

export function extractLevel(
  code: string,
): 'A' | 'AA' | 'AAA' | null {
  const match = LEVEL_PATTERN.exec(code);
  if (!match) return null;
  return match[1] as 'A' | 'AA' | 'AAA';
}

export function parseIssueCode(code: string): ParsedIssueCode | null {
  const criterion = extractCriterion(code);
  const level = extractLevel(code);
  if (!criterion || !level) return null;
  return { criterion, level };
}
