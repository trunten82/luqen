const MAX_HTML_LENGTH = 8000;
const MAX_CSS_LENGTH = 3000;

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

  return `You are a brand identity expert. Analyse the following web page content and identify the brand elements.

## URL
${input.url}

## HTML Content
\`\`\`html
${html}
\`\`\`

## CSS / Style Content
\`\`\`css
${css}
\`\`\`

## Instructions
Extract brand identity information from the page content:
- Primary and secondary brand colors (from CSS custom properties, background-color, color declarations)
- Font families used (from font-family, @font-face declarations, Google Fonts links)
- Logo image URL (from <img> with logo/brand in src/alt/class, or SVG logo elements)
- Brand/company name (from <title>, og:site_name meta tag, or prominent heading text)

## Response Format
Respond ONLY with valid JSON, no markdown fences:
{
  "colors": [
    {"name": "Primary Blue", "hex": "#1a73e8", "usage": "primary"}
  ],
  "fonts": [
    {"family": "Inter", "usage": "body"}
  ],
  "logoUrl": "https://example.com/logo.png",
  "brandName": "Company Name"
}

If a field cannot be determined, use an empty array for colors/fonts, empty string for logoUrl/brandName.`;
}
