const MAX_CONTENT_LENGTH = 30000;

export function buildExtractionPrompt(
  content: string,
  context: {
    readonly regulationId: string;
    readonly regulationName: string;
    readonly currentWcagVersion?: string;
    readonly currentWcagLevel?: string;
  },
): string {
  const truncated =
    content.length > MAX_CONTENT_LENGTH
      ? content.slice(0, MAX_CONTENT_LENGTH) + '\n[... truncated]'
      : content;

  return `You are an accessibility regulation analyst. Extract WCAG requirements from the following regulatory page content.

<!-- LOCKED:variable-injection -->
## Regulation Context
- Regulation ID: ${context.regulationId}
- Regulation Name: ${context.regulationName}
${context.currentWcagVersion ? `- Currently references: WCAG ${context.currentWcagVersion} Level ${context.currentWcagLevel ?? 'AA'}` : ''}

## Page Content
${truncated}
<!-- /LOCKED -->

## Instructions
Analyze the page content and extract:
1. The WCAG version referenced (e.g., "2.0", "2.1", "2.2")
2. The conformance level required (e.g., "A", "AA", "AAA")
3. Any specific WCAG success criteria mentioned with their obligation level

For each criterion found, determine if it is:
- "mandatory" -- legally required
- "recommended" -- suggested but not enforced
- "optional" -- mentioned as good practice
- "excluded" -- explicitly exempted

<!-- LOCKED:output-format -->
## Response Format
Respond ONLY with valid JSON, no markdown fences:
{
  "wcagVersion": "2.1",
  "wcagLevel": "AA",
  "criteria": [
    { "criterion": "1.1.1", "obligation": "mandatory", "notes": "Alt text required" }
  ],
  "confidence": 0.85
}

If the page doesn't contain accessibility regulation data, return:
{ "wcagVersion": "unknown", "wcagLevel": "unknown", "criteria": [], "confidence": 0.0 }
<!-- /LOCKED -->`;
}
