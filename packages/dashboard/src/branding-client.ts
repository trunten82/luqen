export interface BrandingGuideline {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly description?: string;
  readonly version: number;
  readonly active: boolean;
  readonly colors: BrandingColor[];
  readonly fonts: BrandingFont[];
  readonly selectors: BrandingSelector[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BrandingColor {
  readonly id: string;
  readonly name: string;
  readonly hexValue: string;
  readonly usage?: string;
  readonly context?: string;
}

export interface BrandingFont {
  readonly id: string;
  readonly family: string;
  readonly weights?: string[];
  readonly usage?: string;
  readonly context?: string;
}

export interface BrandingSelector {
  readonly id: string;
  readonly pattern: string;
  readonly description?: string;
}

export interface BrandMatchResponse {
  readonly matched: boolean;
  readonly strategy?: string;
  readonly guidelineName?: string;
  readonly guidelineId?: string;
  readonly matchDetail?: string;
}

export interface BrandedIssueResponse {
  readonly issue: Record<string, unknown>;
  readonly brandMatch: BrandMatchResponse;
}

export interface TokenResponse {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in: number;
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
  brandingUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<TokenResponse> {
  const response = await fetch(`${brandingUrl}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
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

export async function listGuidelines(
  brandingUrl: string,
  token: string,
  orgId?: string,
): Promise<BrandingGuideline[]> {
  const result = await apiFetch<unknown>(`${brandingUrl}/api/v1/guidelines`, {
    headers: { Authorization: `Bearer ${token}` },
  }, orgId);
  return unwrapList<BrandingGuideline>(result);
}

export async function getGuideline(
  brandingUrl: string,
  token: string,
  id: string,
): Promise<BrandingGuideline> {
  return apiFetch<BrandingGuideline>(
    `${brandingUrl}/api/v1/guidelines/${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

export async function getGuidelineForSite(
  brandingUrl: string,
  token: string,
  siteUrl: string,
  orgId: string,
): Promise<BrandingGuideline | null> {
  try {
    return await apiFetch<BrandingGuideline>(
      `${brandingUrl}/api/v1/guidelines/for-site?url=${encodeURIComponent(siteUrl)}`,
      { headers: { Authorization: `Bearer ${token}` } },
      orgId,
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('HTTP 404')) {
      return null;
    }
    throw err;
  }
}

export async function matchIssues(
  brandingUrl: string,
  token: string,
  issues: unknown[],
  siteUrl: string,
  orgId: string,
): Promise<BrandedIssueResponse[]> {
  const result = await apiFetch<unknown>(
    `${brandingUrl}/api/v1/guidelines/match-issues`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ issues, siteUrl }),
    },
    orgId,
  );
  return unwrapList<BrandedIssueResponse>(result);
}

export async function safeGetHealth(
  brandingUrl: string,
): Promise<{ status: string } | null> {
  try {
    const response = await fetch(`${brandingUrl}/api/v1/health`);
    if (!response.ok) return null;
    return response.json() as Promise<{ status: string }>;
  } catch {
    return null;
  }
}
