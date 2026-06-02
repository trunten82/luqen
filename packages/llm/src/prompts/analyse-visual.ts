const MAX_CONTEXT_LENGTH = 4000;

export type VisualCheck = 'heading-semantics' | 'alt-text';

export interface AnalyseVisualPromptInput {
  readonly check: VisualCheck;
  readonly context: string;
}

/**
 * Build the text prompt for a vision (multimodal) accessibility check. The
 * image itself is attached separately via `CompletionOptions.images` — this
 * prompt only carries the textual context (accessibility subtree / element
 * HTML / surrounding copy) and the JSON output contract.
 */
export function buildAnalyseVisualPrompt(input: AnalyseVisualPromptInput): string {
  const context = input.context.length > MAX_CONTEXT_LENGTH
    ? input.context.slice(0, MAX_CONTEXT_LENGTH) + '\n[... truncated]'
    : input.context;

  if (input.check === 'alt-text') {
    return `You are a WCAG accessibility expert. You are shown an image taken from a web page, plus the surrounding page context.

<!-- LOCKED:variable-injection -->
## Surrounding context (HTML / nearby text)
${context}
<!-- /LOCKED -->

## Task
Decide whether the image is DECORATIVE (adds no information beyond styling — should have empty alt="") or INFORMATIONAL (conveys content a screen-reader user needs). If informational, write concise, contextual alt text (no "image of"/"picture of" prefixes). Map any problem to WCAG 1.1.1 Non-text Content.

<!-- LOCKED:output-format -->
## Response Format
Respond ONLY with valid JSON, no markdown fences:
{
  "verdict": "pass" | "issue" | "uncertain",
  "altClassification": "decorative" | "informational",
  "suggestedAlt": "<concise alt text, or empty string if decorative>",
  "findings": [{ "description": "...", "wcagCriterion": "1.1.1", "confidence": "low" | "medium" | "high" }]
}
<!-- /LOCKED -->`;
  }

  return `You are a WCAG accessibility expert. You are shown a screenshot of a web page region, plus its accessibility tree / HTML.

<!-- LOCKED:variable-injection -->
## Accessibility tree / HTML
${context}
<!-- /LOCKED -->

## Task
Compare the VISUAL appearance in the screenshot against the semantic markup. Flag text that LOOKS like a heading (large/bold, visually separating sections) but is NOT a real heading element (e.g. a styled <div>/<span>), and headings that are visually indistinct. Map every problem to WCAG 1.3.1 Info and Relationships.

<!-- LOCKED:output-format -->
## Response Format
Respond ONLY with valid JSON, no markdown fences:
{
  "verdict": "pass" | "issue" | "uncertain",
  "findings": [{ "description": "...", "wcagCriterion": "1.3.1", "confidence": "low" | "medium" | "high" }]
}
If no issues are found, return {"verdict":"pass","findings":[]}.
<!-- /LOCKED -->`;
}
