// HTTP client for the compliance service REST API.

export interface TokenResponse {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in: number;
  readonly scope: string;
}

export interface MonitoredSource {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly type: 'html' | 'rss' | 'api';
  readonly schedule: 'daily' | 'weekly' | 'monthly';
  readonly lastCheckedAt?: string;
  readonly lastContentHash?: string;
  readonly createdAt: string;
}

export interface CreateSourceInput {
  readonly name: string;
  readonly url: string;
  readonly type: 'html' | 'rss' | 'api';
  readonly schedule: 'daily' | 'weekly' | 'monthly';
}

export interface SeedStatus {
  readonly seeded: boolean;
  readonly jurisdictions: number;
  readonly regulations: number;
  readonly requirements: number;
}

export interface UpdateProposal {
  readonly id: string;
  readonly source: string;
  readonly detectedAt: string;
  readonly type: 'new_regulation' | 'amendment' | 'repeal' | 'new_requirement' | 'new_jurisdiction';
  readonly affectedRegulationId?: string;
  readonly affectedJurisdictionId?: string;
  readonly summary: string;
  readonly proposedChanges: ProposedChange;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly reviewedBy?: string;
  readonly reviewedAt?: string;
  readonly createdAt: string;
}

export interface ProposedChange {
  readonly action: 'create' | 'update' | 'delete';
  readonly entityType: 'jurisdiction' | 'regulation' | 'requirement';
  readonly entityId?: string;
  readonly before?: Record<string, unknown>;
  readonly after?: Record<string, unknown>;
}

export interface ProposeUpdateInput {
  readonly source: string;
  readonly type: UpdateProposal['type'];
  readonly affectedRegulationId?: string;
  readonly affectedJurisdictionId?: string;
  readonly summary: string;
  readonly proposedChanges: ProposedChange;
}

export interface ComplianceClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
}

// ---- Token fetch ----

/**
 * Obtain an OAuth2 access token using the client_credentials flow.
 */
export async function getToken(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  scope = 'read write',
  timeoutMs = 10_000,
): Promise<string> {
  const url = `${baseUrl}/api/v1/oauth/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Token request failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as TokenResponse;
  return data.access_token;
}

// ---- API methods ----

async function apiRequest<T>(
  method: string,
  url: string,
  token: string,
  body?: unknown,
  timeoutMs = 15_000,
  orgId?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (orgId != null && orgId !== 'system') {
    headers['X-Org-Id'] = orgId;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      signal: controller.signal,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`API ${method} ${url} failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

/**
 * List all monitored sources from the compliance service.
 */
export async function listSources(
  baseUrl: string,
  token: string,
  orgId?: string,
): Promise<MonitoredSource[]> {
  const result = await apiRequest<{ data: MonitoredSource[] } | MonitoredSource[]>(
    'GET',
    `${baseUrl}/api/v1/sources`,
    token,
    undefined,
    undefined,
    orgId,
  );
  // Handle both paginated envelope and plain array
  if (Array.isArray(result)) return result;
  return (result as { data: MonitoredSource[] }).data;
}

/**
 * Get seed status from the compliance service.
 */
export async function getSeedStatus(
  baseUrl: string,
  token: string,
  orgId?: string,
): Promise<SeedStatus> {
  return apiRequest<SeedStatus>('GET', `${baseUrl}/api/v1/seed/status`, token, undefined, undefined, orgId);
}

/**
 * Submit an update proposal to the compliance service.
 */
export async function proposeUpdate(
  baseUrl: string,
  token: string,
  proposal: ProposeUpdateInput,
  orgId?: string,
): Promise<UpdateProposal> {
  return apiRequest<UpdateProposal>('POST', `${baseUrl}/api/v1/updates/propose`, token, proposal, undefined, orgId);
}

/**
 * Update a monitored source's last-checked timestamp and content hash.
 * Uses PATCH /sources/:id — this is a best-effort call; errors are logged
 * but do not abort the scan.
 */
export async function updateSourceLastChecked(
  baseUrl: string,
  token: string,
  sourceId: string,
  contentHash: string,
  orgId?: string,
): Promise<void> {
  try {
    await apiRequest<unknown>(
      'PATCH',
      `${baseUrl}/api/v1/sources/${sourceId}`,
      token,
      {
        lastContentHash: contentHash,
        lastCheckedAt: new Date().toISOString(),
      },
      undefined,
      orgId,
    );
  } catch (err) {
    // Best-effort — don't break the scan loop
    console.warn(`[monitor] Could not update source ${sourceId}: ${String(err)}`);
  }
}

/**
 * Add a new monitored source to the compliance service.
 */
export async function addSource(
  baseUrl: string,
  token: string,
  input: CreateSourceInput,
  orgId?: string,
): Promise<MonitoredSource> {
  return apiRequest<MonitoredSource>('POST', `${baseUrl}/api/v1/sources`, token, input, undefined, orgId);
}
