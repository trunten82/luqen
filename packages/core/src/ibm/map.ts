/**
 * Pure mapping from an IBM Equal Access report to shared Issues.
 *
 * Kept free of any browser / checker runtime so it can be unit-tested in the
 * fast (non-browser) vitest tier. The runner (`./index.ts`) feeds the report's
 * `results` array into {@link mapIbmResults}.
 *
 * IBM's `accessibility-checker` returns a report whose `results[]` each carry a
 * `ruleId`, a `value` tuple whose first element is the confidence band
 * (`'VIOLATION'` / `'RECOMMENDATION'` / `'INFORMATION'` / `'PASS'` / `'MANUAL'`)
 * and whose second element is the reason (`'FAIL'` / `'POTENTIAL'` / ...), a
 * `path` (with `dom`/`aria` selectors), a `snippet`, a `message`, and often a
 * `reasonId`.
 *
 * Conservative-by-design (matches the project's legal-defensibility stance):
 *  - Only `VIOLATION` (→ type 'error') and `RECOMMENDATION` (→ type 'warning')
 *    are emitted. `INFORMATION`, `PASS`, `MANUAL` and anything else are skipped.
 *  - A result is only emitted when its `ruleId` maps to a known WCAG criterion
 *    in {@link IBM_WCAG_MAP}. Unattributable results are skipped rather than
 *    emitted with an unattributable criterion.
 *  - One Issue per result, capped to {@link MAX_ISSUES} to avoid flooding.
 */

import type { Issue } from '../types.js';

/** Max issues emitted from a single report, to avoid flooding. */
export const MAX_ISSUES = 500;

/**
 * IBM Equal Access ruleId → WCAG success criterion (underscore form).
 *
 * The criterion is embedded into the emitted Issue `code` so the downstream
 * `extractCriterion()` regex maps it. Only ruleIds in this table are emitted;
 * IBM ships hundreds of rules, so this covers the high-frequency, high-value
 * ones that map cleanly to a single criterion.
 */
export const IBM_WCAG_MAP: Readonly<Record<string, string>> = {
  // 1.1.1 Non-text content
  img_alt_valid: '1_1_1',
  img_alt_null: '1_1_1',
  img_alt_redundant: '1_1_1',
  img_alt_misuse: '1_1_1',
  img_alt_background: '1_1_1',
  imagebutton_alt_exists: '1_1_1',
  imagemap_alt_exists: '1_1_1',
  area_alt_exists: '1_1_1',
  applet_alt_exists: '1_1_1',
  object_text_exists: '1_1_1',
  embed_alt_exists: '1_1_1',
  canvas_content_described: '1_1_1',
  figure_label_exists: '1_1_1',
  media_alt_exists: '1_1_1',
  aria_img_labelled: '1_1_1',
  // 1.3.1 Info and relationships
  table_headers_related: '1_3_1',
  table_headers_exists: '1_3_1',
  table_structure_misuse: '1_3_1',
  table_scope_valid: '1_3_1',
  list_structure_proper: '1_3_1',
  list_children_valid: '1_3_1',
  fieldset_legend_valid: '1_3_1',
  heading_content_exists: '1_3_1',
  label_content_exists: '1_3_1',
  input_fields_grouped: '1_3_1',
  input_checkboxes_grouped: '1_3_1',
  aria_content_in_landmark: '1_3_1',
  // 1.3.5 Identify input purpose
  input_autocomplete_valid: '1_3_5',
  // 1.4.3 Contrast (minimum)
  text_contrast_sufficient: '1_4_3',
  // 1.4.4 Resize text / 1.4.10 Reflow
  style_viewport_resizable: '1_4_4',
  // 2.1.1 Keyboard
  element_mouseevent_keyboard: '2_1_1',
  media_keyboard_controllable: '2_1_1',
  download_keyboard_controllable: '2_1_1',
  // 2.4.1 Bypass blocks
  skip_main_exists: '2_4_1',
  skip_main_described: '2_4_1',
  html_skipnav_exists: '2_4_1',
  frame_title_exists: '2_4_1',
  // 2.4.2 Page titled
  page_title_exists: '2_4_2',
  page_title_valid: '2_4_2',
  // 2.4.4 Link purpose (in context)
  a_text_purpose: '2_4_4',
  // 3.1.1 Language of page
  html_lang_exists: '3_1_1',
  // 3.1.2 Language of parts
  dir_attribute_valid: '3_1_2',
  // 3.3.1 Error identification
  error_message_exists: '3_3_1',
  // 3.3.2 Labels or instructions
  input_label_exists: '3_3_2',
  input_label_visible: '3_3_2',
  input_label_before: '3_3_2',
  input_label_after: '3_3_2',
  label_ref_valid: '3_3_2',
  form_submit_button_exists: '3_3_2',
  // 4.1.1 Parsing
  element_id_unique: '4_1_1',
  aria_id_unique: '4_1_1',
  // 4.1.2 Name, role, value
  label_name_visible: '4_1_2',
  aria_role_allowed: '4_1_2',
  aria_attribute_allowed: '4_1_2',
  aria_attribute_required: '4_1_2',
  aria_attribute_exists: '4_1_2',
  aria_attribute_value_valid: '4_1_2',
  aria_attribute_conflict: '4_1_2',
  aria_child_valid: '4_1_2',
  aria_parent_required: '4_1_2',
  aria_activedescendant_valid: '4_1_2',
  aria_widget_labelled: '4_1_2',
  aria_region_labelled: '4_1_2',
  combobox_design_valid: '4_1_2',
  HAAC_Combobox_ARIA_11_Guideline: '4_1_2',
  // 4.1.3 Status messages
  aria_eventhandler_role_valid: '4_1_3',
};

