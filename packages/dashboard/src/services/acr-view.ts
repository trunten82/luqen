/**
 * Maps a built VpatReport onto the SHARED ACR template's view shape.
 *
 * The ACR template (shared/acr/acr.template.html) + acr.css are the single
 * source of truth rendered identically by the dashboard (here) and the
 * WordPress plugin. This module is the dashboard's adapter from its internal
 * VpatReport to that one view shape. The template carries NO prose: every
 * string comes from the localized, org-overridable wording catalog
 * (acr-wording.ts). Pure and side-effect-free — unit-tested.
 */

import type { VpatReport, VpatConformance } from './vpat-service.js';
import type { PdfScanMeta } from '../pdf/generator.js';
import {
  resolveAcrStrings,
  type AcrWordingOverride,
  type Translator,
} from './acr-wording.js';

/** A verdict-change audit row (the "proving actions" trail). */
export interface AcrAuditRow {
  readonly criterion: string;
  readonly change: string; // e.g. "untested → pass"
  readonly reason: string;
  readonly actor: string;
  readonly date: string;
}

/** External links surfaced in/around the report. Each optional. */
export interface AcrLinks {
  readonly packUrl?: string;
  readonly liveReportUrl?: string;
  readonly badgeUrl?: string;
  readonly dashboardReportUrl?: string;
}

/** The single view shape consumed by the shared ACR template. */
export interface AcrView {
  /** All localized prose, key → text (from the wording resolver). */
  readonly strings: Record<string, string>;
  /** Wording provenance summary for the report's indicator. */
  readonly wording: { anyCustom: boolean; anyUnreviewed: boolean };
  readonly meta: { siteUrl: string; standardLabel: string; generatedAt: string };
  readonly identity?: {
    entityName: string;
    logoUrl?: string;
    postalAddress?: string;
    contactEmail?: string;
  };
  readonly verdict: { line: string; meta: string };
  readonly tally: {
    supports: number;
    partial: number;
    doesNotSupport: number;
    notApplicable: number;
    notEvaluated: number;
    total: number;
  };
  readonly attestation: ReadonlyArray<{ label: string; value: string }>;
  readonly hasStandards: boolean;
  readonly standards: ReadonlyArray<{
    name: string;
    token: string;
    cite: string;
    description: string;
    url: string;
  }>;
  readonly tables: ReadonlyArray<{
    level: string;
    levelLabel: string;
    rows: ReadonlyArray<{
      criterion: string;
      title: string;
      conformance: string;
      conformanceClass: string;
      remarks: string;
    }>;
  }>;
  readonly fpc: {
    include: boolean;
    rows: ReadonlyArray<{
      id: string;
      need: string;
      conformance: string;
      conformanceClass: string;
      remarks: string;
    }>;
  };
  readonly remediation: {
    present: boolean;
    hasEvents: boolean;
    intro: string;
    stats: { aiProposed: number; developerVerified: number; total: number; completedScans: number };
    events: ReadonlyArray<{ date: string; action: string; criterion: string; detail: string; actor: string }>;
  };
  readonly hasAuditHistory: boolean;
  readonly auditHistory: ReadonlyArray<AcrAuditRow>;
  readonly hasEvidence: boolean;
  readonly evidence: ReadonlyArray<{
    criterion: string;
    title: string;
    items: ReadonlyArray<{ fileName: string; isImage: boolean; src: string; href: string }>;
  }>;
  readonly links: AcrLinks;
  readonly hasLinks: boolean;
}

/** Pre-resolved evidence (image files already turned into data URIs by the caller). */
export interface AcrEvidenceGroup {
  readonly criterion: string;
  readonly title: string;
  readonly items: ReadonlyArray<{ fileName: string; isImage: boolean; src: string; href?: string }>;
}

/** Conformance verdict → stable CSS class token (drives colour + a label, never colour alone). */
export function conformanceClass(conformance: VpatConformance | string): string {
  switch (conformance) {
    case 'Supports':
      return 'supports';
    case 'Partially Supports':
      return 'partial';
    case 'Does Not Support':
      return 'none';
    case 'Not Applicable':
      return 'na';
    default:
      return 'eval';
  }
}

/** Remediation event type → the localized action label key. */
function remediationActionKey(type: string): string {
  switch (type) {
    case 'ai-proposed':
      return 'remLabelAiProposed';
    case 'developer-verified':
      return 'remLabelDeveloperVerified';
    case 'manual-verified':
      return 'remManualVerified';
    default:
      return type;
  }
}

/** Hostname (or a safe label) for the verdict sentence. */
function siteLabel(siteUrl: string): string {
  try {
    return new URL(siteUrl).hostname;
  } catch {
    return siteUrl;
  }
}

export interface BuildAcrViewOptions {
  readonly locale: string;
  readonly t: Translator;
  readonly wordingOverrides?: readonly AcrWordingOverride[];
  readonly auditHistory?: readonly AcrAuditRow[];
  readonly links?: AcrLinks;
  readonly logoUrl?: string;
  readonly evidence?: ReadonlyArray<AcrEvidenceGroup>;
}

/**
 * Build the shared ACR view from the dashboard's VpatReport + scan meta, fully
 * localized via the injected translator and any per-org wording overrides.
 */
