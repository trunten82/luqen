const MAX_HTML_LENGTH = 5000;
const MAX_CSS_LENGTH = 2000;

export function buildGenerateFixPrompt(input: {
  readonly wcagCriterion: string;
  readonly issueMessage: string;
  readonly htmlContext: string;
  readonly cssContext?: string;
}): string {
  const html = input.htmlContext.length > MAX_HTML_LENGTH
    ? input.htmlContext.slice(0, MAX_HTML_LENGTH) + '\n[... truncated]'
    : input.htmlContext;
  const css = (input.cssContext ?? '').slice(0, MAX_CSS_LENGTH);

  return `You are a WCAG accessibility expert. Provide a fix for the following accessibility issue.

## Issue
- WCAG Criterion: ${input.wcagCriterion}
- Issue: ${input.issueMessage}

## Flagged HTML
\`\`\`html
${html}
\`\`\`

${css ? `## Relevant CSS\n\`\`\`css\n${css}\n\`\`\`\n\n` : ''}## Instructions
Provide a minimal fix for the flagged HTML that resolves the WCAG ${input.wcagCriterion} violation.
Estimate the effort: "low" (change one attribute), "medium" (restructure one element), "high" (significant rework).

## Response Format
Respond ONLY with valid JSON, no markdown fences:
{
  "fixedHtml": "<corrected HTML element(s)>",
  "explanation": "Plain English description of what was changed and why.",
  "effort": "low"
}

If no fix is possible, return:
{"fixedHtml":"","explanation":"This issue requires manual remediation.","effort":"high"}`;
}
