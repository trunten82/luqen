// ---------------------------------------------------------------------------
// Local types (compatible with dashboard AuthPlugin contracts, no import)
// ---------------------------------------------------------------------------

export interface UserInfo {
  readonly id: string;
  readonly username: string;
  readonly email?: string;
  readonly groups?: readonly string[];
}

export interface GoogleConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri?: string;
  readonly hostedDomain?: string;
  readonly groupsEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Token response from Google's OAuth 2.0 token endpoint
// ---------------------------------------------------------------------------

export interface TokenResponse {
  readonly access_token: string;
  readonly id_token: string;
  readonly refresh_token?: string;
  readonly expires_in: number;
  readonly token_type: string;
  readonly scope?: string;
}

// ---------------------------------------------------------------------------
// UserInfo response from Google's OpenID Connect endpoint
// ---------------------------------------------------------------------------

interface GoogleUserInfoResponse {
  readonly sub: string;
  readonly name?: string;
  readonly email?: string;
  readonly email_verified?: boolean;
  readonly picture?: string;
  readonly hd?: string;
}

// ---------------------------------------------------------------------------
// Google OAuth 2.0 / OpenID Connect provider (raw fetch, no SDK)
// ---------------------------------------------------------------------------

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_OIDC_DISCOVERY_URL = 'https://accounts.google.com/.well-known/openid-configuration';
const GOOGLE_ADMIN_GROUPS_URL = 'https://admin.googleapis.com/admin/directory/v1/groups';

const DEFAULT_SCOPES = ['openid', 'profile', 'email'] as const;

export class GoogleProvider {
  private readonly config: GoogleConfig;
  private initialised = false;

  constructor(config: GoogleConfig) {
    this.config = config;
  }

  /** Mark the provider as initialised (validates config). */
  initialise(): void {
    if (!this.config.clientId) {
      throw new Error('Missing required config: clientId');
    }
    if (!this.config.clientSecret) {
      throw new Error('Missing required config: clientSecret');
    }
    this.initialised = true;
  }

  /** Tear down the provider. */
  destroy(): void {
    this.initialised = false;
  }

  /** Whether the provider has been initialised. */
  get isInitialised(): boolean {
    return this.initialised;
  }

  /** Build the Google OAuth 2.0 authorization URL. */
  getAuthCodeUrl(
    redirectUri: string,
    scopes: readonly string[] = DEFAULT_SCOPES,
  ): string {
    this.assertInitialised();

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
    });

    if (this.config.hostedDomain) {
      params.set('hd', this.config.hostedDomain);
    }

    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  /** Exchange an authorization code for tokens. */
  async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<TokenResponse> {
    this.assertInitialised();

    const body = new URLSearchParams({
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Google token exchange failed: ${response.status} ${response.statusText} — ${errorBody}`,
      );
    }

    return (await response.json()) as TokenResponse;
  }

  /** Refresh an access token using a refresh token. */
  async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    this.assertInitialised();

    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'refresh_token',
    });

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Google token refresh failed: ${response.status} ${response.statusText} — ${errorBody}`,
      );
    }

    return (await response.json()) as TokenResponse;
  }

  /** Fetch user info from Google's OpenID Connect userinfo endpoint. */
  async fetchUserInfo(accessToken: string): Promise<UserInfo> {
    this.assertInitialised();

    const response = await fetch(GOOGLE_USERINFO_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(
        `Google userinfo request failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as GoogleUserInfoResponse;

    // Validate hosted domain restriction if configured
    if (this.config.hostedDomain && data.hd !== this.config.hostedDomain) {
      throw new Error(
        `User does not belong to the required domain: ${this.config.hostedDomain}`,
      );
    }

    return {
      id: data.sub,
      username: data.email ?? data.name ?? '',
      email: data.email,
    };
  }

  /** Extract user info from an ID token JWT (without verification — token was validated during exchange). */
  extractUserInfoFromIdToken(idToken: string): UserInfo {
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8'),
    ) as Record<string, unknown>;

    // Validate hosted domain restriction if configured
    if (
      this.config.hostedDomain &&
      payload['hd'] !== this.config.hostedDomain
    ) {
      throw new Error(
        `User does not belong to the required domain: ${this.config.hostedDomain}`,
      );
    }

    return {
      id: (payload['sub'] as string) ?? '',
      username:
        (payload['email'] as string) ??
        (payload['name'] as string) ??
        '',
      email: (payload['email'] as string) ?? undefined,
    };
  }

  /**
   * Fetch Google Workspace group memberships via Admin SDK.
   *
   * Requires domain-wide delegation and the Groups API enabled.
   * The access token must have the admin.directory.group.readonly scope.
   */
  async fetchGroups(accessToken: string, userEmail: string): Promise<string[]> {
    const groups: string[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        userKey: userEmail,
      });
      if (pageToken) {
        params.set('pageToken', pageToken);
      }

      const url = `${GOOGLE_ADMIN_GROUPS_URL}?${params.toString()}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(
          `Google Admin Groups API failed: ${response.status} ${response.statusText}`,
        );
      }

      const body = (await response.json()) as {
        groups?: Array<{ id: string; email: string; name?: string }>;
        nextPageToken?: string;
      };

      if (body.groups) {
        for (const group of body.groups) {
          groups.push(group.email);
        }
      }

      pageToken = body.nextPageToken;
    } while (pageToken);

    return groups;
  }

  /** Construct the Google logout URL. */
  getLogoutUrl(postLogoutRedirectUri?: string): string {
    // Google does not have a standard logout endpoint with redirect.
    // Revoke the token and redirect to the app's post-logout URI.
    const base = 'https://accounts.google.com/Logout';
    if (postLogoutRedirectUri) {
      return `${base}?continue=${encodeURIComponent(postLogoutRedirectUri)}`;
    }
    return base;
  }

  /** Verify that Google's OIDC discovery endpoint is reachable. */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(GOOGLE_OIDC_DISCOVERY_URL, {
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
    if (!this.initialised) {
      throw new Error('GoogleProvider has not been initialised — call initialise() first');
    }
  }
}