export function buildAcrView(
  vpat: VpatReport,
  scanMeta: PdfScanMeta,
  opts: BuildAcrViewOptions,
): AcrView {
  const { locale, t } = opts;
  const resolved = resolveAcrStrings({ locale, t, overrides: opts.wordingOverrides ?? [] });
  const strings: Record<string, string> = {};
  let anyCustom = false;
  let anyUnreviewed = false;
  for (const [k, v] of Object.entries(resolved)) {
    strings[k] = v.text;
    if (v.source === 'custom') anyCustom = true;
    if (!v.reviewed) anyUnreviewed = true;
  }

  const s = vpat.summary;
  const att = vpat.attestation;
  const pages = att.pagesEvaluated;
  const conforms = s.total > 0 && s.supports === s.total;

  const verdictLine = t(conforms ? 'acr.verdictConforms' : 'acr.verdictPartial', locale, {
    site: siteLabel(scanMeta.siteUrl),
    standard: scanMeta.standard,
    pages: String(pages),
  });
  const verdictMeta = t('acr.verdictMeta', locale, {
    date: vpat.generatedAt,
    supports: String(s.supports),
    total: String(s.total),
    doesNotSupport: String(s.doesNotSupport),
    notEvaluated: String(s.notEvaluated),
  });

  const attestation: Array<{ label: string; value: string }> = [
    { label: strings.attLabelEvaluationDate, value: att.evaluationDate },
    { label: strings.attLabelScope, value: `${pages} · ${scanMeta.siteUrl}` },
    { label: strings.attLabelStandards, value: att.standardsLabel },
    { label: strings.attLabelMethods, value: att.methods.join('; ') },
  ];
  if (att.evaluator) attestation.push({ label: strings.attLabelEvaluator, value: att.evaluator });
  if (att.reasonedChangeCount && att.reasonedChangeCount > 0) {
    attestation.push({ label: strings.attLabelReasonedChanges, value: String(att.reasonedChangeCount) });
  }

  const standards = vpat.evaluatedStandards.map((std) => ({
    name: std.name,
    token: std.token,
    cite: [
      std.reference ? `${strings.standardReference}: ${std.reference}` : null,
      std.enforcementDate ? `${strings.standardEnforced} ${std.enforcementDate}` : null,
    ]
      .filter((x): x is string => x !== null)
      .join(' · '),
    description: std.description ?? '',
    url: std.url ?? '',
  }));

  const tables = vpat.tablesByLevel.map((tb) => ({
    level: tb.level,
    levelLabel: t('vpat.levelTable', locale, { level: tb.level }),
    rows: tb.rows.map((r) => ({
      criterion: r.criterion,
      title: r.title,
      conformance: r.conformance,
      conformanceClass: conformanceClass(r.conformance),
      remarks: r.remarks,
    })),
  }));

  const fpcRows = vpat.section508.functionalPerformance.map((f) => ({
    id: f.id,
    need: f.need,
    conformance: f.conformance,
    conformanceClass: conformanceClass(f.conformance),
    remarks: f.remarks,
  }));

  const rem = vpat.remediation;
  const remPresent = rem !== null && !rem.isEmpty;
  const remEvents = remPresent
    ? rem!.events.map((e) => ({
        date: e.date,
        action: strings[remediationActionKey(e.type)] ?? e.type,
        criterion: e.criterion ?? '—',
        detail: e.detail ?? '',
        actor: e.actor ?? '—',
      }))
    : [];
  const remStats = {
    aiProposed: remPresent ? rem!.summary.aiProposed : 0,
    developerVerified: remPresent ? rem!.summary.developerVerified : 0,
    total: remPresent ? rem!.summary.total : 0,
    completedScans: remPresent ? rem!.scanTrend.length : 0,
  };

  const auditHistory = opts.auditHistory ?? [];

  const evidence = (opts.evidence ?? []).map((g) => ({
    criterion: g.criterion,
    title: g.title,
    items: g.items.map((it) => ({
      fileName: it.fileName,
      isImage: it.isImage,
      src: it.src,
      href: it.href ?? it.src,
    })),
  }));

  const links: AcrLinks = opts.links ?? {};
  const hasLinks = Boolean(
    links.packUrl || links.liveReportUrl || links.badgeUrl || links.dashboardReportUrl,
  );

  const view: AcrView = {
    strings,
    wording: { anyCustom, anyUnreviewed },
    meta: {
      siteUrl: scanMeta.siteUrl,
      standardLabel: scanMeta.standard,
      generatedAt: vpat.generatedAt,
    },
    ...(vpat.identity
      ? {
          identity: {
            entityName: vpat.identity.entityName,
            ...(opts.logoUrl ? { logoUrl: opts.logoUrl } : {}),
            ...(vpat.identity.postalAddress ? { postalAddress: vpat.identity.postalAddress } : {}),
            ...(vpat.identity.contactEmail ? { contactEmail: vpat.identity.contactEmail } : {}),
          },
        }
      : {}),
    verdict: { line: verdictLine, meta: verdictMeta },
    tally: {
      supports: s.supports,
      partial: s.partial,
      doesNotSupport: s.doesNotSupport,
      notApplicable: s.notApplicable,
      notEvaluated: s.notEvaluated,
      total: s.total,
    },
    attestation,
    hasStandards: standards.length > 0,
    standards,
    tables,
    fpc: { include: vpat.includeFunctionalPerformance, rows: fpcRows },
    remediation: {
      present: remPresent,
      hasEvents: remEvents.length > 0,
      intro: strings.remediationIntro,
      stats: remStats,
      events: remEvents,
    },
    hasAuditHistory: auditHistory.length > 0,
    auditHistory,
    hasEvidence: (opts.evidence?.length ?? 0) > 0,
    evidence,
    links,
    hasLinks,
  };
  return view;
}
