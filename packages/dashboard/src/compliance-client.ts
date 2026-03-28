export interface Jurisdiction {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly parentId?: string;
  readonly iso3166?: string;
  readonly orgId?: string;
}

export interface Regulation {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly jurisdictionId: string;
  readonly enforcementDate: string;
  readonly status: string;
  readonly scope: string;
  readonly url?: string;
  readonly reference?: string;
  readonly description?: string;
  readonly sectors?: string[];
  readonly orgId?: string;
}

export interface Requirement {
  readonly id: string;
  readonly regulationId: string;
  readonly wcagVersion: string;
  readonly wcagLevel: string;
  readonly wcagCriterion: string;
  readonly obligation: string;
  readonly notes?: string;
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
  readonly orgId?: string;
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
  orgId?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (orgId != null && orgId !== 'system') {
    headers['X-Org-Id'] = orgId;
  }
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${body}`);
  }

  return response.json() as Promise<T>;
}

/** Unwrap a paginated envelope { data: T[], total, limit, offset } or a plain array. */
function unwrapList<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result != null && typeof result === 'object' && 'data' in result) {
    return (result as { data: T[] }).data;
  }
  return [];
}

export async function getToken(
  baseUrl: string,
  username: string,
  password: string,
  clientId = 'dashboard',
  clientSecret = '',
): Promise<TokenResponse> {
  const response = await fetch(`${baseUrl}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'password',
      username,
      password,
      client_id: clientId,
      client_secret: clientSecret,
    }),
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
  orgId?: string,
): Promise<Jurisdiction[]> {
  const result = await apiFetch<unknown>(`${baseUrl}/api/v1/jurisdictions?limit=500`, {
    headers: { Authorization: `Bearer ${token}` },
  }, orgId);
  return unwrapList<Jurisdiction>(result);
}

export async function listRegulations(
  baseUrl: string,
  token: string,
  filters?: Record<string, string>,
  orgId?: string,
): Promise<Regulation[]> {
  const params = filters !== undefined ? `?${new URLSearchParams(filters).toString()}` : '';
  const sep = params ? '&' : '?';
  const result = await apiFetch<unknown>(`${baseUrl}/api/v1/regulations${params}${sep}limit=500`, {
    headers: { Authorization: `Bearer ${token}` },
  }, orgId);
  return unwrapList<Regulation>(result);
}

export async function listRequirements(
  baseUrl: string,
  token: string,
  filters?: Record<string, string>,
  orgId?: string,
): Promise<Requirement[]> {
  const params = filters !== undefined ? `?${new URLSearchParams(filters).toString()}` : '';
  const sep = params ? '&' : '?';
  const result = await apiFetch<unknown>(`${baseUrl}/api/v1/requirements${params}${sep}limit=500`, {
    headers: { Authorization: `Bearer ${token}` },
  }, orgId);
  return unwrapList<Requirement>(result);
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
  orgId?: string,
): Promise<ComplianceCheckResult> {
  return apiFetch<ComplianceCheckResult>(`${baseUrl}/api/v1/compliance/check`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jurisdictions, issues }),
  }, orgId);
}

export async function getSeedStatus(
  baseUrl: string,
  token: string,
  orgId?: string,
): Promise<SeedStatus> {
  return apiFetch<SeedStatus>(`${baseUrl}/api/v1/seed/status`, {
    headers: { Authorization: `Bearer ${token}` },
  }, orgId);
}

export async function listUpdateProposals(
  baseUrl: string,
  token: string,
  status?: string,
  orgId?: string,
): Promise<UpdateProposal[]> {
  const params = status !== undefined ? `?status=${encodeURIComponent(status)}` : '';
  const result = await apiFetch<unknown>(`${baseUrl}/api/v1/updates${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  }, orgId);
  return unwrapList<UpdateProposal>(result);
}

export async function approveProposal(
  baseUrl: string,
  token: string,
  id: string,
  orgId?: string,
): Promise<UpdateProposal> {
  return apiFetch<UpdateProposal>(`${baseUrl}/api/v1/updates/${encodeURIComponent(id)}/approve`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  }, orgId);
}

export async function rejectProposal(
  baseUrl: string,
  token: string,
  id: string,
  orgId?: string,
): Promise<UpdateProposal> {
  return apiFetch<UpdateProposal>(`${baseUrl}/api/v1/updates/${encodeURIComponent(id)}/reject`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  }, orgId);
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
  orgId?: string,
): Promise<Jurisdiction> {
  return apiFetch<Jurisdiction>(`${baseUrl}/api/v1/jurisdictions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  }, orgId);
}

