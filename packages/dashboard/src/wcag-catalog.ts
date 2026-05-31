// Canonical WCAG success-criteria catalog (WCAG 2.0 + 2.1 + 2.2), used to build
// VPAT / ACR conformance tables. The 2.0/2.1 rows mirror
// packages/compliance/src/seed/wcag-criteria.json; the nine WCAG 2.2 rows are
// maintained directly here. 88 entries total. The human-judgement 2.2 criteria
// also have manual-test entries in manual-criteria.ts so they correctly report
// "Not Evaluated" (never "Supports") until a person records a manual result.

export type WcagLevel = 'A' | 'AA' | 'AAA';

export interface WcagCatalogEntry {
  readonly criterion: string;   // e.g. "1.1.1"
  readonly title: string;
  readonly level: WcagLevel;
  readonly version: string;     // "2.0" | "2.1" | "2.2" (originating WCAG version)
  readonly url: string;
}

export const WCAG_CATALOG: readonly WcagCatalogEntry[] = [
  { criterion: '1.1.1', title: 'Non-text Content', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/text-equiv-all.html' },
  { criterion: '1.2.1', title: 'Audio-only and Video-only (Prerecorded)', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/media-equiv-av-only-alt.html' },
  { criterion: '1.2.2', title: 'Captions (Prerecorded)', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/media-equiv-captions.html' },
  { criterion: '1.2.3', title: 'Audio Description or Media Alternative (Prerecorded)', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/media-equiv-audio-desc.html' },
  { criterion: '1.2.4', title: 'Captions (Live)', level: 'AA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/media-equiv-real-time-captions.html' },
  { criterion: '1.2.5', title: 'Audio Description (Prerecorded)', level: 'AA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/media-equiv-audio-desc-only.html' },
  { criterion: '1.2.6', title: 'Sign Language (Prerecorded)', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/media-equiv-sign.html' },
  { criterion: '1.2.7', title: 'Extended Audio Description (Prerecorded)', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/media-equiv-extended-ad.html' },
  { criterion: '1.2.8', title: 'Media Alternative (Prerecorded)', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/media-equiv-text-doc.html' },
  { criterion: '1.2.9', title: 'Audio-only (Live)', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/media-equiv-live-audio-only.html' },
  { criterion: '1.3.1', title: 'Info and Relationships', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/content-structure-separation-programmatic.html' },
  { criterion: '1.3.2', title: 'Meaningful Sequence', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/content-structure-separation-sequence.html' },
  { criterion: '1.3.3', title: 'Sensory Characteristics', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/content-structure-separation-understanding.html' },
  { criterion: '1.3.4', title: 'Orientation', level: 'AA', version: '2.1', url: 'https://www.w3.org/WAI/WCAG21/Understanding/orientation' },
  { criterion: '1.3.5', title: 'Identify Input Purpose', level: 'AA', version: '2.1', url: 'https://www.w3.org/WAI/WCAG21/Understanding/identify-input-purpose' },
  { criterion: '1.3.6', title: 'Identify Purpose', level: 'AAA', version: '2.1', url: 'https://www.w3.org/WAI/WCAG21/Understanding/identify-purpose' },
  { criterion: '1.4.1', title: 'Use of Color', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/visual-audio-contrast-without-color.html' },
  { criterion: '1.4.2', title: 'Audio Control', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/visual-audio-contrast-dis-audio.html' },
  { criterion: '1.4.3', title: 'Contrast (Minimum)', level: 'AA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/visual-audio-contrast-contrast.html' },
  { criterion: '1.4.4', title: 'Resize Text', level: 'AA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/visual-audio-contrast-scale.html' },
  { criterion: '1.4.5', title: 'Images of Text', level: 'AA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/visual-audio-contrast-text-presentation.html' },
  { criterion: '1.4.6', title: 'Contrast (Enhanced)', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/visual-audio-contrast7.html' },
  { criterion: '1.4.7', title: 'Low or No Background Audio', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/visual-audio-contrast-noaudio.html' },
  { criterion: '1.4.8', title: 'Visual Presentation', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/visual-audio-contrast-visual-presentation.html' },
  { criterion: '1.4.9', title: 'Images of Text (No Exception)', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/visual-audio-contrast-text-images.html' },
  { criterion: '1.4.10', title: 'Reflow', level: 'AA', version: '2.1', url: 'https://www.w3.org/WAI/WCAG21/Understanding/reflow' },
  { criterion: '1.4.11', title: 'Non-text Contrast', level: 'AA', version: '2.1', url: 'https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast' },
  { criterion: '1.4.12', title: 'Text Spacing', level: 'AA', version: '2.1', url: 'https://www.w3.org/WAI/WCAG21/Understanding/text-spacing' },
  { criterion: '1.4.13', title: 'Content on Hover or Focus', level: 'AA', version: '2.1', url: 'https://www.w3.org/WAI/WCAG21/Understanding/content-on-hover-or-focus' },
  { criterion: '2.1.1', title: 'Keyboard', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/keyboard-operation-keyboard-operable.html' },
  { criterion: '2.1.2', title: 'No Keyboard Trap', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/keyboard-operation-trapping.html' },
  { criterion: '2.1.3', title: 'Keyboard (No Exception)', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/keyboard-operation-all-funcs.html' },
  { criterion: '2.1.4', title: 'Character Key Shortcuts', level: 'A', version: '2.1', url: 'https://www.w3.org/WAI/WCAG21/Understanding/character-key-shortcuts' },
  { criterion: '2.2.1', title: 'Timing Adjustable', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/time-limits-required-behaviors.html' },
  { criterion: '2.2.2', title: 'Pause, Stop, Hide', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/time-limits-pause.html' },
  { criterion: '2.2.3', title: 'No Timing', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/time-limits-no-exceptions.html' },
  { criterion: '2.2.4', title: 'Interruptions', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/time-limits-postponed.html' },
  { criterion: '2.2.5', title: 'Re-authenticating', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/time-limits-server-timeout.html' },
  { criterion: '2.2.6', title: 'Timeouts', level: 'AAA', version: '2.1', url: 'https://www.w3.org/WAI/WCAG21/Understanding/timeouts' },
  { criterion: '2.3.1', title: 'Three Flashes or Below Threshold', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/seizure-does-not-violate.html' },
  { criterion: '2.3.2', title: 'Three Flashes', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/seizure-three-times.html' },
  { criterion: '2.3.3', title: 'Animation from Interactions', level: 'AAA', version: '2.1', url: 'https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions' },
  { criterion: '2.4.1', title: 'Bypass Blocks', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/navigation-mechanisms-skip.html' },
  { criterion: '2.4.2', title: 'Page Titled', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/navigation-mechanisms-title.html' },
  { criterion: '2.4.3', title: 'Focus Order', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/navigation-mechanisms-focus-order.html' },
  { criterion: '2.4.4', title: 'Link Purpose (In Context)', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/navigation-mechanisms-refs.html' },
  { criterion: '2.4.5', title: 'Multiple Ways', level: 'AA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/navigation-mechanisms-mult-loc.html' },
  { criterion: '2.4.6', title: 'Headings and Labels', level: 'AA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/navigation-mechanisms-descriptive.html' },
  { criterion: '2.4.7', title: 'Focus Visible', level: 'AA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/navigation-mechanisms-focus-visible.html' },
  { criterion: '2.4.8', title: 'Location', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/navigation-mechanisms-location.html' },
  { criterion: '2.4.9', title: 'Link Purpose (Link Only)', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/navigation-mechanisms-link.html' },
  { criterion: '2.4.10', title: 'Section Headings', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/navigation-mechanisms-headings.html' },
  { criterion: '2.5.1', title: 'Pointer Gestures', level: 'A', version: '2.1', url: 'https://www.w3.org/WAI/WCAG21/Understanding/pointer-gestures' },
  { criterion: '2.5.2', title: 'Pointer Cancellation', level: 'A', version: '2.1', url: 'https://www.w3.org/WAI/WCAG21/Understanding/pointer-cancellation' },
  { criterion: '2.5.3', title: 'Label in Name', level: 'A', version: '2.1', url: 'https://www.w3.org/WAI/WCAG21/Understanding/label-in-name' },
  { criterion: '2.5.4', title: 'Motion Actuation', level: 'A', version: '2.1', url: 'https://www.w3.org/WAI/WCAG21/Understanding/motion-actuation' },
  { criterion: '2.5.5', title: 'Target Size', level: 'AAA', version: '2.1', url: 'https://www.w3.org/WAI/WCAG21/Understanding/target-size' },
  { criterion: '2.5.6', title: 'Concurrent Input Mechanisms', level: 'AAA', version: '2.1', url: 'https://www.w3.org/WAI/WCAG21/Understanding/concurrent-input-mechanisms' },
  { criterion: '3.1.1', title: 'Language of Page', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/meaning-doc-lang-id.html' },
  { criterion: '3.1.2', title: 'Language of Parts', level: 'AA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/meaning-other-lang-id.html' },
  { criterion: '3.1.3', title: 'Unusual Words', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/meaning-idioms.html' },
  { criterion: '3.1.4', title: 'Abbreviations', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/meaning-located.html' },
  { criterion: '3.1.5', title: 'Reading Level', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/meaning-supplements.html' },
  { criterion: '3.1.6', title: 'Pronunciation', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/meaning-pronunciation.html' },
  { criterion: '3.2.1', title: 'On Focus', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/consistent-behavior-receive-focus.html' },
  { criterion: '3.2.2', title: 'On Input', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/consistent-behavior-unpredictable-change.html' },
  { criterion: '3.2.3', title: 'Consistent Navigation', level: 'AA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/consistent-behavior-consistent-locations.html' },
  { criterion: '3.2.4', title: 'Consistent Identification', level: 'AA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/consistent-behavior-consistent-functionality.html' },
  { criterion: '3.2.5', title: 'Change on Request', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/consistent-behavior-no-extreme-changes-context.html' },
  { criterion: '3.3.1', title: 'Error Identification', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/minimize-error-identified.html' },
  { criterion: '3.3.2', title: 'Labels or Instructions', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/minimize-error-cues.html' },
  { criterion: '3.3.3', title: 'Error Suggestion', level: 'AA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/minimize-error-suggestions.html' },
  { criterion: '3.3.4', title: 'Error Prevention (Legal, Financial, Data)', level: 'AA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/minimize-error-reversible.html' },
  { criterion: '3.3.5', title: 'Help', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/minimize-error-context-help.html' },
  { criterion: '3.3.6', title: 'Error Prevention (All)', level: 'AAA', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/minimize-error-reversible-all.html' },
  { criterion: '4.1.1', title: 'Parsing', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/ensure-compat-parses.html' },
  { criterion: '4.1.2', title: 'Name, Role, Value', level: 'A', version: '2.0', url: 'https://www.w3.org/TR/UNDERSTANDING-WCAG20/ensure-compat-rsv.html' },
  { criterion: '4.1.3', title: 'Status Messages', level: 'AA', version: '2.1', url: 'https://www.w3.org/WAI/WCAG21/Understanding/status-messages' },
  // ── WCAG 2.2 additions (2023) ──────────────────────────────────────────────
  { criterion: '2.4.11', title: 'Focus Not Obscured (Minimum)', level: 'AA', version: '2.2', url: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum' },
  { criterion: '2.4.12', title: 'Focus Not Obscured (Enhanced)', level: 'AAA', version: '2.2', url: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-enhanced' },
  { criterion: '2.4.13', title: 'Focus Appearance', level: 'AAA', version: '2.2', url: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance' },
  { criterion: '2.5.7', title: 'Dragging Movements', level: 'AA', version: '2.2', url: 'https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements' },
  { criterion: '2.5.8', title: 'Target Size (Minimum)', level: 'AA', version: '2.2', url: 'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum' },
  { criterion: '3.2.6', title: 'Consistent Help', level: 'A', version: '2.2', url: 'https://www.w3.org/WAI/WCAG22/Understanding/consistent-help' },
  { criterion: '3.3.7', title: 'Redundant Entry', level: 'A', version: '2.2', url: 'https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry' },
  { criterion: '3.3.8', title: 'Accessible Authentication (Minimum)', level: 'AA', version: '2.2', url: 'https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum' },
  { criterion: '3.3.9', title: 'Accessible Authentication (Enhanced)', level: 'AAA', version: '2.2', url: 'https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-enhanced' },
];

const LEVEL_RANK: Record<WcagLevel, number> = { A: 1, AA: 2, AAA: 3 };

/**
 * Returns the catalog entries at or below the requested conformance level,
 * sorted by criterion number. e.g. maxLevel="AA" yields all A + AA criteria.
 */
export function catalogForLevel(maxLevel: WcagLevel): readonly WcagCatalogEntry[] {
  const ceiling = LEVEL_RANK[maxLevel];
  return WCAG_CATALOG.filter((e) => LEVEL_RANK[e.level] <= ceiling);
}

/**
 * Maps a scan "standard" code (WCAG2A | WCAG2AA | WCAG2AAA) to a WcagLevel.
 * Defaults to AA when the code is unrecognised.
 */
export function levelFromStandard(standard: string | undefined | null): WcagLevel {
  const s = (standard ?? '').toUpperCase();
  if (s.endsWith('AAA')) return 'AAA';
  if (s.endsWith('AA')) return 'AA';
  if (s.endsWith('2A') || s.endsWith('WCAG2A') || /A$/.test(s)) return 'A';
  return 'AA';
}
