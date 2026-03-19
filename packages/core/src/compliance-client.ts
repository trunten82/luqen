// HTTP client for the pally-agent compliance service.
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

interface IssueAnnotationEntry {
  issueCode: string;
  annotations: Array<{
    regulationName: string;
    shortName: string;
    jurisdictionId: string;
    obligation: 'mandatory' | 'recommended' | 'optional';
  }>;
}

interface ComplianceCheckResponse {
  jurisdictions: JurisdictionResult[];
  issueAnnotations: IssueAnnotationEntry[];
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
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(`${complianceUrl}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
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

  return fetchComplianceCheck(complianceUrl, jurisdictions, issues, token);
}

function mapToEnrichment(data: ComplianceCheckResponse): ComplianceEnrichment {
  // Build the jurisdiction matrix
  const matrix: Record<string, JurisdictionComplianceResult> = {};
  for (const j of data.jurisdictions) {
    matrix[j.jurisdictionId] = {
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

  // Build the issue annotations map
  const issueAnnotations = new Map<string, readonly RegulationAnnotation[]>();
  for (const entry of data.issueAnnotations) {
    const annotations: RegulationAnnotation[] = entry.annotations.map((a) => ({
      regulationName: a.regulationName,
      shortName: a.shortName,
      jurisdictionId: a.jurisdictionId,
      obligation: a.obligation,
    }));
    issueAnnotations.set(entry.issueCode, annotations);
  }

  // Compute summary
  const jurisdictionValues = Object.values(matrix);
  const passing = jurisdictionValues.filter((j) => j.status === 'pass').length;
  const failing = jurisdictionValues.filter((j) => j.status === 'fail').length;
  const totalMandatoryViolations = jurisdictionValues.reduce(
    (sum, j) => sum + j.mandatoryViolations,
    0,
  );

  const summary: ComplianceSummary = {
    totalJurisdictions: jurisdictionValues.length,
    passing,
    failing,
    totalMandatoryViolations,
  };

  return { matrix, issueAnnotations, summary };
}
