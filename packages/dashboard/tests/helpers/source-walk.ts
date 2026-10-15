/** Helpers for tests that read the dashboard's own source files. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** True for a line that is only a comment (line comment, block-comment opener or continuation). */
export function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

/** Every `.ts` file (not `.d.ts`) under `dir`, recursively, as absolute paths. */
export function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      out.push(...walkTs(abs));
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(abs);
    }
  }
  return out;
}

/** Every `.ts` file under `root` as `[path relative to root, source text]`. */
export function readSources(root: string): ReadonlyMap<string, string> {
  return new Map(walkTs(root).map((abs) => [relative(root, abs), readFileSync(abs, 'utf8')] as const));
}
