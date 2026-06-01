/**
 * Pure mapping from accessibility-tree observations to shared Issues.
 *
 * Kept free of any browser / CDP runtime so it can be unit-tested in the fast
 * (non-browser) vitest tier. The runner (`./index.ts`) gathers a serializable
 * {@link A11yTreeObservation}[] from the CDP accessibility tree + a DOM probe and
 * feeds it into {@link mapA11yTreeObservations}.
 *
 * Each observation kind maps to a single WCAG success criterion (underscore
 * form, embedded into the Issue `code` so the downstream `extractCriterion()`
 * regex maps it) and a fixed Issue type:
 *
 *   - `missing-name`      → 4.1.2 Name, Role, Value, error
 *       An element exposed to assistive tech with an interactive role but no
 *       computed accessible name.
 *   - `positive-tabindex` → 2.4.3 Focus Order, warning
 *       A positive tabindex (> 0) forces a focus order that diverges from the
 *       DOM / reading order.
 *
 * Conservative-by-design (matches the project's legal-defensibility stance):
 * only observations whose kind is in {@link KIND_MAP} are emitted. One Issue per
 * observation, capped to {@link MAX_ISSUES}.
 */

import type { Issue } from '../types.js';

/** Max issues emitted from a single page, to avoid flooding. */
export const MAX_ISSUES = 500;

/** The kinds of accessibility-tree problem the probe can report. */
export type A11yTreeObservationKind = 'missing-name' | 'positive-tabindex';

/**
 * A single serializable observation. Plain data only.
 */
export interface A11yTreeObservation {
  readonly kind: A11yTreeObservationKind;
  /** ARIA role of the offending node (used to enrich the missing-name message). */
  readonly role?: string;
  /** CSS-ish selector for the offending node (defaults to 'html'). */
  readonly selector?: string;
  /** Short HTML/context snippet for the node. */
  readonly snippet?: string;
  /** Human-readable description; a per-kind default is used when absent. */
  readonly message?: string;
}

/** Observation kind → { WCAG criterion (underscore form), Issue type }. */
export const KIND_MAP: Readonly<
  Record<A11yTreeObservationKind, { readonly criterion: string; readonly type: Issue['type'] }>
> = {
  'missing-name': { criterion: '4_1_2', type: 'error' },
  'positive-tabindex': { criterion: '2_4_3', type: 'warning' },
};

/** Build the default message for an observation when it omits its own. */
function defaultMessage(observation: A11yTreeObservation): string {
  switch (observation.kind) {
    case 'missing-name': {
      const role = observation.role ? ` (role "${observation.role}")` : '';
      return `Interactive element${role} has no accessible name — assistive technology cannot identify it (WCAG 4.1.2).`;
    }
    case 'positive-tabindex':
      return 'Element uses a positive tabindex, forcing a focus order that diverges from the DOM / reading order (WCAG 2.4.3 Focus Order).';
    default:
      return '';
  }
}

/** Truncate a snippet/context to a bounded length. */
function clip(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/** Build one Issue for an attributable accessibility-tree observation. */
function toIssue(
  observation: A11yTreeObservation,
  criterion: string,
  type: Issue['type'],
): Issue {
  const snippet = observation.snippet ?? '';
  return {
    type,
    code: `Luqen.A11yTree.${criterion}.${observation.kind.replace(/-/g, '_')}`,
    message: (observation.message ?? defaultMessage(observation)).trim(),
    selector: observation.selector || 'html',
    context: snippet ? clip(snippet) : '',
    runner: 'a11y-tree',
  };
}

/**
 * Map accessibility-tree observations to the shared Issue list.
 *
 * Pure: no I/O, no globals. Only observations whose kind is attributable (in
 * {@link KIND_MAP}) become Issues, capped at `max`.
 *
 * @param observations  observations gathered from the AX tree + DOM probe
 * @param max           maximum issues to emit (default {@link MAX_ISSUES})
 */
export function mapA11yTreeObservations(
  observations: readonly A11yTreeObservation[] | undefined,
  max = MAX_ISSUES,
): Issue[] {
  if (!Array.isArray(observations)) return [];
  // Array.isArray widens a readonly array to any[]; re-narrow to keep the
  // element type (mirrors the reflow / IBM mappers).
  const list = observations as readonly A11yTreeObservation[];
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
