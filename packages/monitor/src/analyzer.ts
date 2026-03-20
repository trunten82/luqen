import type { SourceType } from './sources.js';

// ---- Types ----

export interface ChangeSection {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly modified: readonly string[];
}

export interface AnalysisResult {
  readonly changed: boolean;
  readonly summary: string;
  readonly sections: ChangeSection;
}

// ---- Paragraph splitting ----

/**
 * Split text content into logical paragraphs / sentences for diffing.
 * We split on double newlines or sentence-ending punctuation followed by
 * whitespace, then filter out empty strings.
 */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}|(?<=[.!?])\s{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/**
 * Split RSS / API content line by line (each entry is already one line
 * from the normalisation step).
 */
export function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// ---- Set diff helpers ----

function setOf(items: readonly string[]): Set<string> {
  return new Set(items);
}

function added(oldSet: Set<string>, newSet: Set<string>): string[] {
  return [...newSet].filter((item) => !oldSet.has(item));
}

function removed(oldSet: Set<string>, newSet: Set<string>): string[] {
  return [...oldSet].filter((item) => !newSet.has(item));
}

/**
 * Find lines that were reworded: present in both old and new but with minor
 * edits. We use a simple heuristic: if a removed line and an added line share
 * more than 50% of their words, treat them as a "modified" pair.
 */
function findModified(removedItems: string[], addedItems: string[]): {
  readonly modified: string[];
  readonly stillRemoved: string[];
  readonly stillAdded: string[];
} {
  const modified: string[] = [];
  const matchedRemoved = new Set<number>();
  const matchedAdded = new Set<number>();

  for (let ri = 0; ri < removedItems.length; ri++) {
    const rWords = new Set(removedItems[ri].toLowerCase().split(/\s+/));
    for (let ai = 0; ai < addedItems.length; ai++) {
      if (matchedAdded.has(ai)) continue;
      const aWords = new Set(addedItems[ai].toLowerCase().split(/\s+/));
      const intersection = [...rWords].filter((w) => aWords.has(w)).length;
      const union = new Set([...rWords, ...aWords]).size;
      const similarity = union > 0 ? intersection / union : 0;
      if (similarity > 0.5) {
        modified.push(`"${removedItems[ri]}" → "${addedItems[ai]}"`);
        matchedRemoved.add(ri);
        matchedAdded.add(ai);
        break;
      }
    }
  }

  return {
    modified,
    stillRemoved: removedItems.filter((_, i) => !matchedRemoved.has(i)),
    stillAdded: addedItems.filter((_, i) => !matchedAdded.has(i)),
  };
}

// ---- Main analysis function ----

/**
 * Analyse changes between old and new content for a given source type.
 * Returns a structured diff without requiring an LLM.
 */
export function analyzeChanges(
  sourceType: SourceType,
  oldContent: string,
  newContent: string,
): AnalysisResult {
  if (oldContent === newContent) {
    return {
      changed: false,
      summary: 'No changes detected.',
      sections: { added: [], removed: [], modified: [] },
    };
  }

  const split = sourceType === 'html' ? splitParagraphs : splitLines;
  const oldItems = split(oldContent);
  const newItems = split(newContent);

  const oldSet = setOf(oldItems);
  const newSet = setOf(newItems);

  const rawRemoved = removed(oldSet, newSet);
  const rawAdded = added(oldSet, newSet);

  const { modified, stillRemoved, stillAdded } = findModified(rawRemoved, rawAdded);

  const sections: ChangeSection = {
    added: stillAdded,
    removed: stillRemoved,
    modified,
  };

  const summary = buildSummary(sections);

  return {
    changed: true,
    summary,
    sections,
  };
}

function buildSummary(sections: ChangeSection): string {
  const parts: string[] = [];

  if (sections.added.length > 0) {
    parts.push(
      `${sections.added.length} new section${sections.added.length === 1 ? '' : 's'} added`,
    );
  }
  if (sections.removed.length > 0) {
    parts.push(
      `${sections.removed.length} section${sections.removed.length === 1 ? '' : 's'} removed`,
    );
  }
  if (sections.modified.length > 0) {
    parts.push(
      `${sections.modified.length} section${sections.modified.length === 1 ? '' : 's'} modified`,
    );
  }

  if (parts.length === 0) {
    return 'Content changed (whitespace or formatting only).';
  }

  return parts.join(', ') + '.';
}
