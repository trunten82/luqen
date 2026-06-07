const MAX_HTML_LENGTH = 5000;
const MAX_CSS_LENGTH = 2000;

type PromptInput = {
  readonly wcagCriterion: string;
  readonly issueMessage: string;
  readonly htmlContext: string;
  readonly cssContext?: string;
};

export function buildGenerateFixPrompt(input: PromptInput): string {
  const html = input.htmlContext.length > MAX_HTML_LENGTH
    ? input.htmlContext.slice(0, MAX_HTML_LENGTH) + '\n[... truncated]'
    : input.htmlContext;
  const css = (input.cssContext ?? '').slice(0, MAX_CSS_LENGTH);

  return `You are a WCAG accessibility expert. Provide a fix for the following accessibility issue.

<!-- LOCKED:variable-injection -->
## Issue
- WCAG Criterion: ${input.wcagCriterion}
- Issue: ${input.issueMessage}

## Flagged HTML
\`\`\`html
${html}
\`\`\`

${css ? `## Relevant CSS\n\`\`\`css\n${css}\n\`\`\`\n` : ''}<!-- /LOCKED -->

## Instructions
Provide a minimal fix for the flagged HTML that resolves the WCAG ${input.wcagCriterion} violation.
Estimate the effort: "low" (change one attribute), "medium" (restructure one element), "high" (significant rework).

<!-- LOCKED:output-format -->
## Response Format
Respond ONLY with valid JSON, no markdown fences:
{
  "fixedHtml": "<corrected HTML element(s)>",
  "explanation": "Plain English description of what was changed and why.",
  "effort": "low"
}

If no fix is possible, return:
{"fixedHtml":"","explanation":"This issue requires manual remediation.","effort":"high"}
<!-- /LOCKED -->`;
}

/**
 * Gutenberg-block-aware prompt variant (D-07).
 * Mirrors buildGenerateFixPrompt structure: same LOCKED markers, same JSON output
 * contract { fixedHtml, explanation, effort }, same MAX_HTML_LENGTH/MAX_CSS_LENGTH
 * truncation. Only the Instructions section differs — it requires valid WordPress
 * Gutenberg block markup (block comment delimiters and block.json-aware attributes).
 */
export function buildGutenbergFixPrompt(input: PromptInput): string {
  const html = input.htmlContext.length > MAX_HTML_LENGTH
    ? input.htmlContext.slice(0, MAX_HTML_LENGTH) + '\n[... truncated]'
    : input.htmlContext;
  const css = (input.cssContext ?? '').slice(0, MAX_CSS_LENGTH);

  return `You are a WCAG accessibility expert specialising in WordPress Gutenberg blocks. Provide a fix for the following accessibility issue.

<!-- LOCKED:variable-injection -->
## Issue
- WCAG Criterion: ${input.wcagCriterion}
- Issue: ${input.issueMessage}

## Flagged HTML / Block Markup
\`\`\`html
${html}
\`\`\`

${css ? `## Relevant CSS\n\`\`\`css\n${css}\n\`\`\`\n` : ''}<!-- /LOCKED -->

## Instructions
Provide a minimal fix for the flagged HTML that resolves the WCAG ${input.wcagCriterion} violation.

IMPORTANT — This is a WordPress Gutenberg block context:
- Preserve existing WordPress block comment delimiters (<!-- wp:blockname {...} --> and <!-- /wp:blockname -->).
- Use block.json-aware attributes (aria-label, aria-describedby, role, tabindex, etc.) appropriate to the block type.
- Do NOT strip block comment wrappers or convert to plain HTML.
- Validate the fix produces semantically correct, accessible block markup.

Estimate the effort: "low" (change one attribute), "medium" (restructure one element), "high" (significant rework).

<!-- LOCKED:output-format -->
## Response Format
Respond ONLY with valid JSON, no markdown fences:
{
  "fixedHtml": "<corrected block markup>",
  "explanation": "Plain English description of what was changed and why.",
  "effort": "low"
}

If no fix is possible, return:
{"fixedHtml":"","explanation":"This issue requires manual remediation.","effort":"high"}
<!-- /LOCKED -->`;
}
