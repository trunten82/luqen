/**
 * Maps a built VpatReport onto the SHARED ACR template's view shape.
 *
 * The ACR template (shared/acr/acr.template.html) + acr.css are the single
 * source of truth rendered identically by the dashboard (here) and the
 * WordPress plugin. This module is the dashboard's adapter from its internal
 * VpatReport to that one view shape. Pure and side-effect-free — unit-tested.
 */

import type { VpatReport, VpatConformance } from './vpat-service.js';
import type { PdfScanMeta } from '../pdf/generator.js';

/** The single view shape consumed by the shared ACR template. */
export interface AcrView {
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
    events: ReadonlyArray<{ date: string; action: string; criterion: string; detail: string }>;
  };
  readonly hasEvidence: boolean;
  readonly evidence: ReadonlyArray<{
    criterion: string;
    title: string;
    items: ReadonlyArray<{ fileName: string; isImage: boolean; src: string }>;
  }>;
}

/** Pre-resolved evidence (image files already turned into data URIs by the caller). */
export interface AcrEvidenceGroup {
  readonly criterion: string;
  readonly title: string;
  readonly items: ReadonlyArray<{ fileName: string; isImage: boolean; src: string }>;
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

function remediationActionLabel(type: string): string {
  switch (type) {
    case 'ai-proposed':
      return 'AI-proposed (draft)';
    case 'developer-verified':
      return 'Developer-verified';
    case 'manual-verified':
      return 'Manually verified';
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

/**
 * Build the shared ACR view from the dashboard's VpatReport + scan meta.
 *
 * @param vpat     The fully built VPAT report.
 * @param scanMeta Scan metadata (site, standard label).
 * @param opts     Optional resolved logo URL/data-URI for the identity block.
 */
export function buildAcrView(
  vpat: VpatReport,
  scanMeta: PdfScanMeta,
  opts: { readonly logoUrl?: string; readonly evidence?: ReadonlyArray<AcrEvidenceGroup> } = {},
): AcrView {
  const s = vpat.summary;
  const att = vpat.attestation;
  const pages = att.pagesEvaluated;
  const conforms = s.total > 0 && s.supports === s.total;
  const posture = conforms ? 'conforms to' : 'partially conforms to';

  const verdictLine =
    `${siteLabel(scanMeta.siteUrl)} ${posture} ${scanMeta.standard} across `
    + `${pages} page${pages === 1 ? '' : 's'}.`;
  const verdictMeta =
    `Evaluated ${vpat.generatedAt} · ${s.supports} of ${s.total} criteria supported · `
    + `${s.doesNotSupport} not supported · ${s.notEvaluated} pending manual evaluation`;

  const attestation: Array<{ label: string; value: string }> = [
    { label: 'Evaluation date', value: att.evaluationDate },
    { label: 'Scope', value: `${pages} page${pages === 1 ? '' : 's'} of ${scanMeta.siteUrl}` },
    { label: 'Standards assessed', value: att.standardsLabel },
    { label: 'Methods', value: att.methods.join('; ') },
  ];
  if (att.evaluator) attestation.push({ label: 'Evaluator', value: att.evaluator });
  if (att.reasonedChangeCount && att.reasonedChangeCount > 0) {
    attestation.push({
      label: 'Documented verdict changes',
      value: String(att.reasonedChangeCount),
    });
  }

  const standards = vpat.evaluatedStandards.map((std) => ({
    name: std.name,
    token: std.token,
    cite: [
      std.reference ? `Reference: ${std.reference}` : null,
      std.enforcementDate ? `in force since ${std.enforcementDate}` : null,
    ]
      .filter((x): x is string => x !== null)
      .join(' · '),
    description: std.description ?? '',
    url: std.url ?? '',
  }));

  const tables = vpat.tablesByLevel.map((t) => ({
    level: t.level,
    rows: t.rows.map((r) => ({
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
  const remIntro = remPresent
    ? `A dated, good-faith record of remediation activity for this site: `
      + `${rem!.summary.aiProposed} AI-proposed draft fix(es), `
      + `${rem!.summary.developerVerified} developer-verified, across `
      + `${rem!.scanTrend.length} completed scan(s)`
      + `${rem!.summary.firstActivity ? ` since ${rem!.summary.firstActivity}` : ''}. `
      + `Luqen's AI only drafts candidate fixes; a human reviews and accepts each one before it takes effect.`
    : '';
  const remEvents = remPresent
    ? rem!.events.map((e) => ({
        date: e.date,
        action: remediationActionLabel(e.type),
        criterion: e.criterion ?? '—',
        detail: e.detail ?? '',
      }))
    : [];

  const view: AcrView = {
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
    remediation: { present: remPresent, hasEvents: remEvents.length > 0, intro: remIntro, events: remEvents },
    hasEvidence: (opts.evidence?.length ?? 0) > 0,
    evidence: opts.evidence ?? [],
  };
  return view;
}
