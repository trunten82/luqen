/**
 * Prompt segment parser and override validator for LLM prompt management.
 *
 * Fence syntax:
 *   <!-- LOCKED:kebab-name -->
 *   ...content...
 *   <!-- /LOCKED -->
 *
 * Locked segments cannot be modified, renamed, reordered, or removed
 * by org-admin overrides. Validation runs at save time (PUT endpoint).
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PromptSegment {
  readonly type: 'locked' | 'editable';
  readonly name?: string;   // kebab-case; only set when type === 'locked'
  readonly content: string; // raw text, fence markers NOT included
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly violations: ReadonlyArray<{
    readonly name: string;
    readonly reason: 'missing' | 'modified' | 'renamed' | 'reordered';
  }>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Static lookup: kebab-case section name → short user-facing explanation
 * of why the section is locked.
 */
export const LOCKED_SECTION_EXPLANATIONS: Readonly<Record<string, string>> = Object.freeze({
  'output-format': 'This section defines the required JSON response schema. The capability engine cannot parse responses without it.',
  'variable-injection': 'This section injects runtime data (WCAG criterion, HTML context, etc.) into the prompt. Removing or editing it breaks the capability.',
});

// ─── Parser ─────────────────────────────────────────────────────────────────

/**
 * Regex pattern string for a valid kebab-case locked section name.
 * Names consist of letters, digits, and hyphens (not empty, not starting/ending with hyphen).
 */
const LOCKED_NAME_PATTERN = '[a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9]';

/**
 * Regex for a single LOCKED fence block.
 * Capture group 1: section name (kebab-case: letters, digits, hyphens only).
 * Capture group 2: content between the fences (may span newlines, non-greedy).
 */
const FENCE_REGEX = new RegExp(
  `<!-- LOCKED:(${LOCKED_NAME_PATTERN}) -->([\\s\\S]*?)<!-- \\/LOCKED -->`,
  'g',
);

/**
 * Parses a prompt template string into an ordered sequence of segments.
 *
 * - On unclosed fence or other parse error: returns the entire template as a
 *   single editable segment (graceful fallback, no throw).
 * - Empty editable segments (zero-length gaps) are omitted.
 */
export function parsePromptSegments(template: string): readonly PromptSegment[] {
  // Validate: count opening and closing fences. If they don't match, fall back.
  const openCount = (template.match(new RegExp(`<!-- LOCKED:(${LOCKED_NAME_PATTERN}) -->`, 'g')) ?? []).length;
  const closeCount = (template.match(/<!-- \/LOCKED -->/g) ?? []).length;

  if (openCount !== closeCount) {
    return [{ type: 'editable', content: template }];
  }

  // If no fences at all, return single editable immediately
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

    // Emit editable segment for the gap before this locked block
    if (fenceStart > lastIndex) {
      const editableContent = template.slice(lastIndex, fenceStart);
      if (editableContent.length > 0) {
        segments.push({ type: 'editable', content: editableContent });
      }
    }

    // Emit the locked segment
    segments.push({ type: 'locked', name, content });

    lastIndex = fenceEnd;
  }

  // Emit any trailing editable segment
  if (lastIndex < template.length) {
    const trailing = template.slice(lastIndex);
    if (trailing.length > 0) {
      segments.push({ type: 'editable', content: trailing });
    }
  }

  return segments;
}

// ─── Validator ──────────────────────────────────────────────────────────────

/**
 * Validates that `override` preserves all locked blocks declared in
 * `defaultTemplate`. Returns {ok: true} if all checks pass.
 *
 * Rules (default-declared locks only):
 * - missing:   a locked block from the default is absent in the override
 * - modified:  the block exists but its content differs (byte comparison)
 * - reordered: the positional order of locked block names differs
 * - renamed:   treated as "missing" (original name absent)
 *
 * Extra locked blocks in the override that are NOT in the default are ignored.
 */
export function validateOverride(
  override: string,
  defaultTemplate: string,
): ValidationResult {
  const defaultSegments = parsePromptSegments(defaultTemplate);
  const defaultLocked = defaultSegments.filter((s) => s.type === 'locked');

  // No locked blocks in default → always valid
  if (defaultLocked.length === 0) {
    return { ok: true, violations: [] };
  }

  const overrideSegments = parsePromptSegments(override);
  const overrideLocked = overrideSegments.filter((s) => s.type === 'locked');

  // Build a map from name → content for the override locked blocks
  const overrideMap = new Map<string, string>();
  const overrideOrder: string[] = [];
  for (const seg of overrideLocked) {
    if (seg.name != null && !overrideMap.has(seg.name)) {
      overrideMap.set(seg.name, seg.content);
      overrideOrder.push(seg.name);
    }
  }

  const defaultOrder: string[] = defaultLocked
    .map((s) => s.name)
    .filter((n): n is string => n != null);

  const violations: Array<{ name: string; reason: 'missing' | 'modified' | 'renamed' | 'reordered' }> = [];
  const seenNames = new Set<string>();

  // Check missing / modified
  for (const seg of defaultLocked) {
    const name = seg.name;
    if (name == null || seenNames.has(name)) continue;
    seenNames.add(name);

    if (!overrideMap.has(name)) {
      violations.push({ name, reason: 'missing' });
    } else if (overrideMap.get(name) !== seg.content) {
      violations.push({ name, reason: 'modified' });
    }
  }

  // Check reordering: compare the positional sequence of names present in both
  const defaultPresentInOverride = defaultOrder.filter((n) => overrideMap.has(n));
  const overridePresentInDefault = overrideOrder.filter((n) => defaultOrder.includes(n));

  if (defaultPresentInOverride.join(',') !== overridePresentInDefault.join(',')) {
    const reorderedSeen = new Set<string>();
    for (let i = 0; i < defaultPresentInOverride.length; i++) {
      const expectedName = defaultPresentInOverride[i];
      const actualName = overridePresentInDefault[i];
      if (expectedName !== actualName && expectedName != null && !reorderedSeen.has(expectedName)) {
        reorderedSeen.add(expectedName);
        // Replace existing violation for this name with 'reordered'
        const existingIdx = violations.findIndex((v) => v.name === expectedName);
        if (existingIdx >= 0) {
          violations.splice(existingIdx, 1, { name: expectedName, reason: 'reordered' });
        } else {
          violations.push({ name: expectedName, reason: 'reordered' });
        }
      }
    }
  }

  return violations.length === 0
    ? { ok: true, violations: [] }
    : { ok: false, violations };
}
