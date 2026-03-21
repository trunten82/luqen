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
