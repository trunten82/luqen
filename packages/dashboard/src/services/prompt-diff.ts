import { diffLines } from 'diff';

export interface DiffLine {
  readonly type: 'add' | 'remove' | 'context';
  readonly text: string;
}

/**
 * Computes a unified line diff between oldText and newText using the `diff` npm package.
 * Returns an array of DiffLine entries. Handlebars will escape `text` during rendering.
 * The `text` field is raw (unescaped) — no HTML entities in output.
 */
export function computePromptDiff(oldText: string, newText: string): readonly DiffLine[] {
  const parts = diffLines(oldText, newText);
  const lines: DiffLine[] = [];
  for (const part of parts) {
    const type: DiffLine['type'] = part.added ? 'add' : part.removed ? 'remove' : 'context';
    const rawLines = part.value.split('\n');
    // Drop trailing empty entry produced by trailing newline
    if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop();
    for (const line of rawLines) {
      lines.push({ type, text: line });
    }
  }
  return lines;
}
