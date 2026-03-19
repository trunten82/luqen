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

// ── Jurisdiction CRUD ─────────────────────────────────────────────────────────

export interface CreateJurisdictionInput {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly parentId?: string;
}

export async function createJurisdiction(
  baseUrl: string,
  token: string,
  data: CreateJurisdictionInput,
): Promise<Jurisdiction> {
  return apiFetch<Jurisdiction>(`${baseUrl}/api/v1/jurisdictions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function updateJurisdiction(
  baseUrl: string,
  token: string,
  id: string,
  data: Partial<CreateJurisdictionInput>,
): Promise<Jurisdiction> {
  return apiFetch<Jurisdiction>(`${baseUrl}/api/v1/jurisdictions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function deleteJurisdiction(
  baseUrl: string,
  token: string,
  id: string,
): Promise<void> {
  const response = await fetch(
    `${baseUrl}/api/v1/jurisdictions/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${body}`);
  }
}

// ── Regulation CRUD ───────────────────────────────────────────────────────────

export interface CreateRegulationInput {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly jurisdictionId: string;
  readonly enforcementDate: string;
  readonly status: string;
  readonly scope: string;
}

export async function createRegulation(
  baseUrl: string,
  token: string,
  data: CreateRegulationInput,
): Promise<Regulation> {
  return apiFetch<Regulation>(`${baseUrl}/api/v1/regulations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function updateRegulation(
  baseUrl: string,
  token: string,
  id: string,
  data: Partial<CreateRegulationInput>,
): Promise<Regulation> {
  return apiFetch<Regulation>(`${baseUrl}/api/v1/regulations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function deleteRegulation(
  baseUrl: string,
  token: string,
  id: string,
): Promise<void> {
  const response = await fetch(
    `${baseUrl}/api/v1/regulations/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${body}`);
  }
}

// ── Monitored Sources ─────────────────────────────────────────────────────────

export interface MonitoredSource {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly type: string;
  readonly schedule: string;
  readonly lastChecked?: string;
}

export interface CreateSourceInput {
  readonly name: string;
  readonly url: string;
  readonly type: string;
  readonly schedule: string;
}

export async function listSources(
  baseUrl: string,
  token: string,
): Promise<MonitoredSource[]> {
  return apiFetch<MonitoredSource[]>(`${baseUrl}/api/v1/sources`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createSource(
  baseUrl: string,
  token: string,
  data: CreateSourceInput,
): Promise<MonitoredSource> {
  return apiFetch<MonitoredSource>(`${baseUrl}/api/v1/sources`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function deleteSource(
  baseUrl: string,
  token: string,
  id: string,
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1/sources/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${body}`);
  }
}

export async function scanSources(
  baseUrl: string,
  token: string,
): Promise<{ scanned: number; proposalsCreated: number }> {
  return apiFetch<{ scanned: number; proposalsCreated: number }>(
    `${baseUrl}/api/v1/sources/scan`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

// ── Webhooks ──────────────────────────────────────────────────────────────────

export interface Webhook {
  readonly id: string;
  readonly url: string;
  readonly events: string[];
  readonly active: boolean;
  readonly createdAt: string;
}

export interface CreateWebhookInput {
  readonly url: string;
  readonly events: string[];
  readonly secret?: string;
}

export async function listWebhooks(
  baseUrl: string,
  token: string,
): Promise<Webhook[]> {
  return apiFetch<Webhook[]>(`${baseUrl}/api/v1/webhooks`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createWebhook(
  baseUrl: string,
  token: string,
  data: CreateWebhookInput,
): Promise<Webhook> {
  return apiFetch<Webhook>(`${baseUrl}/api/v1/webhooks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function deleteWebhook(
  baseUrl: string,
  token: string,
  id: string,
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1/webhooks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${body}`);
  }
}

export async function testWebhook(
  baseUrl: string,
  token: string,
  id: string,
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1/webhooks/${encodeURIComponent(id)}/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${body}`);
  }
}

// ── Users ─────────────────────────────────────────────────────────────────────

export interface User {
  readonly id: string;
  readonly username: string;
  readonly role: string;
  readonly active: boolean;
  readonly createdAt: string;
}

export interface CreateUserInput {
  readonly username: string;
  readonly password: string;
  readonly role: 'viewer' | 'user' | 'admin';
}

export async function listUsers(
  baseUrl: string,
  token: string,
): Promise<User[]> {
  return apiFetch<User[]>(`${baseUrl}/api/v1/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createUser(
  baseUrl: string,
  token: string,
  data: CreateUserInput,
): Promise<User> {
  return apiFetch<User>(`${baseUrl}/api/v1/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function deactivateUser(
  baseUrl: string,
  token: string,
  id: string,
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1/users/${encodeURIComponent(id)}/deactivate`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${body}`);
  }
}

// ── OAuth Clients ─────────────────────────────────────────────────────────────

export interface OAuthClient {
  readonly clientId: string;
  readonly name: string;
  readonly scopes: string[];
  readonly grantTypes: string[];
  readonly createdAt: string;
}

export interface CreateClientInput {
  readonly name: string;
  readonly scopes: string[];
  readonly grantTypes: string[];
}

export async function listClients(
  baseUrl: string,
  token: string,
): Promise<OAuthClient[]> {
  return apiFetch<OAuthClient[]>(`${baseUrl}/api/v1/clients`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createClient(
  baseUrl: string,
  token: string,
  data: CreateClientInput,
): Promise<OAuthClient & { secret: string }> {
  return apiFetch<OAuthClient & { secret: string }>(`${baseUrl}/api/v1/clients`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
}

export async function revokeClient(
  baseUrl: string,
  token: string,
  id: string,
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1/clients/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${body}`);
  }
}

// ── System Health ─────────────────────────────────────────────────────────────

export interface SystemHealth {
  readonly compliance: { status: string };
  readonly pa11y?: { status: string };
}

export async function getSystemHealth(
  complianceUrl: string,
  webserviceUrl?: string,
): Promise<SystemHealth> {
  const requests: Array<Promise<{ status: string }>> = [
    fetch(`${complianceUrl}/health`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch(() => ({ status: 'error' })) as Promise<{ status: string }>,
  ];

  if (webserviceUrl !== undefined && webserviceUrl !== '') {
    requests.push(
      fetch(`${webserviceUrl}/health`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .catch(() => ({ status: 'error' })) as Promise<{ status: string }>,
    );
  }

  const [compliance, pa11y] = await Promise.all(requests);

  return {
    compliance: compliance ?? { status: 'error' },
    pa11y,
  };
}
