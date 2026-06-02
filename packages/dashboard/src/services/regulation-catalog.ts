/**
 * Regulation catalog resolver.
 *
 * The VPAT / ACR renders a programmatic per-regulation "context note" for EVERY
 * selected regulation, sourced from the compliance service's regulation records
 * (the single source of truth: name, citation/reference, description, enforcement
 * date, url). Rather than thread a ComplianceService through every render path
 * (the web view, the PDF export, the token-share, the public ACR, the
 * accessibility statement, fleet bundles), we initialise this module ONCE at
 * server startup with the shared ComplianceService and expose a cached, graceful
 * resolver every render path can call with no signature plumbing.
 *
 * Graceful by construction: before init, on a compliance outage, or for an
 * unknown id, the resolver simply omits that record — callers fall back to the
 * built-in name catalog (legal-framings) so the report is never blocked.
 */

import type { ComplianceService } from './compliance-service.js';

/** Per-regulation facts used to compose the programmatic ACR context note. */
export interface RegulationDetail {
  readonly id: string;
  readonly name: string;
  readonly shortName?: string;
  readonly reference?: string;
  readonly description?: string;
  readonly enforcementDate?: string;
  readonly url?: string;
}

let service: ComplianceService | null = null;

/** Wire the shared ComplianceService once (called from server bootstrap). */
export function initRegulationCatalog(svc: ComplianceService): void {
  service = svc;
}

/** Test/teardown helper — reset the module-level service. */
export function resetRegulationCatalog(): void {
  service = null;
}

/**
 * Resolve `id → RegulationDetail` for the given regulation ids. Org-aware
 * (custom per-org regulations resolve when an orgId is supplied). Returns an
 * empty map before init or on any failure — never throws, so a compliance
 * outage degrades the report gracefully instead of breaking it.
 */
export async function resolveRegulationDetails(
  regulationIds: readonly string[],
  orgId?: string,
): Promise<Map<string, RegulationDetail>> {
  const out = new Map<string, RegulationDetail>();
  if (service === null || regulationIds.length === 0) return out;
  try {
    const token = await service.getToken();
    const wanted = new Set(regulationIds);
    const all = await service.safeListRegulations(token, undefined, orgId);
    for (const r of all) {
      if (!wanted.has(r.id)) continue;
      out.set(r.id, {
        id: r.id,
        name: r.name,
        shortName: r.shortName,
        ...(r.reference ? { reference: r.reference } : {}),
        ...(r.description ? { description: r.description } : {}),
        ...(r.enforcementDate ? { enforcementDate: r.enforcementDate } : {}),
        ...(r.url ? { url: r.url } : {}),
      });
    }
  } catch {
    // graceful: empty map → callers fall back to the built-in name catalog.
  }
  return out;
}