export async function updateJurisdiction(
  baseUrl: string,
  token: string,
  id: string,
  data: Partial<CreateJurisdictionInput>,
  orgId?: string,
): Promise<Jurisdiction> {
  return apiFetch<Jurisdiction>(`${baseUrl}/api/v1/jurisdictions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  }, orgId);
}

export async function deleteJurisdiction(
  baseUrl: string,
  token: string,
  id: string,
  orgId?: string,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (orgId != null && orgId !== 'system') {
    headers['X-Org-Id'] = orgId;
  }
  const response = await fetch(
    `${baseUrl}/api/v1/jurisdictions/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers,
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
  orgId?: string,
): Promise<Regulation> {
  return apiFetch<Regulation>(`${baseUrl}/api/v1/regulations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  }, orgId);
}

export async function updateRegulation(
  baseUrl: string,
  token: string,
  id: string,
  data: Partial<CreateRegulationInput>,
  orgId?: string,
): Promise<Regulation> {
  return apiFetch<Regulation>(`${baseUrl}/api/v1/regulations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  }, orgId);
}

export async function deleteRegulation(
  baseUrl: string,
  token: string,
  id: string,
  orgId?: string,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (orgId != null && orgId !== 'system') {
    headers['X-Org-Id'] = orgId;
  }
  const response = await fetch(
    `${baseUrl}/api/v1/regulations/${encodeURIComponent(id)}`,
    { method: 'DELETE', headers },
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
  readonly orgId?: string;
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
  orgId?: string,
): Promise<MonitoredSource[]> {
  const result = await apiFetch<unknown>(`${baseUrl}/api/v1/sources`, {
    headers: { Authorization: `Bearer ${token}` },
  }, orgId);
  return unwrapList<MonitoredSource>(result);
}

export async function createSource(
  baseUrl: string,
  token: string,
  data: CreateSourceInput,
  orgId?: string,
): Promise<MonitoredSource> {
  return apiFetch<MonitoredSource>(`${baseUrl}/api/v1/sources`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  }, orgId);
}

export async function deleteSource(
  baseUrl: string,
  token: string,
  id: string,
  orgId?: string,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (orgId != null && orgId !== 'system') {
    headers['X-Org-Id'] = orgId;
  }
  const response = await fetch(`${baseUrl}/api/v1/sources/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers,
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
  orgId?: string,
): Promise<Webhook[]> {
  const result = await apiFetch<unknown>(`${baseUrl}/api/v1/webhooks`, {
    headers: { Authorization: `Bearer ${token}` },
  }, orgId);
  return unwrapList<Webhook>(result);
}

export async function createWebhook(
  baseUrl: string,
  token: string,
  data: CreateWebhookInput,
  orgId?: string,
): Promise<Webhook> {
  return apiFetch<Webhook>(`${baseUrl}/api/v1/webhooks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  }, orgId);
}

export async function deleteWebhook(
  baseUrl: string,
  token: string,
  id: string,
  orgId?: string,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (orgId != null && orgId !== 'system') {
    headers['X-Org-Id'] = orgId;
  }
  const response = await fetch(`${baseUrl}/api/v1/webhooks/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers,
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

/**
 * Dispatch a webhook event via the compliance API.
 * Fire-and-forget: errors are silently swallowed.
 */
export async function dispatchWebhookEvent(
  baseUrl: string,
  token: string,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(`${baseUrl}/api/v1/webhooks/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ event, data }),
    });
  } catch {
    // Fire-and-forget — webhook dispatch failure should not block scans
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
  orgId?: string,
): Promise<User[]> {
  const result = await apiFetch<unknown>(`${baseUrl}/api/v1/users`, {
    headers: { Authorization: `Bearer ${token}` },
  }, orgId);
  return unwrapList<User>(result);
}

