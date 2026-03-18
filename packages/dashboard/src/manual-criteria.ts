/**
 * WCAG 2.1 AA criteria that require manual or guided testing.
 *
 * Automation tools (like pa11y / axe) catch some issues but many WCAG
 * success criteria cannot be fully verified without human judgement.
 * This module defines the checklist items shown after an automated scan.
 */

export interface ManualCriterion {
  readonly id: string;
  readonly title: string;
  readonly level: 'A' | 'AA' | 'AAA';
  readonly automatable: 'full' | 'partial' | 'none';
  readonly testInstructions: string;
  readonly whatToCheck: readonly string[];
  readonly steps: readonly string[];
  readonly goodExample: string;
  readonly badExample: string;
}

export type ManualTestStatus = 'untested' | 'pass' | 'fail' | 'na';

export interface ManualTestResult {
  readonly id: string;
  readonly scanId: string;
  readonly criterionId: string;
  readonly status: ManualTestStatus;
  readonly notes: string | null;
  readonly testedBy: string | null;
  readonly testedAt: string | null;
  readonly orgId: string;
}

/**
 * Criteria that automated tools cannot fully verify for WCAG 2.1 AA.
 * Grouped by `automatable`:
 *   - 'none'    = cannot be automated at all
 *   - 'partial' = automation catches some but not all
 */
