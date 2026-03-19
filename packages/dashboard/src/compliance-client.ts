export interface Jurisdiction {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly parentId?: string;
}

export interface Regulation {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly jurisdictionId: string;
  readonly enforcementDate: string;
  readonly status: string;
  readonly scope: string;
}

export interface ComplianceCheckResult {
  readonly summary: {
    readonly totalJurisdictions: number;
    readonly passing: number;
    readonly failing: number;
    readonly totalMandatoryViolations: number;
    readonly totalConfirmedViolations?: number;
  };
  readonly matrix: Record<string, unknown>;
}

export interface UpdateProposal {
  readonly id: string;
  readonly status: string;
  readonly source: string;
  readonly type: string;
  readonly summary: string;
  readonly detectedAt: string;
}

export interface SeedStatus {
  readonly seeded: boolean;
  readonly jurisdictions: number;
  readonly regulations: number;
  readonly requirements: number;
}

export interface TokenResponse {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in: number;
  readonly refresh_token?: string;
}

async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${body}`);
  }

  return response.json() as Promise<T>;
}

export async function getToken(
  baseUrl: string,
  username: string,
  password: string,
  clientId = 'dashboard',
  clientSecret = '',
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'password',
    username,
    password,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(`${baseUrl}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Authentication failed: ${body}`);
  }

  return response.json() as Promise<TokenResponse>;
}

export async function listJurisdictions(
  baseUrl: string,
  token: string,
): Promise<Jurisdiction[]> {
  return apiFetch<Jurisdiction[]>(`${baseUrl}/api/v1/jurisdictions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function listRegulations(
  baseUrl: string,
  token: string,
  filters?: Record<string, string>,
): Promise<Regulation[]> {
  const params = filters !== undefined ? `?${new URLSearchParams(filters).toString()}` : '';
  return apiFetch<Regulation[]>(`${baseUrl}/api/v1/regulations${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface ComplianceIssueInput {
  readonly code: string;
  readonly type: string;
  readonly message: string;
  readonly selector: string;
  readonly context: string;
}

export async function checkCompliance(
  baseUrl: string,
  token: string,
  jurisdictions: readonly string[],
  issues: readonly ComplianceIssueInput[],
): Promise<ComplianceCheckResult> {
  return apiFetch<ComplianceCheckResult>(`${baseUrl}/api/v1/compliance/check`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jurisdictions, issues }),
  });
}

export async function getSeedStatus(
  baseUrl: string,
  token: string,
): Promise<SeedStatus> {
  return apiFetch<SeedStatus>(`${baseUrl}/api/v1/seed/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function listUpdateProposals(
  baseUrl: string,
  token: string,
  status?: string,
): Promise<UpdateProposal[]> {
  const params = status !== undefined ? `?status=${encodeURIComponent(status)}` : '';
  return apiFetch<UpdateProposal[]>(`${baseUrl}/api/v1/updates${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function approveProposal(
  baseUrl: string,
  token: string,
  id: string,
): Promise<UpdateProposal> {
  return apiFetch<UpdateProposal>(`${baseUrl}/api/v1/updates/${encodeURIComponent(id)}/approve`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function rejectProposal(
  baseUrl: string,
  token: string,
  id: string,
): Promise<UpdateProposal> {
  return apiFetch<UpdateProposal>(`${baseUrl}/api/v1/updates/${encodeURIComponent(id)}/reject`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  });
}
