const MAX_HTML_LENGTH = 6000;

export interface DiscoverBrandingPromptInput {
  readonly url: string;
  readonly htmlContent: string;
  readonly cssContent: string;
  readonly topColors?: ReadonlyArray<{ hex: string; count: number }>;
  readonly fontFamilies?: readonly string[];
  readonly logoCandidates?: readonly string[];
  readonly brandHint?: string;
}

export function buildDiscoverBrandingPrompt(input: DiscoverBrandingPromptInput): string {
  const html = input.htmlContent.length > MAX_HTML_LENGTH
    ? input.htmlContent.slice(0, MAX_HTML_LENGTH) + '\n[... truncated]'
    : input.htmlContent;

  const brandHint = input.brandHint
    ? input.brandHint.charAt(0).toUpperCase() + input.brandHint.slice(1)
    : '';

  const topColorsList = input.topColors && input.topColors.length > 0
    ? input.topColors.map((c, i) => `${i + 1}. ${c.hex} — appears ${c.count} times`).join('\n')
    : '(none extracted — CSS parsing yielded no colors)';

  const fontsList = input.fontFamilies && input.fontFamilies.length > 0
    ? input.fontFamilies.join(', ')
    : '(none detected)';

  const logoList = input.logoCandidates && input.logoCandidates.length > 0
    ? input.logoCandidates.map((u, i) => `${i + 1}. ${u}`).join('\n')
    : '(none detected)';

  return `You are a brand identity extractor. I have already parsed the web page and computed the raw data below. Your job is to CURATE, NAME, and STRUCTURE it into a brand profile. Use the brand context (URL/domain) to give colors meaningful brand-specific names.

## Brand Context
- URL: ${input.url}
- Brand name (from domain): ${brandHint || '(extract from HTML below)'}

## Pre-extracted Data (use this as ground truth — do not invent values)

### Top hex colors by frequency in CSS + inline styles (neutrals already excluded):
${topColorsList}

### Font families detected (excluding generic fallbacks):
${fontsList}

### Logo image URL candidates (absolute URLs, already resolved):
${logoList}

### HTML head + meta + logo tags:
\`\`\`html
${html}
\`\`\`

## Your Task

1. **colors[]** — From the top colors list above, select the ones that are most likely BRAND colors (usually the top 4-8 by frequency, skipping anything that looks like a utility/border color). For each:
   - Give it a **human-friendly, brand-specific name** using the brand context. Examples: for campari.com you'd name the deepest red "Campari Red", a lighter red "Campari Scarlet", a cream "Campari Cream". For aperol.com: "Aperol Orange", "Aperol Amber". Use the brand name as the prefix whenever it fits.
   - Set \`usage\` to "primary" (for the most frequent/iconic color), "secondary" (accents), "background" (light surface colors), or "text" (dark text colors).
   - Use the EXACT hex value from the list above. Do not invent colors.

2. **fonts[]** — From the detected font families above, return them as an array. Infer \`usage\` ("heading" vs "body") if you can, otherwise use "body".

3. **logoUrl** — Pick the BEST logo URL from the candidates list. Prefer SVG > WEBP > PNG. If a candidate URL mentions "main" or doesn't have "footer"/"age-gate"/"small" in the path, prefer it. Use exactly one of the URLs from the list above — do not modify it.

4. **brandName** — Extract from \`<meta property="og:site_name">\` in the HTML, or \`<title>\` (strip trailing " | ..." or " - ..."), or use the domain brand hint "${brandHint}".

5. **description** — Write a one-sentence brand description (max 200 chars) based on the title, meta description, and brand name. This is what the brand is/does. Example: "Campari is an iconic Italian aperitif brand known for its vibrant red color and bitter-sweet taste, produced since 1860."

## Response Format (JSON only, no markdown fences, no prose)

{
  "colors": [
    {"name": "Campari Red", "hex": "#cd0136", "usage": "primary"},
    {"name": "Campari Scarlet", "hex": "#ef172f", "usage": "secondary"}
  ],
  "fonts": [
    {"family": "Montserrat", "usage": "heading"}
  ],
  "logoUrl": "https://www.example.com/logo.svg",
  "brandName": "Example",
  "description": "One-sentence description of the brand."
}

If a field cannot be extracted, use an empty array/string. Do not invent data that isn't in the pre-extracted lists above.`;
}