export const MANUAL_CRITERIA: readonly ManualCriterion[] = [
  // ── Partially automatable ──────────────────────────────────────────────
  {
    id: '1.1.1',
    title: 'Non-text Content',
    level: 'A',
    automatable: 'partial',
    testInstructions:
      'Verify that all meaningful images have accurate alternative text.',
    whatToCheck: [
      'Are alt texts descriptive and accurate (not just "image")?',
      'Are decorative images marked with empty alt=""?',
      'Do complex images have extended descriptions?',
    ],
    steps: [
      'Open browser DevTools (F12)',
      'Inspect each image element on the page',
      'Check the alt attribute — it should describe the image purpose',
      'Verify decorative images have alt="" (empty, not missing)',
      'For complex images (charts, diagrams), check for a nearby text description or longdesc',
    ],
    goodExample: '<img src="logo.png" alt="Acme Corp logo"> or <img src="divider.png" alt="">',
    badExample: '<img src="logo.png"> or <img src="photo.jpg" alt="image"> or <img src="chart.png" alt="chart">',
  },
  {
    id: '1.3.1',
    title: 'Info and Relationships',
    level: 'A',
    automatable: 'partial',
    testInstructions:
      'Check that information, structure, and relationships conveyed visually are available programmatically.',
    whatToCheck: [
      'Are headings used in correct hierarchy (h1 > h2 > h3)?',
      'Are form labels properly associated?',
      'Are data tables marked up with th/scope?',
    ],
    steps: [
      'Use the heading outline tool in axe DevTools or WAVE to inspect heading hierarchy',
      'Verify heading levels do not skip (e.g. h1 followed by h3)',
      'Inspect each form field — check that a <label for="..."> matches the input id',
      'For data tables, check that <th> elements have a scope="col" or scope="row" attribute',
      'Verify lists use proper <ul>/<ol>/<li> markup rather than styled divs',
    ],
    goodExample: '<h1>Page Title</h1>\n<h2>Section</h2>\n<h3>Sub-section</h3>\n\n<label for="email">Email</label>\n<input id="email" type="email">',
    badExample: '<div class="heading-big">Page Title</div>\n<div class="heading-small">Section</div>\n\nEmail: <input type="email">',
  },
  {
    id: '2.1.1',
    title: 'Keyboard',
    level: 'A',
    automatable: 'partial',
    testInstructions:
      'All functionality is operable through a keyboard interface.',
    whatToCheck: [
      'Can all interactive elements be reached with Tab?',
      'Can all controls be activated with Enter/Space?',
      'Do custom widgets support expected keyboard patterns?',
    ],
    steps: [
      'Put mouse aside and use only the keyboard',
      'Press Tab repeatedly — verify every interactive element receives focus',
      'Press Enter or Space on each focused element to confirm it activates',
      'Test custom widgets (dropdowns, sliders, modals) for arrow-key navigation',
      'Ensure no functionality is available only via mouse (hover, drag, right-click)',
    ],
    goodExample: '<button type="button" onclick="doAction()">Save</button>\n<!-- Naturally keyboard accessible -->',
    badExample: '<div onclick="doAction()">Save</div>\n<!-- Not focusable, not keyboard accessible -->',
  },
  {
    id: '2.4.6',
    title: 'Headings and Labels',
    level: 'AA',
    automatable: 'partial',
    testInstructions: 'Headings and labels describe topic or purpose.',
    whatToCheck: [
      'Do headings accurately describe the content?',
      'Are form labels clear and descriptive?',
    ],
    steps: [
      'Read each heading on the page — it should clearly describe the section content',
      'Check that headings are not generic (e.g. "Section 1", "Details")',
      'Inspect form labels — each should clearly state what input is expected',
      'Verify that placeholder text is not used as the only label',
    ],
    goodExample: '<h2>Shipping Address</h2>\n<label for="zip">ZIP / Postal Code</label>\n<input id="zip" type="text">',
    badExample: '<h2>Section 2</h2>\n<input type="text" placeholder="Enter here">',
  },
  {
    id: '2.4.7',
    title: 'Focus Visible',
    level: 'AA',
    automatable: 'partial',
    testInstructions: 'Keyboard focus indicator is visible.',
    whatToCheck: [
      'Is focus ring visible on all interactive elements?',
      'Does custom styling preserve focus visibility?',
    ],
    steps: [
      'Tab through the page using the keyboard',
      'For each focused element, verify a visible outline or highlight appears',
      'Check buttons, links, inputs, and custom controls',
      'Look for CSS rules like outline:none that remove focus without a replacement',
      'Ensure focus contrast meets 3:1 ratio against surrounding colours',
    ],
    goodExample: ':focus-visible { outline: 3px solid #005fcc; outline-offset: 2px; }',
    badExample: ':focus { outline: none; } /* Focus ring removed with no replacement */',
  },
  {
    id: '3.1.2',
    title: 'Language of Parts',
    level: 'AA',
    automatable: 'partial',
    testInstructions:
      'The language of passages or phrases is programmatically determined.',
    whatToCheck: [
      'Do foreign language passages have lang attributes?',
    ],
    steps: [
      'Scan the page for any text in a different language than the page default',
      'Inspect those elements in DevTools',
      'Verify they have a lang attribute with the correct language code (e.g. lang="fr")',
      'Check that common foreign phrases used in English context are still marked (e.g. "c\'est la vie")',
    ],
    goodExample: '<p>The motto of the company is <span lang="fr">joie de vivre</span>.</p>',
    badExample: '<p>The motto of the company is joie de vivre.</p>\n<!-- Foreign phrase not marked -->',
  },
  {
    id: '4.1.2',
    title: 'Name, Role, Value',
    level: 'A',
    automatable: 'partial',
    testInstructions:
      'All UI components have accessible names, roles, states, and values exposed to assistive technology.',
    whatToCheck: [
      'Do custom widgets have correct ARIA roles?',
      'Are state changes (expanded, selected) announced?',
      'Do custom controls expose their value programmatically?',
    ],
    steps: [
      'Open the Accessibility panel in DevTools (Chrome: Elements > Accessibility)',
      'Inspect each custom widget (dropdowns, tabs, accordions)',
      'Verify the computed accessible name is meaningful',
      'Check that appropriate ARIA roles are applied (role="tab", role="dialog", etc.)',
      'Toggle states (expand/collapse, check/uncheck) and verify aria-expanded, aria-checked update',
    ],
    goodExample: '<button aria-expanded="false" aria-controls="menu1">Menu</button>\n<ul id="menu1" role="menu" hidden>...</ul>',
    badExample: '<div class="dropdown-toggle">Menu</div>\n<div class="dropdown-list" style="display:none">...</div>',
  },

  // ── Cannot be automated ────────────────────────────────────────────────
  {
    id: '1.2.1',
    title: 'Audio-only and Video-only (Prerecorded)',
    level: 'A',
    automatable: 'none',
    testInstructions:
      'Prerecorded audio-only and video-only content has an alternative.',
    whatToCheck: [
      'Is a transcript provided for audio-only content?',
      'Is an audio track or text alternative provided for video-only content?',
    ],
    steps: [
      'Identify all audio-only content (podcasts, sound clips)',
      'Check if a text transcript is provided nearby or linked',
      'Identify all video-only content (animations, silent demos)',
      'Check for a text description or audio alternative',
      'Verify the transcript/alternative conveys all essential information',
    ],
    goodExample: '<audio src="podcast.mp3" controls></audio>\n<a href="podcast-transcript.html">Read transcript</a>',
    badExample: '<audio src="podcast.mp3" controls></audio>\n<!-- No transcript provided -->',
  },
  {
    id: '1.2.2',
    title: 'Captions (Prerecorded)',
    level: 'A',
    automatable: 'none',
    testInstructions:
      'Captions are provided for all prerecorded audio content in synchronized media.',
    whatToCheck: [
      'Do all videos with audio have accurate captions?',
      'Are captions synchronized with the audio?',
    ],
    steps: [
      'Play each video on the page',
      'Enable captions/subtitles if not auto-displayed',
      'Verify captions match the spoken dialogue accurately',
      'Check that captions are in sync with the audio',
      'Confirm captions include speaker identification and relevant sound effects',
    ],
    goodExample: '<video controls>\n  <source src="demo.mp4">\n  <track kind="captions" src="demo-en.vtt" srclang="en" label="English" default>\n</video>',
    badExample: '<video controls>\n  <source src="demo.mp4">\n  <!-- No caption track -->\n</video>',
  },
  {
    id: '1.2.3',
    title: 'Audio Description or Media Alternative (Prerecorded)',
    level: 'A',
    automatable: 'none',
    testInstructions:
      'An alternative for time-based media or audio description is provided for prerecorded video.',
    whatToCheck: [
      'Is audio description available for video content?',
      'Does the text alternative convey all visual information?',
    ],
    steps: [
      'Watch each video and note important visual-only information (on-screen text, actions, scene changes)',
      'Check if an audio description track is available',
      'If no audio description exists, check for a full text transcript that covers visual content',
      'Verify the alternative conveys all information not available in the main audio track',
    ],
    goodExample: '<video controls>\n  <source src="demo.mp4">\n  <track kind="descriptions" src="demo-ad.vtt" srclang="en">\n</video>',
    badExample: '<video controls>\n  <source src="demo.mp4">\n  <!-- No audio description and visual content not described in dialogue -->\n</video>',
  },
  {
    id: '1.2.5',
    title: 'Audio Description (Prerecorded)',
    level: 'AA',
    automatable: 'none',
    testInstructions:
      'Audio description is provided for all prerecorded video content.',
    whatToCheck: [
      'Is audio description provided describing important visual content?',
    ],
    steps: [
      'Identify all prerecorded video content on the page',
      'Check if an audio description track or alternate version with description is available',
      'Play the described version and verify it narrates important visual information during pauses',
      'Confirm that the description does not conflict with existing dialogue',
    ],
    goodExample: '<video controls>\n  <source src="tutorial.mp4">\n  <track kind="descriptions" src="tutorial-ad.vtt" srclang="en" label="Audio Description">\n</video>',
    badExample: '<video controls>\n  <source src="tutorial.mp4">\n  <!-- Video shows on-screen steps but no audio description is available -->\n</video>',
  },
  {
    id: '1.3.3',
    title: 'Sensory Characteristics',
    level: 'A',
    automatable: 'none',
    testInstructions:
      'Instructions do not rely solely on shape, color, size, visual location, orientation, or sound.',
    whatToCheck: [
      'Does the content avoid "click the red button" type instructions?',
      'Are visual cues supplemented with text labels?',
    ],
    steps: [
      'Read all instructions and help text on the page',
      'Check for references to shape, colour, size, or position only (e.g. "the green button on the right")',
      'Verify each instruction also includes a text-based identifier (e.g. "the Submit button")',
      'Test with display set to grayscale to confirm instructions still make sense',
    ],
    goodExample: '<p>Press the <strong>Submit</strong> button to continue.</p>',
    badExample: '<p>Press the green button on the right to continue.</p>',
  },
  {
    id: '1.4.1',
    title: 'Use of Color',
    level: 'A',
    automatable: 'none',
    testInstructions:
      'Color is not used as the only visual means of conveying information.',
    whatToCheck: [
      'Are links distinguishable from text by more than color?',
      'Do form errors use icons/text in addition to red color?',
      'Are charts/graphs readable without color?',
    ],
    steps: [
      'Check links — they should have underlines or other non-colour distinction',
      'Trigger form validation errors — verify error messages appear (not just red borders)',
      'If the page has charts/graphs, view them in grayscale (DevTools > Rendering > Emulate vision deficiencies)',
      'Look for required field indicators — they should use text like "(required)" not just a red asterisk',
    ],
    goodExample: '<a href="/about" style="color:#0056b3; text-decoration:underline">About us</a>\n\n<span class="error-icon" aria-hidden="true">!</span> <span class="error-text">Email is required</span>',
    badExample: '<a href="/about" style="color:#0056b3; text-decoration:none">About us</a>\n<!-- Only colour distinguishes link from text -->\n\n<input style="border-color:red">\n<!-- Only colour indicates error -->',
  },
  {
    id: '1.4.5',
    title: 'Images of Text',
    level: 'AA',
    automatable: 'none',
    testInstructions:
      'Text is used instead of images of text where possible.',
    whatToCheck: [
      'Are logos the only images containing text?',
      'Could image-based text be replaced with styled HTML?',
    ],
    steps: [
      'Look for text that is rendered as an image (e.g. banners, headings, buttons)',
      'Right-click and check — if "Inspect" shows an <img>, it is an image of text',
      'Determine if the text could be rendered with HTML and CSS instead',
      'Logos and brand marks are exempt — they may remain as images',
    ],
    goodExample: '<h1 style="font-family: Georgia; color: navy;">Welcome to Acme</h1>\n<!-- Real text, selectable and scalable -->',
    badExample: '<img src="welcome-banner.png" alt="Welcome to Acme">\n<!-- Text baked into image — cannot be resized or styled -->',
  },
  {
    id: '1.4.10',
    title: 'Reflow',
    level: 'AA',
    automatable: 'none',
    testInstructions:
      'Content can be presented without loss of information or functionality at 320 CSS px width without horizontal scrolling.',
    whatToCheck: [
      'Does the page reflow properly at 320px width?',
      'Is there no horizontal scrolling at 400% zoom?',
      'Are all content and functionality still accessible?',
    ],
    steps: [
      'Open DevTools and set the viewport to 320px width (or zoom browser to 400%)',
      'Scroll through the entire page',
      'Verify there is no horizontal scrollbar (except for data tables, maps, and diagrams)',
      'Check that all text is readable and not clipped',
      'Confirm all interactive elements are still usable',
    ],
    goodExample: '.container { max-width: 100%; padding: 1rem; }\nimg { max-width: 100%; height: auto; }',
    badExample: '.container { width: 1200px; }\n/* Fixed width causes horizontal scroll at small viewports */',
  },
  {
    id: '1.4.11',
    title: 'Non-text Contrast',
    level: 'AA',
    automatable: 'none',
    testInstructions:
      'UI components and graphical objects have at least 3:1 contrast ratio against adjacent colors.',
    whatToCheck: [
      'Do form field borders have sufficient contrast?',
      'Are icon-only buttons clearly visible?',
      'Do focus indicators meet 3:1 contrast?',
    ],
    steps: [
      'Use a colour contrast checker tool (e.g. Colour Contrast Analyser)',
      'Sample the border colour of form inputs and compare to background — needs 3:1',
      'Check icon-only buttons — the icon must contrast 3:1 against its background',
      'Tab through elements and check focus-ring colour contrast against surrounding area',
    ],
    goodExample: 'input { border: 2px solid #767676; } /* #767676 on #fff = 4.5:1 */\n.icon-btn svg { fill: #333; } /* High contrast icon */  ',
    badExample: 'input { border: 1px solid #ccc; } /* #ccc on #fff = 1.6:1 — fails */\n.icon-btn svg { fill: #bbb; } /* Low contrast icon */  ',
  },
  {
    id: '1.4.12',
    title: 'Text Spacing',
    level: 'AA',
    automatable: 'none',
    testInstructions:
      'No loss of content or functionality when text spacing is adjusted.',
    whatToCheck: [
      'Is content readable with increased line height (1.5x)?',
      'No overlapping text with increased letter spacing (0.12em)?',
      'No clipped content with increased word spacing (0.16em)?',
    ],
    steps: [
      'Use a text-spacing bookmarklet (search "text spacing bookmarklet WCAG")',
      'Or inject this CSS via DevTools: * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }',
      'Check that no text is clipped, overlapped, or hidden',
      'Verify all buttons and links still show their full text',
      'Look for containers with fixed height that cut off expanded text',
    ],
    goodExample: '.card-text { min-height: auto; overflow: visible; }\n/* Flexible container that adapts to text spacing changes */',
    badExample: '.card-text { height: 60px; overflow: hidden; }\n/* Fixed height clips text when spacing increases */',
  },
  {
    id: '1.4.13',
    title: 'Content on Hover or Focus',
    level: 'AA',
    automatable: 'none',
    testInstructions:
      'Additional content triggered by hover/focus is dismissible, hoverable, and persistent.',
    whatToCheck: [
      'Can tooltips be dismissed without moving focus (e.g. Escape)?',
      'Can the pointer move to hover content without it disappearing?',
      'Does hover content stay visible until dismissed?',
    ],
    steps: [
      'Identify all tooltips, popovers, and hover-triggered content',
      'Hover over the trigger — content should appear',
      'Move the pointer to the hover content itself — it should remain visible',
      'Press Escape — the hover content should dismiss',
      'Trigger via keyboard focus — the same content should appear',
    ],
    goodExample: '<div class="tooltip-trigger" tabindex="0" aria-describedby="tip1">\n  Help\n  <div id="tip1" role="tooltip" class="tooltip">Tooltip text</div>\n</div>\n/* Tooltip remains visible when hovered and dismissible with Escape */',
    badExample: '<span title="Help text">Help</span>\n<!-- Browser title tooltip cannot be hovered or dismissed with Escape -->',
  },
  {
    id: '2.1.2',
    title: 'No Keyboard Trap',
    level: 'A',
    automatable: 'none',
    testInstructions:
      'Keyboard focus can be moved away from any component using standard keys.',
    whatToCheck: [
      'Can you Tab out of every modal/dropdown?',
      'Does no component trap keyboard focus?',
    ],
    steps: [
      'Tab through every interactive element on the page',
      'At each element, verify you can Tab forward and Shift+Tab backward',
      'Open any modals or dropdowns and verify you can close them and return focus',
      'Test embedded content (iframes, video players) — focus should escape with Tab',
      'If you get stuck, the page has a keyboard trap',
    ],
    goodExample: '<dialog>\n  <h2>Confirm</h2>\n  <button onclick="this.closest(\'dialog\').close()">Close</button>\n</dialog>\n<!-- Focus returns to trigger after close -->',
    badExample: '<div class="modal" tabindex="0" onfocus="this.focus()">\n  <!-- Focus is trapped — Tab cycles only within this element -->\n</div>',
  },
  {
    id: '2.4.3',
    title: 'Focus Order',
    level: 'A',
    automatable: 'none',
    testInstructions:
      'Focus order preserves meaning and operability.',
    whatToCheck: [
      'Does Tab order follow visual/logical order?',
      'After modal close, does focus return to trigger?',
    ],
    steps: [
      'Tab through the page from start to finish',
      'Note the order — it should match the visual layout (left-to-right, top-to-bottom in LTR languages)',
      'Open a modal dialog — focus should move into the modal',
      'Close the modal — focus should return to the element that opened it',
      'Check for positive tabindex values (tabindex="5") which disrupt natural order',
    ],
    goodExample: '<!-- Natural DOM order matches visual order -->\n<nav>...</nav>\n<main>...</main>\n<footer>...</footer>',
    badExample: '<!-- DOM order does not match visual layout -->\n<footer>...</footer>\n<main>...</main>\n<nav tabindex="1">...</nav>',
  },
  {
    id: '2.4.5',
    title: 'Multiple Ways',
    level: 'AA',
    automatable: 'none',
    testInstructions:
      'More than one way is available to locate a web page within a set of pages.',
    whatToCheck: [
      'Is there a site map, search, or table of contents?',
      'Can pages be reached through navigation and search?',
    ],
    steps: [
      'Check for at least two of these navigation methods: main nav, search, sitemap, table of contents',
      'Try to reach an inner page using the navigation menu',
      'Try to reach the same page using search (if available)',
      'Single-page applications or single-purpose pages are exempt',
    ],
    goodExample: '<nav aria-label="Main">...</nav>\n<form role="search"><input type="search" ...></form>\n<a href="/sitemap">Sitemap</a>',
    badExample: '<!-- Only one navigation method available and no search or sitemap -->',
  },
  {
    id: '2.5.1',
    title: 'Pointer Gestures',
    level: 'A',
    automatable: 'none',
    testInstructions:
      'All multipoint or path-based gestures have single-pointer alternatives.',
    whatToCheck: [
      'Can pinch-to-zoom be done via buttons?',
      'Can swipe gestures be done with single taps/clicks?',
    ],
    steps: [
      'Identify features requiring multi-touch (pinch, two-finger scroll) or path-based gestures (swipe, drag)',
      'For each, verify there is a single-pointer alternative (buttons, click targets)',
      'Test map zoom — there should be +/- buttons in addition to pinch-to-zoom',
      'Test carousels — there should be prev/next buttons, not just swipe',
    ],
    goodExample: '<div class="carousel">\n  <button class="prev" aria-label="Previous slide">&lt;</button>\n  <div class="slides">...</div>\n  <button class="next" aria-label="Next slide">&gt;</button>\n</div>',
    badExample: '<div class="carousel" ontouchstart="handleSwipe()">\n  <div class="slides">...</div>\n  <!-- No buttons, swipe-only navigation -->\n</div>',
  },
  {
    id: '2.5.2',
    title: 'Pointer Cancellation',
    level: 'A',
    automatable: 'none',
    testInstructions:
      'For functionality operated by single pointer, at least one is true: no down-event, abort/undo, up reversal, or essential.',
    whatToCheck: [
      'Are actions triggered on mouseup/touchend rather than mousedown/touchstart?',
      'Can accidental clicks be undone?',
    ],
    steps: [
      'Click and hold on interactive elements — action should not fire on mousedown',
      'While holding, drag away from the element and release — no action should occur',
      'Verify that actions fire on click (mouseup), not mousedown',
      'For drag-and-drop, verify items can be dropped back to cancel',
    ],
    goodExample: '<button onclick="submitForm()">Submit</button>\n<!-- onclick fires on mouseup, allows drag-away to cancel -->',
    badExample: '<button onmousedown="submitForm()">Submit</button>\n<!-- Fires immediately on press, no chance to cancel -->',
  },
  {
    id: '3.2.3',
    title: 'Consistent Navigation',
    level: 'AA',
    automatable: 'none',
    testInstructions:
      'Navigation mechanisms are consistent across pages.',
    whatToCheck: [
      'Is the main navigation in the same order on every page?',
      'Are repeated components consistent?',
    ],
    steps: [
      'Visit 3-4 different pages on the site',
      'Compare the main navigation menu — same items in same order?',
      'Compare the header and footer layout — consistent across pages?',
      'Check that breadcrumbs, search bars, and login links appear in the same location',
    ],
    goodExample: '<!-- Same nav order on every page -->\n<nav>\n  <a href="/">Home</a>\n  <a href="/about">About</a>\n  <a href="/contact">Contact</a>\n</nav>',
    badExample: '<!-- Nav order changes between pages -->\nPage 1: Home | About | Contact\nPage 2: About | Home | Contact',
  },
  {
    id: '3.2.4',
    title: 'Consistent Identification',
    level: 'AA',
    automatable: 'none',
    testInstructions:
      'Components with the same functionality are identified consistently.',
    whatToCheck: [
      'Do search icons/buttons have the same label across pages?',
      'Are similar functions named the same way?',
    ],
    steps: [
      'Identify components that repeat across pages (search, login, print buttons)',
      'Verify each uses the same label, icon, and accessible name on every page',
      'Check that similar actions use consistent wording (not "Search" on one page and "Find" on another)',
      'Inspect aria-labels on icon buttons — they should match across pages',
    ],
    goodExample: '<!-- Same label everywhere -->\n<button aria-label="Search">...</button>\n<!-- Used consistently on all pages -->',
    badExample: '<!-- Inconsistent labelling -->\nPage 1: <button aria-label="Search">...</button>\nPage 2: <button aria-label="Find content">...</button>',
  },
  {
    id: '3.3.3',
    title: 'Error Suggestion',
    level: 'AA',
    automatable: 'none',
    testInstructions:
      'If an input error is detected and suggestions are known, they are provided.',
    whatToCheck: [
      'Do form errors explain what went wrong?',
      'Are correction suggestions offered?',
    ],
    steps: [
      'Submit forms with intentionally invalid data (wrong email format, missing required fields)',
      'Check that each error message explains what is wrong',
      'Verify suggestions are offered where possible (e.g. "Email must include @")',
      'Ensure errors are associated with their fields via aria-describedby or inline placement',
    ],
    goodExample: '<input id="email" type="email" aria-describedby="email-error">\n<span id="email-error" class="error">Please enter a valid email, e.g. name@example.com</span>',
    badExample: '<input type="email">\n<span class="error">Invalid input</span>\n<!-- No specific suggestion offered -->',
  },
  {
    id: '3.3.4',
    title: 'Error Prevention (Legal, Financial, Data)',
    level: 'AA',
    automatable: 'none',
    testInstructions:
      'For legal/financial/data submissions, actions are reversible, checked, or confirmed.',
    whatToCheck: [
      'Can users review before submitting?',
      'Is there a confirmation step?',
      'Can submissions be reversed?',
    ],
    steps: [
      'Identify any forms that handle legal, financial, or personal data',
      'Attempt to submit — verify a review/confirmation step appears before final submission',
      'Check that users can edit/correct information after review',
      'Verify there is an undo or cancel option after submission',
      'For deletion actions, confirm a "Are you sure?" dialog appears',
    ],
    goodExample: '<form>\n  <!-- Step 1: Enter data -->\n  <!-- Step 2: Review -->\n  <h2>Review your order</h2>\n  <button type="button">Edit</button>\n  <button type="submit">Confirm &amp; Pay</button>\n</form>',
    badExample: '<form>\n  <!-- Single step, no review -->\n  <button type="submit">Pay Now</button>\n  <!-- Immediate, irreversible submission -->\n</form>',
  },
] as const;

/**
 * Return criteria grouped by automatable level: 'none' first, then 'partial'.
 */
export function getGroupedCriteria(): {
  readonly manual: readonly ManualCriterion[];
  readonly partial: readonly ManualCriterion[];
} {
  const manual = MANUAL_CRITERIA.filter((c) => c.automatable === 'none');
  const partial = MANUAL_CRITERIA.filter((c) => c.automatable === 'partial');
  return { manual, partial };
}
