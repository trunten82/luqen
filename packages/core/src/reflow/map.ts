/**
 * Pure mapping from reflow observations to shared Issues.
 *
 * Kept free of any browser runtime so it can be unit-tested in the fast
 * (non-browser) vitest tier. The runner (`./index.ts`) gathers a serializable
 * {@link ReflowObservation}[] in-page and feeds it into {@link mapReflowObservations}.
 *
 * Each observation kind maps to a single WCAG success criterion (underscore
 * form, embedded into the Issue `code` so the downstream `extractCriterion()`
 * regex maps it) and a fixed Issue type:
 *
 *   - `page-overflow`    → 1.4.10 Reflow, error
 *       The document requires horizontal scrolling at 320 CSS px (a single
 *       column of content forced into two-dimensional scrolling) — the
 *       canonical Reflow failure.
 *   - `element-overflow` → 1.4.10 Reflow, warning
 *       A specific element extends past the 320px viewport. Conservative
 *       (warning, not error): WCAG 1.4.10 exempts content that genuinely needs
 *       a 2D layout (data tables, maps, complex diagrams), so an element that
 *       overflows is evidence rather than a definite failure.
 *   - `zoom-disabled`    → 1.4.4 Resize text, error
 *       A viewport meta tag locks zoom (`user-scalable=no`/`0` or
 *       `maximum-scale` < 2), preventing the 200% zoom 1.4.4 requires.
 *
 * Conservative-by-design (matches the project's legal-defensibility stance):
 * only observations whose kind is in {@link KIND_MAP} are emitted; anything
 * else is skipped rather than attributed to a guessed criterion. One Issue per
 * observation, capped to {@link MAX_ISSUES}.
 */

import type { Issue } from '../types.js';

/** Max issues emitted from a single page, to avoid flooding. */
export const MAX_ISSUES = 500;

/** The kinds of reflow problem the in-page probe can report. */
export type ReflowObservationKind =
  | 'page-overflow'
  | 'element-overflow'
  | 'zoom-disabled';

/**
 * A single serializable observation gathered by the in-page probe. Plain data
 * only (it crosses the puppeteer `page.evaluate` boundary).
 */
export interface ReflowObservation {
  readonly kind: ReflowObservationKind;
  /** CSS-ish selector for the offending node (defaults to 'html'). */
  readonly selector?: string;
  /** Short HTML/context snippet for the node. */
  readonly snippet?: string;
  /** Human-readable description; a per-kind default is used when absent. */
  readonly message?: string;
}

/** Reflow observation kind → { WCAG criterion (underscore form), Issue type }. */
export const KIND_MAP: Readonly<
  Record<ReflowObservationKind, { readonly criterion: string; readonly type: Issue['type'] }>
> = {
  'page-overflow': { criterion: '1_4_10', type: 'error' },
  'element-overflow': { criterion: '1_4_10', type: 'warning' },
  'zoom-disabled': { criterion: '1_4_4', type: 'error' },
};

/** Default messages per kind, used when an observation omits its own. */
const DEFAULT_MESSAGE: Readonly<Record<ReflowObservationKind, string>> = {
  'page-overflow':
    'Content requires horizontal scrolling at 320 CSS px (400% zoom) — fails Reflow (WCAG 1.4.10)',
  'element-overflow':
    'Element extends beyond the 320 CSS px viewport, causing horizontal scrolling or content loss at 400% zoom (WCAG 1.4.10)',
  'zoom-disabled':
    'Viewport meta tag prevents zooming — fails Resize text (WCAG 1.4.4)',
};

/** Truncate a snippet/context to a bounded length. */
function clip(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/** Build one Issue for an attributable reflow observation. */
function toIssue(
  observation: ReflowObservation,
  criterion: string,
  type: Issue['type'],
): Issue {
  const kindCode = observation.kind.replace(/-/g, '_');
  const snippet = observation.snippet ?? '';
  return {
    type,
    code: `Luqen.Reflow.${criterion}.${kindCode}`,
    message: (observation.message ?? DEFAULT_MESSAGE[observation.kind]).trim(),
    selector: observation.selector || 'html',
    context: snippet ? clip(snippet) : '',
    runner: 'reflow',
  };
}

/**
 * Map reflow observations to the shared Issue list.
 *
 * Pure: no I/O, no globals. Only observations whose kind is attributable (in
 * {@link KIND_MAP}) become Issues, capped at `max`.
 *
 * @param observations  observations gathered in-page (or undefined on failure)
 * @param max           maximum issues to emit (default {@link MAX_ISSUES})
 */
export function mapReflowObservations(
  observations: readonly ReflowObservation[] | undefined,
  max = MAX_ISSUES,
): Issue[] {
  if (!Array.isArray(observations)) return [];
  // Array.isArray widens a readonly array to any[]; re-narrow to keep the
  // element type (mirrors how the IBM mapper iterates its typed source).
  const list = observations as readonly ReflowObservation[];
  const out: Issue[] = [];
  for (const observation of list) {
    if (out.length >= max) break;
    if (!observation || typeof observation.kind !== 'string') continue;
    const mapping = KIND_MAP[observation.kind];
    if (!mapping) continue; // Unknown kind — skip (conservative).
    out.push(toIssue(observation, mapping.criterion, mapping.type));
  }
  return out;
}
