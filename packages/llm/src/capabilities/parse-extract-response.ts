import type { ExtractedRequirements } from '../types.js';

export function parseExtractedRequirements(raw: string): ExtractedRequirements {
  const cleaned = raw
    .replace(/^```(?:json)?\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim();

  const parsed = JSON.parse(cleaned) as {
    wcagVersion?: string;
    wcagLevel?: string;
    criteria?: Array<{
      criterion?: string;
      obligation?: string;
      notes?: string;
    }>;
    confidence?: number;
  };

  return {
    wcagVersion: parsed.wcagVersion ?? 'unknown',
    wcagLevel: parsed.wcagLevel ?? 'unknown',
    criteria: (parsed.criteria ?? [])
      .filter((c) => c.criterion && c.obligation)
      .map((c) => ({
        criterion: c.criterion!,
        obligation: c.obligation as 'mandatory' | 'recommended' | 'optional' | 'excluded',
        ...(c.notes ? { notes: c.notes } : {}),
      })),
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
  };
}
