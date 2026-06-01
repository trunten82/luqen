/**
 * Per-org report (VPAT/ACR) legal identity.
 *
 * One row per organization (org_id primary key). Supplies the legal entity
 * attribution rendered on the VPAT/ACR — entity name, a barrier-report contact,
 * an optional postal address, and an optional evaluator/preparer org name.
 * Mirrors the AccessibilityStatementRepository per-org-config pattern.
 *
 * The report LOGO is NOT stored here — it is reused from the org's branding
 * guideline image (BrandingRepository.getGuidelineForSite). This record holds
 * only the legal TEXT fields.
 *
 * Attribution only: nothing here is a conformance/certification claim
 * (US-lawsuit-protection direction — never over-claim).
 */

export interface ReportIdentityRecord {
  readonly orgId: string;
  /** Public-facing legal entity name shown in the report title/header. */
  readonly entityName?: string;
  /** Barrier-report / contact channel for the document. */
  readonly contactEmail?: string;
  /** Optional postal address of the legal entity. */
  readonly postalAddress?: string;
  /** Optional org that prepared/evaluated the report (the attestation evaluator). */
  readonly preparedBy?: string;
  readonly updatedAt: string;
  readonly updatedBy?: string;
}

/** Fields an org admin can write. */
export interface ReportIdentityInput {
  readonly entityName?: string;
  readonly contactEmail?: string;
  readonly postalAddress?: string;
  readonly preparedBy?: string;
}

export interface ReportIdentityRepository {
  /** Returns the org's report identity, or null if never configured. */
  get(orgId: string): Promise<ReportIdentityRecord | null>;

  /** Create or update the org's report identity. */
  upsert(
    orgId: string,
    data: ReportIdentityInput,
    updatedBy?: string,
  ): Promise<ReportIdentityRecord>;
}
