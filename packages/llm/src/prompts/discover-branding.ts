const MAX_HTML_LENGTH = 8000;
const MAX_CSS_LENGTH = 12000;

export interface DiscoverBrandingPromptInput {
  readonly url: string;
  readonly htmlContent: string;
  readonly cssContent: string;
}

export function buildDiscoverBrandingPrompt(input: DiscoverBrandingPromptInput): string {
  const html = input.htmlContent.length > MAX_HTML_LENGTH
    ? input.htmlContent.slice(0, MAX_HTML_LENGTH) + '\n[... truncated]'
    : input.htmlContent;
  const css = input.cssContent.length > MAX_CSS_LENGTH
    ? input.cssContent.slice(0, MAX_CSS_LENGTH) + '\n[... truncated]'
    : input.cssContent;

  return `You are a CSS parser. Extract brand identity from the provided web page content using ONLY the rules below. Do not invent or infer values that are not present in the source.

## URL
${input.url}

## HTML (head, logo elements, inline styles)
\`\`\`html
${html}
\`\`\`

## CSS (inline + external stylesheets)
\`\`\`css
${css}
\`\`\`

## Extraction Rules (follow exactly)

1. **Colors** — Extract EVERY unique hex color that appears in the CSS as a value for:
   - CSS custom properties (e.g., \`--primary: #ff6900\`)
   - \`color:\`, \`background-color:\`, \`background:\`, \`border-color:\`, \`fill:\`, \`stroke:\` declarations
   - Convert rgb()/rgba() to hex
   - Deduplicate. Ignore white (#ffffff), black (#000000), grey tones (#eee, #ccc, #666, etc.), and transparent
   - For \`name\`, use the CSS variable name if present (e.g., "primary"), otherwise "brand-color-N"
   - For \`usage\`, use "primary" if it's the most frequent or named "primary", otherwise "secondary"
   - Return AT LEAST 3 colors if available, up to 8

2. **Fonts** — Extract EVERY unique font-family from:
   - \`@font-face { font-family: ... }\`
   - \`font-family:\` declarations (take the FIRST family in the stack, not fallbacks)
   - Google Fonts URLs (parse family parameter)
   - Exclude generic fallbacks (serif, sans-serif, monospace, Arial, Helvetica, system-ui)
   - For \`usage\`, use "heading" if found in h1/h2/h3/title rules, otherwise "body"

3. **Logo URL** — Find an \`<img>\` or \`<svg>\` whose src/class/alt contains "logo" or "brand". Return the absolute URL (resolve relative paths using the page URL). If multiple, prefer SVG or the highest-resolution PNG/WEBP.

4. **Brand Name** — Extract from \`<meta property="og:site_name">\` first, then \`<title>\` (strip trailing " | ..." or " - ..."), then nothing.

## Response Format
Respond ONLY with valid JSON, no markdown fences, no explanation:
{
  "colors": [{"name": "primary", "hex": "#ff6900", "usage": "primary"}],
  "fonts": [{"family": "Montserrat", "usage": "heading"}],
  "logoUrl": "https://example.com/logo.svg",
  "brandName": "Example Brand"
}

If a field cannot be extracted from the source, use an empty array for colors/fonts, empty string for logoUrl/brandName. Do not guess.`;
}
