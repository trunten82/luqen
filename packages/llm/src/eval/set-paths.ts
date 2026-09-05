import { join } from 'node:path';

/**
 * One named place Phase 84's harness resolves reference-set files from.
 * Package-relative (not `__dirname`-walked), so the same constant is correct
 * whether resolved from `src/` (ts-node/vitest) or from `dist/` (built CLI).
 */
export const REFERENCE_SET_FILES = Object.freeze({
  'wcag-fixes': 'tests/eval/sets/wcag-fixes.v1.json',
  'image-alt': 'tests/eval/sets/image-alt.v1.json',
} as const);

export type ReferenceSetName = keyof typeof REFERENCE_SET_FILES;

export function resolveReferenceSetPath(packageRoot: string, name: ReferenceSetName): string {
  return join(packageRoot, REFERENCE_SET_FILES[name]);
}
