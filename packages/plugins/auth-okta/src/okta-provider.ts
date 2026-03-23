// ---------------------------------------------------------------------------
// Local types (compatible with dashboard AuthPlugin contracts, no import)
// ---------------------------------------------------------------------------

export interface UserInfo {
  readonly id: string;
  readonly username: string;
  readonly email?: string;
  readonly groups?: readonly string[];
}

export interface OktaConfig {
  readonly orgUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri?: string;
}

// ---------------------------------------------------------------------------
// Token response from Okta /token endpoint
// ---------------------------------------------------------------------------

export interface TokenResponse {
  readonly access_token: string;
  readonly id_token: string;
  readonly refresh_token?: string;
  readonly token_type: string;
  readonly expires_in: number;
  readonly scope: string;
}

// ---------------------------------------------------------------------------
// OIDC discovery document
// ---------------------------------------------------------------------------

interface OidcDiscovery {
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly userinfo_endpoint: string;
  readonly end_session_endpoint: string;
  readonly issuer: string;
}

// ---------------------------------------------------------------------------
// Okta OIDC provider (raw fetch, no SDK)
// ---------------------------------------------------------------------------

const DEFAULT_SCOPES = ['openid', 'profile', 'email', 'groups'] as const;

export class OktaProvider {
  private readonly config: OktaConfig;
  private discovery: OidcDiscovery | null = null;
  private initialised = false;

  constructor(config: OktaConfig) {
    this.config = config;
  }

  /** Fetch the OIDC discovery document and mark provider as initialised. */
  async initialise(): Promise<void> {
    const discoveryUrl = `${this.config.orgUrl}/.well-known/openid-configuration`;
    const response = await fetch(discoveryUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch OIDC discovery: ${response.status} ${response.statusText}`,
      );
    }

    this.discovery = (await response.json()) as OidcDiscovery;
    this.initialised = true;
  }

  /** Tear down the provider. */
  destroy(): void {
    this.discovery = null;
    this.initialised = false;
  }

  /** Whether the provider has been initialised. */
  get isInitialised(): boolean {
    return this.initialised;
  }

  /** Build the authorization URL that the user's browser is redirected to. */
  getAuthCodeUrl(
    redirectUri: string,
    scopes: readonly string[] = DEFAULT_SCOPES,
    state?: string,
  ): string {
    this.assertInitialised();

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      scope: scopes.join(' '),
      redirect_uri: redirectUri,
      state: state ?? this.generateState(),
    });

    return `${this.discovery!.authorization_endpoint}?${params.toString()}`;
  }

  /** Exchange an authorization code for tokens via the /token endpoint. */
  async acquireTokenByCode(
    code: string,
    redirectUri: string,
    scopes: readonly string[] = DEFAULT_SCOPES,
  ): Promise<TokenResponse> {
    this.assertInitialised();

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      scope: scopes.join(' '),
    });

    const response = await fetch(this.discovery!.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${this.encodeCredentials()}`,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Token exchange failed: ${response.status} ${response.statusText} — ${errorBody}`,
      );
    }

    return (await response.json()) as TokenResponse;
  }

  /** Refresh an access token using a refresh token. */
  async refreshToken(
    refreshToken: string,
    scopes: readonly string[] = DEFAULT_SCOPES,
  ): Promise<TokenResponse> {
    this.assertInitialised();

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    });

    const response = await fetch(this.discovery!.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${this.encodeCredentials()}`,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Token refresh failed: ${response.status} ${response.statusText} — ${errorBody}`,
      );
    }

    return (await response.json()) as TokenResponse;
  }

  /** Fetch user info from the /userinfo endpoint. */
  async fetchUserInfo(accessToken: string): Promise<UserInfo> {
    this.assertInitialised();

    const response = await fetch(this.discovery!.userinfo_endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(
        `UserInfo request failed: ${response.status} ${response.statusText}`,
      );
    }

    const body = (await response.json()) as Record<string, unknown>;

    return {
      id: (body['sub'] as string) ?? '',
      username: (body['preferred_username'] as string) ?? (body['email'] as string) ?? '',
      email: (body['email'] as string) ?? undefined,
      groups: Array.isArray(body['groups'])
        ? (body['groups'] as string[])
        : undefined,
    };
  }

  /** Extract a UserInfo object from a JWT ID token (without verification). */
  extractUserInfoFromIdToken(
    idToken: string,
    groupClaimName = 'groups',
  ): UserInfo {
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8'),
    ) as Record<string, unknown>;

    return {
      id: (payload['sub'] as string) ?? '',
      username:
        (payload['preferred_username'] as string) ??
        (payload['email'] as string) ??
        '',
      email: (payload['email'] as string) ?? undefined,
      groups: Array.isArray(payload[groupClaimName])
        ? (payload[groupClaimName] as string[])
        : undefined,
    };
  }

  /** Construct the Okta logout URL. */
  getLogoutUrl(
    idTokenHint?: string,
    postLogoutRedirectUri?: string,
  ): string {
    this.assertInitialised();

    const base = this.discovery!.end_session_endpoint;
    const params = new URLSearchParams();

    if (idTokenHint) {
      params.set('id_token_hint', idTokenHint);
    }
    if (postLogoutRedirectUri) {
      params.set('post_logout_redirect_uri', postLogoutRedirectUri);
    }

    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  /** Verify that the OIDC discovery endpoint is reachable. */
  async checkHealth(): Promise<boolean> {
    const url = `${this.config.orgUrl}/.well-known/openid-configuration`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private assertInitialised(): void {
    if (!this.initialised || !this.discovery) {
      throw new Error('OktaProvider has not been initialised — call initialise() first');
    }
  }

  /** Base64-encode client_id:client_secret for Basic auth. */
  private encodeCredentials(): string {
    return Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`,
    ).toString('base64');
  }

  /** Generate a random state parameter for CSRF protection. */
  private generateState(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Buffer.from(bytes).toString('base64url');
  }
}
