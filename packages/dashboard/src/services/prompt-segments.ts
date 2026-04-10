/**
 * Dashboard-side prompt segment utilities.
 *
 * Mirrors the LLM package's parsePromptSegments/PromptSegment types.
 * The @luqen/llm package is not in the dashboard's dependencies, so this file
 * contains a local copy of the parser plus the dashboard-specific assembler
 * and stale-override detector.
 *
 * Fence syntax:
 *   LOCKED:kebab-name fence start
 *   ...content...
 *   /LOCKED fence end
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PromptSegment {
  readonly type: 'locked' | 'editable';
  readonly name?: string;   // kebab-case; only set when type === 'locked'
  readonly content: string; // raw text, fence markers NOT included
}

export interface AssembleInput {
  readonly defaultSegments: readonly PromptSegment[];
  readonly editableValues: readonly string[];
}

export interface StaleDetection {
  readonly isStale: boolean;
  readonly missingLockNames: readonly string[];
  /**
   * When stale: one entry = whole override text (becomes the first editable textarea).
   * When not stale: empty array.
   */
  readonly extractedEditables: readonly string[];
}

// ─── Parser (mirrored from packages/llm/src/prompts/segments.ts) ────────────

const LOCKED_NAME_PATTERN = '[a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9]';

const FENCE_OPEN_RE = new RegExp(`<!-- LOCKED:(${LOCKED_NAME_PATTERN}) -->`, 'g');
const FENCE_CLOSE_RE = /<!-- \/LOCKED -->/g;
const FENCE_REGEX = new RegExp(
  `<!-- LOCKED:(${LOCKED_NAME_PATTERN}) -->([\\s\\S]*?)<!-- \\/LOCKED -->`,
  'g',
);

/**
 * Parses a prompt template string into an ordered sequence of segments.
 *
 * - On unclosed fence: returns the entire template as a single editable segment.
 * - Empty editable segments (zero-length gaps) are omitted.
 */
export function parsePromptSegments(template: string): readonly PromptSegment[] {
  const openCount = (template.match(FENCE_OPEN_RE) ?? []).length;
  const closeCount = (template.match(FENCE_CLOSE_RE) ?? []).length;

  if (openCount !== closeCount) {
    return [{ type: 'editable', content: template }];
  }

  if (openCount === 0) {
    return [{ type: 'editable', content: template }];
  }

  const segments: PromptSegment[] = [];
  let lastIndex = 0;

  FENCE_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = FENCE_REGEX.exec(template)) !== null) {
    const fenceStart = match.index;
    const fenceEnd = fenceStart + match[0].length;
    const name = match[1];
    const content = match[2] ?? '';

    if (fenceStart > lastIndex) {
      const editableContent = template.slice(lastIndex, fenceStart);
      if (editableContent.length > 0) {
        segments.push({ type: 'editable', content: editableContent });
      }
    }

    segments.push({ type: 'locked', name, content });
    lastIndex = fenceEnd;
  }

  if (lastIndex < template.length) {
    const trailing = template.slice(lastIndex);
    if (trailing.length > 0) {
      segments.push({ type: 'editable', content: trailing });
    }
  }

  return segments;
}

// ─── Assembler ───────────────────────────────────────────────────────────────

/**
 * Reassembles a full prompt template by walking defaultSegments in order:
 * - Locked segments: emit the fence markers + content from the default (verbatim)
 * - Editable segments: emit the next value from editableValues
 *
 * Security invariant: locked content is ALWAYS taken from the default, never
 * from form input. This prevents template injection via hidden fields (T-13-07).
 *
 * Throws if editableValues.length !== number of editable segments in defaultSegments.
 */
export function assembleTemplate(input: AssembleInput): string {
  const { defaultSegments, editableValues } = input;

  const editableCount = defaultSegments.filter((s) => s.type === 'editable').length;
  if (editableValues.length !== editableCount) {
    throw new Error(
      `assembleTemplate: expected ${editableCount} editable value(s), got ${editableValues.length}`,
    );
  }

  const parts: string[] = [];
  let editableIdx = 0;

  for (const seg of defaultSegments) {
    if (seg.type === 'locked') {
      parts.push(`<!-- LOCKED:${seg.name} -->${seg.content}<!-- /LOCKED -->`);
    } else {
      parts.push(editableValues[editableIdx] ?? '');
      editableIdx++;
    }
  }

  return parts.join('');
}

// ─── Stale Override Detector ─────────────────────────────────────────────────

/**
 * Detects whether an existing override was saved before fence markers existed.
 *
 * Returns { isStale: true, missingLockNames, extractedEditables: [override] }
 * if any default locked block is absent from the override.
 *
 * Returns non-stale for empty/whitespace-only overrides (no override exists;
 * caller should use the default's editable segments directly).
 */
export function detectStaleOverride(
  override: string,
  defaultSegments: readonly PromptSegment[],
): StaleDetection {
  if (!override.trim()) {
    return { isStale: false, missingLockNames: [], extractedEditables: [] };
  }

  const expectedLockedNames = defaultSegments
    .filter((s): s is PromptSegment & { type: 'locked'; name: string } =>
      s.type === 'locked' && s.name != null,
    )
    .map((s) => s.name);

  if (expectedLockedNames.length === 0) {
    // Default has no locked sections — any override is valid
    return { isStale: false, missingLockNames: [], extractedEditables: [] };
  }

  const overrideSegments = parsePromptSegments(override);
  const overrideLockedNames = overrideSegments
    .filter((s) => s.type === 'locked' && s.name != null)
    .map((s) => s.name as string);

  const missingLockNames = expectedLockedNames.filter(
    (n) => !overrideLockedNames.includes(n),
  );

  if (missingLockNames.length > 0) {
    return {
      isStale: true,
      missingLockNames,
      // extractedEditables has the whole override as the first entry.
      // The editor will pre-fill the first textarea with the old override content
      // so the user can manually re-split if needed after Migrate.
      extractedEditables: [override],
    };
  }

  return { isStale: false, missingLockNames: [], extractedEditables: [] };
}
