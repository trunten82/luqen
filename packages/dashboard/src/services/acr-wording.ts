/**
 * ACR wording catalog + resolver.
 *
 * The Accessibility Conformance Report is single-source AND localizable: the
 * shared template renders NO hardcoded prose — every string comes from here.
 * Each string has a STANDARD localized default (from the app i18n catalog,
 * mostly the existing `vpat.*` keys) and may be overridden per-org with custom
 * or officially-translated wording. The resolver merges the two and tags every
 * string with provenance so the report and the wording-management admin can
 * show the source (standard vs official-VPAT vs custom) and whether a
 * non-English standard string has been human-reviewed.
 *
 * Pure and side-effect-free — unit-tested.
 */

/** Provenance of a resolved ACR string. */
export type AcrWordingSource =
  /** App i18n default (Luqen-provided localized wording). */
  | 'standard'
  /** Official localized VPAT / EN 301 549 wording supplied as an override. */
  | 'vpat-standard'
  /** Org-authored custom wording. */
  | 'custom';

/** One catalog entry: the template field name and the i18n key it defaults to. */
export interface AcrWordingKey {
  readonly key: string;
  readonly i18nKey: string;
}

/** A per-org override row (locale-scoped) from the wording store. */
export interface AcrWordingOverride {
  readonly key: string;
  readonly locale: string;
  readonly text: string;
  readonly source: AcrWordingSource;
  readonly reviewed: boolean;
  readonly translatedBy?: string | null;
  readonly translatedAt?: string | null;
  readonly notes?: string | null;
}

/** A resolved string ready for the template, with provenance. */
export interface ResolvedAcrString {
  readonly text: string;
  readonly source: AcrWordingSource;
  readonly reviewed: boolean;
  readonly translatedBy?: string | null;
  readonly translatedAt?: string | null;
  readonly notes?: string | null;
}

/** Minimal translator contract (matches the app i18n `t`). */
export type Translator = (key: string, locale: string, params?: Record<string, string>) => string;

/**
 * Locales whose STANDARD (app-default) ACR wording is considered human-reviewed
 * for legal use. English is authoritative; every other locale's standard
 * wording is a translation that must be reviewed (surfaced as needs-review)
 * until an org supplies a `vpat-standard`/`custom` override marked reviewed.
 */
export const STANDARD_REVIEWED_LOCALES: ReadonlySet<string> = new Set(['en']);

/**
 * The ACR string catalog. `key` is the field the shared template reads from
 * `view.strings`; `i18nKey` is the app i18n key holding the standard localized
 * default. Most reuse the existing `vpat.*` keys (already translated into all
 * supported locales); the `acr.*` keys are new (added to every locale file).
 */