/** A single IBM Equal Access report result (subset we rely on). */
export interface IbmReportResult {
  readonly ruleId: string;
  /** Confidence tuple; value[0] is the band, e.g. ['VIOLATION','FAIL']. */
  readonly value?: readonly string[];
  readonly path?: {
    readonly dom?: string;
    readonly aria?: string;
    readonly [key: string]: string | undefined;
  };
  readonly snippet?: string;
  readonly message?: string;
  readonly reasonId?: string | number;
}

/** The subset of an IBM Equal Access compliance report we consume. */
export interface IbmReport {
  readonly results?: readonly IbmReportResult[];
}

/** Truncate a snippet/context to a bounded length. */
function clip(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/**
 * Decide the Issue type for an IBM confidence band, or undefined to skip.
 * VIOLATION → 'error', RECOMMENDATION → 'warning'; all else is skipped.
 */
function typeForBand(value: readonly string[] | undefined): Issue['type'] | undefined {
  const band = value?.[0];
  if (band === 'VIOLATION') return 'error';
  if (band === 'RECOMMENDATION') return 'warning';
  return undefined;
}

/** Build one Issue for an attributable, actionable IBM result. */
function toIssue(result: IbmReportResult, criterion: string, type: Issue['type']): Issue {
  const selector = result.path?.dom ?? result.path?.aria ?? 'html';
  const snippet = result.snippet ?? '';
  return {
    type,
    code: `Luqen.IBM.${criterion}.${result.ruleId}`,
    message: result.message?.trim() || result.ruleId,
    selector: selector || 'html',
    context: snippet ? clip(snippet) : '',
    runner: 'ibm',
  };
}

/**
 * Map an IBM Equal Access report's `results` to the shared Issue list.
 *
 * Pure: no I/O, no globals. Only actionable (VIOLATION/RECOMMENDATION),
 * WCAG-attributable results become Issues, capped at `max`.
 *
 * @param report  the IBM compliance report (or undefined on failure)
 * @param max     maximum issues to emit (default {@link MAX_ISSUES})
 */
export function mapIbmResults(report: IbmReport | undefined, max = MAX_ISSUES): Issue[] {
  if (!report || !Array.isArray(report.results)) return [];
  const out: Issue[] = [];
  for (const result of report.results) {
    if (out.length >= max) break;
    if (!result || typeof result.ruleId !== 'string') continue;
    const type = typeForBand(result.value);
    if (!type) continue; // Skip INFORMATION / PASS / MANUAL / unknown bands.
    const criterion = IBM_WCAG_MAP[result.ruleId];
    if (!criterion) continue; // Unattributable — skip (conservative).
    out.push(toIssue(result, criterion, type));
  }
  return out;
}
