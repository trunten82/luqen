// HTTP client for the luqen compliance service.
// Enrichment is optional — if the service is unreachable, null is returned
// so callers can degrade gracefully.

import type {
  ComplianceEnrichment,
  JurisdictionComplianceResult,
  RegulationAnnotation,
  ComplianceSummary,
} from './types.js';

export interface ComplianceIssueInput {
  readonly code: string;
  readonly type: string;
  readonly message: string;
  readonly selector: string;
  readonly context: string;
}

interface TokenResponse {
  access_token: string;
}

interface RegulationResult {
  regulationId: string;
  regulationName: string;
  shortName: string;
  status: 'pass' | 'fail';
  enforcementDate: string;
  violationCount: number;
}

interface JurisdictionResult {
  jurisdictionId: string;
  jurisdictionName: string;
  status: 'pass' | 'fail';
  mandatoryViolations: number;
  recommendedViolations: number;
  regulations: RegulationResult[];
}

interface AnnotatedIssueEntry {
  code: string;
  wcagCriterion: string;
  wcagLevel: string;
  regulations: Array<{
    regulationId: string;
    regulationName: string;
    shortName: string;
    jurisdictionId: string;
    obligation: 'mandatory' | 'recommended' | 'optional';
    enforcementDate: string;
  }>;
}

interface ComplianceCheckResponse {
  matrix: Record<string, JurisdictionResult>;
  annotatedIssues: AnnotatedIssueEntry[];
  summary: {
    totalJurisdictions: number;
    passing: number;
    failing: number;
    totalMandatoryViolations: number;
    totalOptionalViolations: number;
  };
}

/**
 * Obtain a Bearer token from the compliance service using OAuth 2.0 client
 * credentials. Returns undefined if credentials are not provided.
 */
async function fetchToken(
  complianceUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<string | undefined> {
  const response = await fetch(`${complianceUrl}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    throw new Error(`OAuth token request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as TokenResponse;
  return data.access_token;
}

/**
 * Call the compliance service to check a set of accessibility issues against
 * the specified jurisdictions. Returns a ComplianceEnrichment object on
 * success, or null if the service is unreachable or returns an error.
 */
export async function fetchComplianceCheck(
  complianceUrl: string,
  jurisdictions: string[],
  issues: ComplianceIssueInput[],
  token?: string,
): Promise<ComplianceEnrichment | null> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${complianceUrl}/api/v1/compliance/check`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jurisdictions, issues }),
    });

    if (!response.ok) {
      console.warn(
        `Compliance service returned ${response.status}; skipping compliance enrichment.`,
      );
      return null;
    }

    const data = (await response.json()) as ComplianceCheckResponse;
    return mapToEnrichment(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Compliance service unreachable (${message}); skipping compliance enrichment.`);
    return null;
  }
}

/**
 * Fetch a token (when client credentials are present) and then call the
 * compliance check endpoint. Returns null if the service is unavailable.
 */
export async function fetchComplianceEnrichment(
  complianceUrl: string,
  jurisdictions: string[],
  issues: ComplianceIssueInput[],
  clientId?: string,
  clientSecret?: string,
): Promise<ComplianceEnrichment | null> {
  let token: string | undefined;

  if (clientId && clientSecret) {
    try {
      token = await fetchToken(complianceUrl, clientId, clientSecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Failed to obtain compliance service token (${message}); proceeding without auth.`);
    }
  }

  // Deduplicate issues by code — the compliance check only needs unique codes
  // to map to regulations, not every individual instance
  const seen = new Set<string>();
  const deduped: ComplianceIssueInput[] = [];
  for (const issue of issues) {
    if (!seen.has(issue.code)) {
      seen.add(issue.code);
      deduped.push(issue);
    }
  }

  return fetchComplianceCheck(complianceUrl, jurisdictions, deduped, token);
}

function mapToEnrichment(data: ComplianceCheckResponse): ComplianceEnrichment {
  // Matrix comes pre-built from the API
  const matrix: Record<string, JurisdictionComplianceResult> = {};
  for (const [jid, j] of Object.entries(data.matrix)) {
    matrix[jid] = {
      jurisdictionId: j.jurisdictionId,
      jurisdictionName: j.jurisdictionName,
      status: j.status,
      mandatoryViolations: j.mandatoryViolations,
      recommendedViolations: j.recommendedViolations,
      regulations: j.regulations.map((r) => ({
        regulationId: r.regulationId,
        regulationName: r.regulationName,
        shortName: r.shortName,
        status: r.status,
        enforcementDate: r.enforcementDate,
        violationCount: r.violationCount,
      })),
    };
  }

  // Build the issue annotations map from annotatedIssues
  const issueAnnotations = new Map<string, readonly RegulationAnnotation[]>();
  for (const entry of data.annotatedIssues) {
    const annotations: RegulationAnnotation[] = entry.regulations.map((r) => ({
      regulationName: r.regulationName,
      shortName: r.shortName,
      jurisdictionId: r.jurisdictionId,
      obligation: r.obligation,
    }));
    issueAnnotations.set(entry.code, annotations);
  }

  // Use summary directly from API
  const summary: ComplianceSummary = {
    totalJurisdictions: data.summary.totalJurisdictions,
    passing: data.summary.passing,
    failing: data.summary.failing,
    totalMandatoryViolations: data.summary.totalMandatoryViolations,
  };

  return { matrix, issueAnnotations, summary };
}
