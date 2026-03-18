export interface MatchResult {
  readonly line?: number;
  readonly confidence: 'high' | 'low' | 'none';
}

function extractLastElementType(selector: string): string | null {
  // Remove pseudo-classes/elements and attribute selectors
  const cleaned = selector
    .replace(/::?[\w-]+(\(.*?\))?/g, '')
    .replace(/\[.*?\]/g, '')
    .trim();

  // Split by combinators and whitespace, get last token
  const parts = cleaned.split(/[\s>+~]+/).filter(Boolean);
  if (parts.length === 0) return null;

  const last = parts[parts.length - 1];
  // Extract tag name (before . # [)
  const match = last.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
  return match ? match[1].toLowerCase() : null;
}

export function matchSelectorToSource(selector: string, source: string): MatchResult {
  const elementType = extractLastElementType(selector);

  if (!elementType) {
    return { confidence: 'none' };
  }

  const lines = source.split('\n');
  const pattern = new RegExp(`<${elementType}[\\s>/]`, 'i');
  const matchingLines: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      matchingLines.push(i + 1); // 1-based line numbers
    }
  }

  if (matchingLines.length === 0) {
    return { confidence: 'none' };
  }

  if (matchingLines.length === 1) {
    return { line: matchingLines[0], confidence: 'high' };
  }

  return { line: matchingLines[0], confidence: 'low' };
}