export const ACR_WORDING_KEYS: readonly AcrWordingKey[] = [
  // Masthead
  { key: 'title', i18nKey: 'vpat.title' },
  { key: 'generatedAt', i18nKey: 'vpat.generatedAt' },
  { key: 'identityContact', i18nKey: 'vpat.identityContact' },
  // Conformance tally labels
  { key: 'tallySupports', i18nKey: 'vpat.summarySupports' },
  { key: 'tallyPartial', i18nKey: 'vpat.summaryPartial' },
  { key: 'tallyDoesNotSupport', i18nKey: 'vpat.summaryDoesNotSupport' },
  { key: 'tallyNotApplicable', i18nKey: 'vpat.summaryNotApplicable' },
  { key: 'tallyNotEvaluated', i18nKey: 'vpat.summaryNotEvaluated' },
  { key: 'tallyTotal', i18nKey: 'vpat.summaryTotal' },
  // Methodology & scope
  { key: 'methodologyHeading', i18nKey: 'vpat.methodologyHeading' },
  { key: 'methodologyBody', i18nKey: 'vpat.methodologyBody' },
  { key: 'methodologyCaveat', i18nKey: 'vpat.disclaimerBody' },
  // Evaluation methodology & attestation
  { key: 'attestationHeading', i18nKey: 'vpat.attestationHeading' },
  { key: 'attestationStatement', i18nKey: 'vpat.attestationStatement' },
  { key: 'attLabelEvaluationDate', i18nKey: 'vpat.attEvaluationDate' },
  { key: 'attLabelScope', i18nKey: 'vpat.attScope' },
  { key: 'attLabelStandards', i18nKey: 'vpat.attStandards' },
  { key: 'attLabelMethods', i18nKey: 'vpat.attMethods' },
  { key: 'attLabelEvaluator', i18nKey: 'vpat.attEvaluator' },
  { key: 'attLabelReasonedChanges', i18nKey: 'vpat.attReasonedChanges' },
  // Standards & laws
  { key: 'standardsHeading', i18nKey: 'vpat.standardsEvaluatedHeading' },
  { key: 'standardsIntro', i18nKey: 'vpat.standardsEvaluatedIntro' },
  { key: 'standardsDisclaimer', i18nKey: 'vpat.standardsEvaluatedDisclaimer' },
  { key: 'standardReference', i18nKey: 'vpat.standardReference' },
  { key: 'standardEnforced', i18nKey: 'vpat.standardEnforced' },
  // WCAG tables
  { key: 'colCriteria', i18nKey: 'vpat.colCriteria' },
  { key: 'colConformance', i18nKey: 'vpat.colConformance' },
  { key: 'colRemarks', i18nKey: 'vpat.colRemarks' },
  // Section 508 FPC
  { key: 'fpcHeading', i18nKey: 'vpat.fpcHeading' },
  { key: 'fpcIntro', i18nKey: 'acr.fpcIntro' },
  { key: 'fpcColId', i18nKey: 'vpat.fpcColId' },
  { key: 'fpcColNeed', i18nKey: 'vpat.fpcColNeed' },
  // Remediation record
  { key: 'remediationHeading', i18nKey: 'vpat.remediationHeading' },
  { key: 'remediationIntro', i18nKey: 'vpat.remediationIntro' },
  { key: 'remediationCaveat', i18nKey: 'vpat.remActivityLegend' },
  { key: 'remediationDisclaimer', i18nKey: 'vpat.remediationDisclaimer' },
  { key: 'remLabelAiProposed', i18nKey: 'vpat.remAiProposed' },
  { key: 'remLabelDeveloperVerified', i18nKey: 'vpat.remDeveloperVerified' },
  { key: 'remLabelTotal', i18nKey: 'vpat.remTotal' },
  { key: 'remLabelScans', i18nKey: 'vpat.remScans' },
  { key: 'remColDate', i18nKey: 'vpat.remColDate' },
  { key: 'remColAction', i18nKey: 'vpat.remColAction' },
  { key: 'remColCriterion', i18nKey: 'vpat.remColCriterion' },
  { key: 'remColDetail', i18nKey: 'vpat.remColDetail' },
  { key: 'remColActor', i18nKey: 'acr.remColActor' },
  // Audit history (new section)
  { key: 'auditHeading', i18nKey: 'acr.auditHeading' },
  { key: 'auditIntro', i18nKey: 'acr.auditIntro' },
  { key: 'auditColCriterion', i18nKey: 'acr.auditColCriterion' },
  { key: 'auditColChange', i18nKey: 'acr.auditColChange' },
  { key: 'auditColReason', i18nKey: 'acr.auditColReason' },
  { key: 'auditColActor', i18nKey: 'acr.auditColActor' },
  { key: 'auditColDate', i18nKey: 'acr.auditColDate' },
  // Manual-test evidence
  { key: 'evidenceHeading', i18nKey: 'vpat.evidenceHeading' },
  { key: 'evidenceIntro', i18nKey: 'vpat.evidenceIntro' },
  { key: 'evidenceDownload', i18nKey: 'acr.evidenceDownload' },
  { key: 'downloadPack', i18nKey: 'vpat.downloadPack' },
  { key: 'downloadPdf', i18nKey: 'vpat.downloadPdf' },
  // Links / badge (populated by the report page in a later milestone)
  { key: 'viewLiveReport', i18nKey: 'acr.viewLiveReport' },
  { key: 'verifiedBadge', i18nKey: 'acr.verifiedBadge' },
  { key: 'viewDashboardReport', i18nKey: 'acr.viewDashboardReport' },
  // Wording-source indicator
  { key: 'wordingStandardLabel', i18nKey: 'acr.wordingStandardLabel' },
  { key: 'wordingCustomLabel', i18nKey: 'acr.wordingCustomLabel' },
  // Footer
  { key: 'footer', i18nKey: 'vpat.footer' },
];

/**
 * Resolve every ACR string for a locale: standard localized wording from the
 * i18n catalog, overlaid with any per-org overrides. Pure.
 *
 * @param opts.locale    Target locale.
 * @param opts.t         Translator (app i18n).
 * @param opts.overrides Per-org override rows (any locale; only the matching
 *                       locale is applied).
 */
export function resolveAcrStrings(opts: {
  readonly locale: string;
  readonly t: Translator;
  readonly overrides: readonly AcrWordingOverride[];
}): Record<string, ResolvedAcrString> {
  const { locale, t, overrides } = opts;
  const byKey = new Map<string, AcrWordingOverride>();
  for (const o of overrides) {
    if (o.locale === locale) byKey.set(o.key, o);
  }
  const standardReviewed = STANDARD_REVIEWED_LOCALES.has(locale);

  const out: Record<string, ResolvedAcrString> = {};
  for (const entry of ACR_WORDING_KEYS) {
    const override = byKey.get(entry.key);
    if (override) {
      out[entry.key] = {
        text: override.text,
        source: override.source,
        reviewed: override.reviewed,
        translatedBy: override.translatedBy ?? null,
        translatedAt: override.translatedAt ?? null,
        notes: override.notes ?? null,
      };
    } else {
      out[entry.key] = {
        text: t(entry.i18nKey, locale),
        source: 'standard',
        reviewed: standardReviewed,
      };
    }
  }
  return out;
}
