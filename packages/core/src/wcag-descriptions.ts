// Human-friendly descriptions for WCAG 2.1 Level A and AA success criteria.
// Each entry provides a plain-language title, description, and user impact statement.

export interface WcagCriterionInfo {
  readonly title: string;
  readonly description: string;
  readonly impact: string;
}

export const WCAG_DESCRIPTIONS: Record<string, WcagCriterionInfo> = {
  // Principle 1: Perceivable
  // Guideline 1.1 – Text Alternatives
  '1.1.1': {
    title: 'Non-text Content',
    description:
      'All images, icons, and non-text content must have text alternatives that describe their purpose.',
    impact: 'Screen reader users cannot understand what images convey without alt text.',
  },
  // Guideline 1.2 – Time-based Media
  '1.2.1': {
    title: 'Audio-only and Video-only (Prerecorded)',
    description:
      'Prerecorded audio-only and video-only content must have a text or audio alternative.',
    impact: 'Deaf, hard-of-hearing, or blind users cannot access media-only content.',
  },
  '1.2.2': {
    title: 'Captions (Prerecorded)',
    description: 'Captions must be provided for all prerecorded audio content in synchronized media.',
    impact: 'Deaf and hard-of-hearing users cannot follow video dialogue without captions.',
  },
  '1.2.3': {
    title: 'Audio Description or Media Alternative (Prerecorded)',
    description:
      'An audio description or text alternative must be provided for prerecorded video content.',
    impact: 'Blind users cannot perceive visual information in video without audio descriptions.',
  },
  '1.2.4': {
    title: 'Captions (Live)',
    description: 'Captions must be provided for all live audio content in synchronized media.',
    impact: 'Deaf and hard-of-hearing users cannot follow live broadcasts without real-time captions.',
  },
  '1.2.5': {
    title: 'Audio Description (Prerecorded)',
    description: 'Audio description must be provided for all prerecorded video content.',
    impact:
      'Blind users miss visual context in videos when audio descriptions are absent.',
  },
  // Guideline 1.3 – Adaptable
  '1.3.1': {
    title: 'Info and Relationships',
    description:
      'Information and relationships conveyed through presentation must also be available in code (e.g., headings, lists, tables use proper HTML elements).',
    impact: 'Assistive technology users may miss the structure and meaning of content.',
  },
  '1.3.2': {
    title: 'Meaningful Sequence',
    description:
      'When the order of content matters, the correct reading sequence must be determinable programmatically.',
    impact:
      'Screen reader users encounter content out of order, leading to confusion.',
  },
  '1.3.3': {
    title: 'Sensory Characteristics',
    description:
      'Instructions must not rely solely on shape, color, size, visual location, orientation, or sound.',
    impact:
      'Users who are blind or color-blind cannot follow instructions tied to visual appearance alone.',
  },
  '1.3.4': {
    title: 'Orientation',
    description:
      'Content must not restrict its view and operation to a single display orientation unless essential.',
    impact:
      'Users who mount devices in a fixed orientation (e.g., wheelchair users) cannot use restricted content.',
  },
  '1.3.5': {
    title: 'Identify Input Purpose',
    description:
      'The purpose of each input field collecting information about the user must be programmatically determinable.',
    impact:
      'Users with cognitive disabilities cannot benefit from autofill when input purpose is not identified.',
  },
  // Guideline 1.4 – Distinguishable
  '1.4.1': {
    title: 'Use of Color',
    description: 'Color must not be used as the only visual means of conveying information.',
    impact:
      'Color-blind users cannot distinguish information conveyed by color alone.',
  },
  '1.4.2': {
    title: 'Audio Control',
    description:
      'If audio plays automatically for more than 3 seconds, a mechanism must be provided to pause, stop, or control the volume.',
    impact:
      'Screen reader users cannot hear their assistive technology when audio plays over it.',
  },
  '1.4.3': {
    title: 'Contrast (Minimum)',
    description:
      'Text must have a contrast ratio of at least 4.5:1 against its background (3:1 for large text).',
    impact: 'Users with low vision or color blindness cannot read text with insufficient contrast.',
  },
  '1.4.4': {
    title: 'Resize Text',
    description: 'Text must be resizable up to 200% without loss of content or functionality.',
    impact:
      'Users with low vision who increase text size may lose access to content if the page breaks.',
  },
  '1.4.5': {
    title: 'Images of Text',
    description:
      'Images of text should only be used when a particular presentation is essential; real text is preferred.',
    impact:
      'Images of text cannot be resized, recolored, or read reliably by assistive technologies.',
  },
  '1.4.10': {
    title: 'Reflow',
    description:
      'Content must reflow into a single column at 320 CSS pixels wide without loss of information or requiring horizontal scrolling.',
    impact: 'Users with low vision who zoom into pages lose access to content requiring horizontal scrolling.',
  },
  '1.4.11': {
    title: 'Non-text Contrast',
    description:
      'UI components and graphical objects must have at least a 3:1 contrast ratio against adjacent colors.',
    impact:
      'Users with low vision cannot see interface controls or meaningful graphics with insufficient contrast.',
  },
  '1.4.12': {
    title: 'Text Spacing',
    description:
      'Content must remain readable when users override line height, letter spacing, word spacing, and paragraph spacing.',
    impact:
      'Users with dyslexia who adjust text spacing may encounter content that breaks or overlaps.',
  },
  '1.4.13': {
    title: 'Content on Hover or Focus',
    description:
      'Content that appears on hover or focus must be dismissible, hoverable, and persistent.',
    impact: 'Users with low vision and motor disabilities cannot access or dismiss tooltip-style content.',
  },
  // Principle 2: Operable
  // Guideline 2.1 – Keyboard Accessible
  '2.1.1': {
    title: 'Keyboard',
    description: 'All functionality must be operable via a keyboard without requiring specific timing.',
    impact:
      'Users who cannot use a mouse rely entirely on keyboard access; missing keyboard support excludes them.',
  },
  '2.1.2': {
    title: 'No Keyboard Trap',
    description:
      'Keyboard focus must not become trapped; users must be able to move focus away from any component.',
    impact: 'Keyboard users get stuck in a component and cannot navigate the rest of the page.',
  },
  '2.1.4': {
    title: 'Character Key Shortcuts',
    description:
      'If single-character key shortcuts exist, users must be able to turn them off, remap, or activate only on focus.',
    impact: 'Users who speak commands or have motor disabilities may accidentally trigger shortcuts.',
  },
  // Guideline 2.2 – Enough Time
  '2.2.1': {
    title: 'Timing Adjustable',
    description:
      'Time limits must be adjustable: users can turn off, extend, or adjust any time limit unless essential.',
    impact:
      'Users who need more time (cognitive, motor disabilities) may be timed out before completing tasks.',
  },
  '2.2.2': {
    title: 'Pause, Stop, Hide',
    description:
      'Moving, blinking, or scrolling content that starts automatically and lasts more than 5 seconds must have a mechanism to pause, stop, or hide it.',
    impact:
      'Users with attention or cognitive disabilities are distracted by moving content they cannot stop.',
  },
  // Guideline 2.3 – Seizures and Physical Reactions
  '2.3.1': {
    title: 'Three Flashes or Below Threshold',
    description:
      'Pages must not contain content that flashes more than three times per second, or the flash is below thresholds.',
    impact: 'Content that flashes rapidly can trigger seizures in users with photosensitive epilepsy.',
  },
  // Guideline 2.4 – Navigable
  '2.4.1': {
    title: 'Bypass Blocks',
    description:
      'A mechanism must be provided to skip repeated blocks of content (e.g., skip navigation links).',
    impact:
      'Keyboard users must tab through every navigation link on every page without a skip link.',
  },
  '2.4.2': {
    title: 'Page Titled',
    description: 'Web pages must have descriptive, meaningful titles.',
    impact: 'Users navigating with browser tabs or screen readers cannot identify pages without titles.',
  },
  '2.4.3': {
    title: 'Focus Order',
    description: 'Focusable components must receive focus in an order that preserves meaning and operability.',
    impact:
      'Keyboard and screen reader users are confused when focus jumps around in an illogical order.',
  },
  '2.4.4': {
    title: 'Link Purpose (In Context)',
    description:
      'The purpose of each link must be clear from the link text alone, or from the link text together with its context.',
    impact:
      'Screen reader users navigating a list of links cannot determine where "click here" goes.',
  },
  '2.4.5': {
    title: 'Multiple Ways',
    description:
      'More than one way must be provided to locate a page within a set of pages (e.g., search, site map, navigation).',
    impact:
      'Users who cannot use certain navigation mechanisms are blocked from finding content.',
  },
  '2.4.6': {
    title: 'Headings and Labels',
    description: 'Headings and labels must describe the topic or purpose of the associated content.',
    impact:
      'Screen reader users rely on headings to scan and navigate; vague headings make orientation impossible.',
  },
  '2.4.7': {
    title: 'Focus Visible',
    description: 'Any keyboard-operable interface must have a visible focus indicator.',
    impact: 'Keyboard users cannot tell which element has focus when the indicator is invisible.',
  },
  // Guideline 2.5 – Input Modalities
  '2.5.1': {
    title: 'Pointer Gestures',
    description:
      'All functionality that uses multipoint or path-based gestures must be operable with a single pointer.',
    impact:
      'Users with motor disabilities who cannot perform complex gestures (pinch, swipe) lose access.',
  },
  '2.5.2': {
    title: 'Pointer Cancellation',
    description:
      'Functions triggered by a single pointer must be cancellable or reversible to prevent accidental activation.',
    impact: 'Users with tremors who accidentally touch a target cannot undo unintended actions.',
  },
  '2.5.3': {
    title: 'Label in Name',
    description:
      'For UI components with visible text labels, the accessible name must contain the visible text.',
    impact:
      'Voice control users who speak the visible label cannot activate controls with mismatched accessible names.',
  },
  '2.5.4': {
    title: 'Motion Actuation',
    description:
      'Functionality triggered by device motion must also be operable through UI components, with the ability to disable motion response.',
    impact:
      'Users with tremors or who mount devices in fixed positions cannot use motion-triggered features.',
  },
  // Principle 3: Understandable
  // Guideline 3.1 – Readable
  '3.1.1': {
    title: 'Language of Page',
    description:
      'The default human language of each page must be programmatically determinable.',
    impact:
      'Screen readers may mispronounce content if the page language is not declared in the HTML.',
  },
  '3.1.2': {
    title: 'Language of Parts',
    description:
      'The language of each passage or phrase in the content must be programmatically determinable.',
    impact:
      'Screen readers cannot switch pronunciation correctly between languages when parts are not marked up.',
  },
  // Guideline 3.2 – Predictable
  '3.2.1': {
    title: 'On Focus',
    description: 'Receiving keyboard focus must not trigger an unexpected change of context.',
    impact: 'Keyboard and screen reader users are disoriented when focusing an element causes page changes.',
  },
  '3.2.2': {
    title: 'On Input',
    description:
      'Changing a form control must not automatically cause a change of context without warning the user.',
    impact: 'Users with motor impairments may accidentally trigger navigation or actions.',
  },
  '3.2.3': {
    title: 'Consistent Navigation',
    description:
      'Navigation mechanisms repeated across pages must occur in the same relative order each time.',
    impact:
      'Users with cognitive disabilities are confused when navigation moves around between pages.',
  },
  '3.2.4': {
    title: 'Consistent Identification',
    description:
      'Components with the same functionality must be identified consistently across the website.',
    impact:
      'Users who learn one component cannot transfer that knowledge when identical components are labeled differently.',
  },
  // Guideline 3.3 – Input Assistance
  '3.3.1': {
    title: 'Error Identification',
    description:
      'If an input error is detected automatically, the item in error must be identified and described in text.',
    impact:
      'Users who are blind or have cognitive disabilities cannot identify and correct errors from visual cues alone.',
  },
  '3.3.2': {
    title: 'Labels or Instructions',
    description:
      'Labels or instructions must be provided when content requires user input.',
    impact:
      'Users do not know what is expected in a form field without labels or instructions.',
  },
  '3.3.3': {
    title: 'Error Suggestion',
    description:
      'If an input error is detected and suggestions for correction are known, the suggestion must be provided.',
    impact:
      'Users who make mistakes have no guidance on how to correct them, increasing frustration and errors.',
  },
  '3.3.4': {
    title: 'Error Prevention (Legal, Financial, Data)',
    description:
      'For legal, financial, or data-deletion submissions, users must be able to review, correct, and confirm or reverse their submission.',
    impact:
      'Users with cognitive or motor disabilities may make unintentional errors with serious consequences.',
  },
  // Principle 4: Robust
  // Guideline 4.1 – Compatible
  '4.1.1': {
    title: 'Parsing',
    description:
      'HTML must have complete start and end tags, not duplicate attributes, and properly nested elements so parsers can interpret content reliably.',
    impact:
      'Malformed HTML may be interpreted differently across browsers and assistive technologies.',
  },
  '4.1.2': {
    title: 'Name, Role, Value',
    description:
      'All UI components must have programmatically determinable names, roles, states, and values.',
    impact:
      'Screen reader users cannot interact with unlabeled or incorrectly coded controls.',
  },
  '4.1.3': {
    title: 'Status Messages',
    description:
      'Status messages must be programmatically determinable so they can be announced by assistive technology without receiving focus.',
    impact:
      'Screen reader users do not hear status updates (e.g., "Item added to cart") that appear dynamically.',
  },
};

/**
 * Retrieve plain-language information for a WCAG success criterion number.
 * Returns undefined if the criterion is not in the map.
 */
export function getWcagDescription(criterion: string): WcagCriterionInfo | undefined {
  return WCAG_DESCRIPTIONS[criterion];
}

/**
 * Extract a WCAG criterion number (e.g. "1.1.1") from a pa11y issue code.
 * Example: "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37" → "1.1.1"
 * Returns null if no criterion is found in the code.
 */
export function extractCriterion(pa11yCode: string): string | null {
  // Match pattern like 1_1_1 in the code string
  const match = pa11yCode.match(/(\d+)_(\d+)_(\d+)/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}
