import type { ReportIdentityRecord } from '../db/interfaces/report-identity-repository.js';

/**
 * Resolved legal/company identity block for a VPAT/ACR. Pure data, rendered
 * identically across the web VPAT view, the PDF ACR, and the anonymous
 * token-share view. Attribution only — never a conformance/certification claim.
 */
export interface VpatIdentity {
  /** Legal entity name (the only required field for a non-null identity). */
  readonly entityName: string;
  readonly contactEmail?: string;
  readonly postalAddress?: string;
  /** Org that prepared/evaluated the report (feeds the attestation evaluator). */
  readonly preparedBy?: string;
  /** Public `/uploads/...` path of the org's branding logo, when present. */
  readonly logoPath?: string;
}

/** Trim then return undefined for blank strings, so optional fields stay omitted. */
function clean(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Merge a stored per-org report-identity record + a resolved branding logo path
 * into a render-ready {@link VpatIdentity}. Pure (no fs / db / Fastify).
 *
 * Returns null when no record is set OR its entity name is blank — in that case
 * the report renders exactly as it does today (generic title, no company block,
 * no evaluator row). The logo is included only when a truthy path is supplied.
 */
export function resolveReportIdentity(
  record: ReportIdentityRecord | null | undefined,
  logoPath?: string | null,
): VpatIdentity | null {
  if (record === null || record === undefined) return null;
  const entityName = clean(record.entityName);
  if (entityName === undefined) return null;

  const contactEmail = clean(record.contactEmail);
  const postalAddress = clean(record.postalAddress);
  const preparedBy = clean(record.preparedBy);
  const logo = clean(logoPath);

  return {
    entityName,
    ...(contactEmail !== undefined ? { contactEmail } : {}),
    ...(postalAddress !== undefined ? { postalAddress } : {}),
    ...(preparedBy !== undefined ? { preparedBy } : {}),
    ...(logo !== undefined ? { logoPath: logo } : {}),
  };
}
