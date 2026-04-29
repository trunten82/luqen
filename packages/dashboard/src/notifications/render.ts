// ---------------------------------------------------------------------------
// Minimal token replacement renderer (Phase 47).
//
// Replaces `{{tokenName}}` occurrences with values from `data`. Unknown tokens
// are left visible (as `{{tokenName}}`) so the Phase 49 preview UI can flag
// them. Null/undefined values render as the empty string. This is intentionally
// not full Handlebars — Phase 49 introduces channel-specific renderers that
// will use a richer engine.
// ---------------------------------------------------------------------------

const TOKEN_RE = /\{\{(\w+)\}\}/g;

export function renderTemplate(
  template: string,
  data: Readonly<Record<string, unknown>>,
): string {
  return template.replace(TOKEN_RE, (_match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
      // Unknown token — leave visible
      return `{{${key}}}`;
    }
    const value = data[key];
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return '';
      }
    }
    return String(value);
  });
}