export async function createUser(
  baseUrl: string,
  token: string,
  data: CreateUserInput,
  orgId?: string,
): Promise<User> {
  return apiFetch<User>(`${baseUrl}/api/v1/users`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  }, orgId);
}

export async function deactivateUser(
  baseUrl: string,
  token: string,
  id: string,
  orgId?: string,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (orgId != null && orgId !== 'system') {
    headers['X-Org-Id'] = orgId;
  }
  const response = await fetch(`${baseUrl}/api/v1/users/${encodeURIComponent(id)}/deactivate`, {
    method: 'PATCH', headers,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${body}`);
  }
}

// ── Org Data Cleanup ──────────────────────────────────────────────────────────

export async function deleteOrgData(
  baseUrl: string,
  token: string,
  orgId: string,
): Promise<void> {
  await apiFetch(`${baseUrl}/api/v1/orgs/${encodeURIComponent(orgId)}/data`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ── OAuth Clients ─────────────────────────────────────────────────────────────

export interface OAuthClient {
  readonly clientId: string;
  readonly name: string;
  readonly scopes: string[];
  readonly grantTypes: string[];
  readonly orgId: string;
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
  orgId?: string,
): Promise<OAuthClient[]> {
  const result = await apiFetch<unknown>(`${baseUrl}/api/v1/clients`, {
    headers: { Authorization: `Bearer ${token}` },
  }, orgId);
  return unwrapList<OAuthClient>(result);
}

export async function createClient(
  baseUrl: string,
  token: string,
  data: CreateClientInput,
  orgId?: string,
): Promise<OAuthClient & { secret: string }> {
  return apiFetch<OAuthClient & { secret: string }>(`${baseUrl}/api/v1/clients`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  }, orgId);
}

export async function createComplianceClient(
  baseUrl: string,
  adminToken: string,
  orgId: string,
  orgName: string,
): Promise<{ clientId: string; clientSecret: string }> {
  const response = await fetch(`${baseUrl}/api/v1/clients`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: `dashboard-${orgName}`,
      scopes: ['read', 'write'],
      grantTypes: ['client_credentials'],
      orgId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create compliance client: ${response.status}`);
  }

  const data = await response.json() as { data: { id: string; secret: string } };
  return { clientId: data.data.id, clientSecret: data.data.secret };
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
    fetch(`${complianceUrl}/api/v1/health`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch(() => ({ status: 'error' })) as Promise<{ status: string }>,
  ];

  if (webserviceUrl !== undefined && webserviceUrl !== '') {
    requests.push(
      fetch(webserviceUrl)
        .then((r) => (r.ok ? { status: 'ok' } : Promise.reject(new Error(`HTTP ${r.status}`))))
        .catch(() => ({ status: 'error' })) as Promise<{ status: string }>,
    );
  }

  const [compliance, pa11y] = await Promise.all(requests);

  return {
    compliance: compliance ?? { status: 'error' },
    pa11y,
  };
}

// ── Safe Wrappers (graceful degradation) ─────────────────────────────────────

export async function safeListJurisdictions(
  baseUrl: string,
  token: string,
): Promise<Jurisdiction[]> {
  try {
    return await listJurisdictions(baseUrl, token);
  } catch {
    return [];
  }
}

export async function safeGetSystemHealth(
  complianceUrl: string,
  webserviceUrl?: string,
): Promise<SystemHealth> {
  try {
    const health = await getSystemHealth(complianceUrl, webserviceUrl);
    return {
      compliance: {
        status: health.compliance.status === 'error' ? 'degraded' : health.compliance.status,
      },
      pa11y: health.pa11y,
    };
  } catch {
    return {
      compliance: { status: 'degraded' },
      pa11y: undefined,
    };
  }
}
