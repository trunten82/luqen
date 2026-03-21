/**
 * Actionable code fix suggestions for common WCAG violations.
 *
 * Each suggestion matches a specific issue pattern from pa11y/axe output
 * and provides a title, description, and code example showing how to fix it.
 */

export interface FixSuggestion {
  readonly criterion: string;
  readonly issuePattern: string;
  readonly title: string;
  readonly description: string;
  readonly codeExample: string;
  readonly effort: 'low' | 'medium' | 'high';
}

export const FIX_SUGGESTIONS: readonly FixSuggestion[] = [
  // ── 1.1.1 Non-text Content ──────────────────────────────────────────────
  {
    criterion: '1.1.1',
    issuePattern: 'Img element missing an alt attribute',
    title: 'Add alt attribute to image',
    description: 'Every <img> element must have an alt attribute describing its purpose. Use alt="" for decorative images.',
    codeExample: '<!-- Before -->\n<img src="photo.jpg">\n\n<!-- After -->\n<img src="photo.jpg" alt="Team photo from the 2024 annual retreat">',
    effort: 'low',
  },
  {
    criterion: '1.1.1',
    issuePattern: 'Img element.*alt.*not empty.*appears to be.*decorative',
    title: 'Mark decorative image with empty alt',
    description: 'Decorative images that convey no information should have an empty alt attribute.',
    codeExample: '<!-- Before -->\n<img src="divider.png" alt="divider line">\n\n<!-- After -->\n<img src="divider.png" alt="">',
    effort: 'low',
  },
  {
    criterion: '1.1.1',
    issuePattern: 'alt.*text.*same.*file.*name|alt.*text.*filename',
    title: 'Replace filename with descriptive alt text',
    description: 'Alt text should describe the image content, not repeat the file name.',
    codeExample: '<!-- Before -->\n<img src="IMG_2048.jpg" alt="IMG_2048.jpg">\n\n<!-- After -->\n<img src="IMG_2048.jpg" alt="Sunset over the harbour from the office balcony">',
    effort: 'low',
  },
  {
    criterion: '1.1.1',
    issuePattern: 'input.*type.*image.*missing.*alt',
    title: 'Add alt to image input',
    description: 'Image inputs used as submit buttons must have alt text describing the action.',
    codeExample: '<!-- Before -->\n<input type="image" src="search.png">\n\n<!-- After -->\n<input type="image" src="search.png" alt="Search">',
    effort: 'low',
  },

  // ── 1.3.1 Info and Relationships ────────────────────────────────────────
  {
    criterion: '1.3.1',
    issuePattern: 'input.*does not have.*label',
    title: 'Associate label with form input',
    description: 'Every form input needs a programmatically associated label using the for/id pattern or by wrapping.',
    codeExample: '<!-- Before -->\nName: <input type="text" name="name">\n\n<!-- After -->\n<label for="name">Name:</label>\n<input type="text" id="name" name="name">',
    effort: 'low',
  },
  {
    criterion: '1.3.1',
    issuePattern: 'heading.*levels.*skipped|heading.*order',
    title: 'Fix heading hierarchy',
    description: 'Headings must not skip levels. An h2 should be followed by h3, not h4.',
    codeExample: '<!-- Before -->\n<h1>Page Title</h1>\n<h4>Sub-section</h4>\n\n<!-- After -->\n<h1>Page Title</h1>\n<h2>Sub-section</h2>',
    effort: 'low',
  },
  {
    criterion: '1.3.1',
    issuePattern: 'table.*header|th.*scope|data.*table',
    title: 'Add proper table headers',
    description: 'Data tables need <th> elements with scope attributes to associate headers with data cells.',
    codeExample: '<!-- Before -->\n<table>\n  <tr><td>Name</td><td>Email</td></tr>\n</table>\n\n<!-- After -->\n<table>\n  <tr><th scope="col">Name</th><th scope="col">Email</th></tr>\n</table>',
    effort: 'low',
  },
  {
    criterion: '1.3.1',
    issuePattern: 'list.*item.*not.*contained|li.*not.*in.*ul|li.*not.*in.*ol',
    title: 'Wrap list items in a list container',
    description: 'List items (<li>) must be contained inside <ul>, <ol>, or <menu> elements.',
    codeExample: '<!-- Before -->\n<li>Item one</li>\n<li>Item two</li>\n\n<!-- After -->\n<ul>\n  <li>Item one</li>\n  <li>Item two</li>\n</ul>',
    effort: 'low',
  },

  // ── 1.4.3 Contrast (Minimum) ───────────────────────────────────────────
  {
    criterion: '1.4.3',
    issuePattern: 'contrast ratio.*is.*less than',
    title: 'Increase text contrast ratio',
    description: 'Normal text needs a contrast ratio of at least 4.5:1 against its background. Large text (18pt+) needs 3:1.',
    codeExample: '/* Before: light gray on white — ratio 2.5:1 */\ncolor: #999; background: #fff;\n\n/* After: dark gray on white — ratio 7:1 */\ncolor: #4a4a4a; background: #fff;',
    effort: 'low',
  },

  // ── 1.4.4 Resize Text ──────────────────────────────────────────────────
  {
    criterion: '1.4.4',
    issuePattern: 'font.*size|text.*resize|zoom',
    title: 'Use relative units for text sizing',
    description: 'Use rem or em instead of px for font sizes to support browser text resizing.',
    codeExample: '/* Before */\nfont-size: 14px;\n\n/* After */\nfont-size: 0.875rem;',
    effort: 'medium',
  },

  // ── 2.1.1 Keyboard ─────────────────────────────────────────────────────
  {
    criterion: '2.1.1',
    issuePattern: 'click.*handler|onclick|mouse.*event.*no.*keyboard',
    title: 'Add keyboard event handlers',
    description: 'Elements with click handlers must also be keyboard-accessible via keydown/keypress handlers.',
    codeExample: '<!-- Before -->\n<div onclick="doAction()">Click me</div>\n\n<!-- After -->\n<button type="button" onclick="doAction()">Click me</button>\n<!-- Or if div is required: -->\n<div role="button" tabindex="0"\n     onclick="doAction()"\n     onkeydown="if(event.key===\'Enter\'||event.key===\' \')doAction()">Click me</div>',
    effort: 'medium',
  },

  // ── 2.4.1 Bypass Blocks ─────────────────────────────────────────────────
  {
    criterion: '2.4.1',
    issuePattern: 'skip.*navigation|bypass|skip.*link',
    title: 'Add skip navigation link',
    description: 'Add a skip link as the first focusable element that jumps to main content.',
    codeExample: '<!-- Add as first child of <body> -->\n<a href="#main-content" class="skip-link">Skip to main content</a>\n\n<!-- Style it (visible only on focus) -->\n.skip-link { position: absolute; left: -9999px; }\n.skip-link:focus { position: static; }',
    effort: 'low',
  },

  // ── 2.4.2 Page Titled ──────────────────────────────────────────────────
  {
    criterion: '2.4.2',
    issuePattern: 'title.*empty|title element.*missing|document does not have a title',
    title: 'Add descriptive page title',
    description: 'Every page needs a unique, descriptive <title> element.',
    codeExample: '<!-- Before -->\n<title></title>\n\n<!-- After -->\n<title>Contact Us - Acme Corp</title>',
    effort: 'low',
  },

  // ── 2.4.4 Link Purpose ─────────────────────────────────────────────────
  {
    criterion: '2.4.4',
    issuePattern: 'link.*purpose|anchor.*text.*empty|click here|read more',
    title: 'Use descriptive link text',
    description: 'Link text should describe the destination, not use generic phrases like "click here".',
    codeExample: '<!-- Before -->\n<a href="/report">Click here</a>\n\n<!-- After -->\n<a href="/report">View accessibility report</a>',
    effort: 'low',
  },

  // ── 2.4.7 Focus Visible ─────────────────────────────────────────────────
  {
    criterion: '2.4.7',
    issuePattern: 'focus.*indicator|outline.*none|focus.*visible',
    title: 'Ensure visible focus indicator',
    description: 'Interactive elements must have a visible focus indicator. Never use outline:none without a replacement.',
    codeExample: '/* Before — removes focus ring entirely */\n:focus { outline: none; }\n\n/* After — custom focus ring */\n:focus-visible {\n  outline: 3px solid #005fcc;\n  outline-offset: 2px;\n}',
    effort: 'low',
  },

  // ── 3.1.1 Language of Page ──────────────────────────────────────────────
  {
    criterion: '3.1.1',
    issuePattern: 'lang.*attribute|language.*html',
    title: 'Set page language',
    description: 'The <html> element must have a valid lang attribute.',
    codeExample: '<!-- Before -->\n<html>\n\n<!-- After -->\n<html lang="en">',
    effort: 'low',
  },

  // ── 3.3.2 Labels or Instructions ────────────────────────────────────────
  {
    criterion: '3.3.2',
    issuePattern: 'label.*missing|no.*label|form.*field.*not.*label',
    title: 'Add visible label to form field',
    description: 'All form fields need a visible label. Placeholder text is not sufficient.',
    codeExample: '<!-- Before -->\n<input type="email" placeholder="Email">\n\n<!-- After -->\n<label for="email">Email address</label>\n<input type="email" id="email" placeholder="name@example.com">',
    effort: 'low',
  },

  // ── 4.1.1 Parsing ──────────────────────────────────────────────────────
  {
    criterion: '4.1.1',
    issuePattern: 'duplicate.*id|id.*already.*exist',
    title: 'Remove duplicate IDs',
    description: 'Each id attribute value must be unique within the page.',
    codeExample: '<!-- Before -->\n<div id="nav">...</div>\n<div id="nav">...</div>\n\n<!-- After -->\n<div id="main-nav">...</div>\n<div id="footer-nav">...</div>',
    effort: 'low',
  },

  // ── 4.1.2 Name, Role, Value ─────────────────────────────────────────────
  {
    criterion: '4.1.2',
    issuePattern: 'aria-label|accessible name|button.*text.*empty',
    title: 'Add accessible name to interactive element',
    description: 'Interactive elements must have an accessible name via text content, aria-label, or aria-labelledby.',
    codeExample: '<!-- Before -->\n<button><svg>...</svg></button>\n\n<!-- After -->\n<button aria-label="Close dialog"><svg>...</svg></button>',
    effort: 'low',
  },
  {
    criterion: '4.1.2',
    issuePattern: 'aria-role|role.*invalid|role.*not.*valid',
    title: 'Use valid ARIA roles',
    description: 'ARIA roles must be valid WAI-ARIA role values.',
    codeExample: '<!-- Before -->\n<div role="buttn">...</div>\n\n<!-- After -->\n<div role="button" tabindex="0">...</div>',
    effort: 'low',
  },
];

/**
 * Look up a fix suggestion for a given WCAG criterion and issue message.
 * Returns null if no matching suggestion is found.
 */
export function getFixSuggestion(criterion: string, message: string): FixSuggestion | null {
  for (const suggestion of FIX_SUGGESTIONS) {
    if (suggestion.criterion === criterion) {
      try {
        if (new RegExp(suggestion.issuePattern, 'i').test(message)) {
          return suggestion;
        }
      } catch {
        // Invalid regex pattern — skip this entry
      }
    }
  }
  return null;
}
