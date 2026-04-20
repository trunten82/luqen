/**
 * Phase 32-02 — Prompt template helpers.
 *
 * `interpolateTemplate` replaces `{key}` tokens in a template string with
 * values from the provided vars map. Pure, escape-nothing, single-brace
 * syntax so it does not collide with Handlebars `{{...}}` used elsewhere
 * in prompt templates (e.g. generate-fix `{{issueMessage}}`).
 *
 * Semantics:
 *  - Present keys are replaced in ALL occurrences (global replace).
 *  - Missing keys leave the literal `{key}` in place (NO throw, NO
 *    warning — callers can validate before or after).
 *  - Keys with empty string values replace with empty (explicit opt-in
 *    to blanking).
 */

export function interpolateTemplate(
  template: string,
  vars: Readonly<Record<string, string>>,
): string {
  return Object.entries(vars).reduce((acc, [key, value]) => {
    // Match {key} but NOT {{key}} / {key}} / {{key}} — require a single
    // brace on each side using negative lookbehind/lookahead. This keeps
    // the helper compatible with Handlebars-style `{{foo}}` tokens used
    // elsewhere in the prompt registry (e.g. generate-fix).
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<!\\{)\\{${escaped}\\}(?!\\})`, 'g');
    return acc.replace(pattern, value);
  }, template);
}
