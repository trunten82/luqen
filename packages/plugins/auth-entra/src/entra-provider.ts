import {
  ConfidentialClientApplication,
  type Configuration,
  type AuthenticationResult,
} from '@azure/msal-node';

// ---------------------------------------------------------------------------
// Local types (compatible with dashboard AuthPlugin contracts, no import)
// ---------------------------------------------------------------------------

export interface UserInfo {
  readonly id: string;
  readonly username: string;
  readonly email?: string;
  readonly groups?: readonly string[];
}

export interface EntraConfig {
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri?: string;
}

// ---------------------------------------------------------------------------
// MSAL wrapper
// ---------------------------------------------------------------------------

const DEFAULT_SCOPES = ['openid', 'profile', 'email'] as const;

export class EntraProvider {
  private client: ConfidentialClientApplication | null = null;
  private readonly config: EntraConfig;

  constructor(config: EntraConfig) {
    this.config = config;
  }

  /** Initialise the MSAL ConfidentialClientApplication. */
  initialise(): void {
    const msalConfig: Configuration = {
      auth: {
        clientId: this.config.clientId,
        authority: `https://login.microsoftonline.com/${this.config.tenantId}`,
        clientSecret: this.config.clientSecret,
      },
    };
    this.client = new ConfidentialClientApplication(msalConfig);
  }

  /** Tear down the MSAL client. */
  destroy(): void {
    this.client = null;
  }

  /** Whether the provider has been initialised. */
  get isInitialised(): boolean {
    return this.client !== null;
  }

  /** Build the authorization code URL that the user's browser is redirected to. */
  async getAuthCodeUrl(
    redirectUri: string,
    scopes: readonly string[] = DEFAULT_SCOPES,
  ): Promise<string> {
    this.assertInitialised();
    return this.client!.getAuthCodeUrl({
      redirectUri,
      scopes: [...scopes],
    });
  }

  /** Exchange an authorization code for tokens. */
  async acquireTokenByCode(
    code: string,
    redirectUri: string,
    scopes: readonly string[] = DEFAULT_SCOPES,
  ): Promise<AuthenticationResult> {
    this.assertInitialised();
    const result = await this.client!.acquireTokenByCode({
      code,
      redirectUri,
      scopes: [...scopes],
    });
    if (!result) {
      throw new Error('Token acquisition returned null');
    }
    return result;
  }

  /** Attempt silent token refresh using the MSAL cache. */
  async acquireTokenSilent(
    accountHomeId: string,
    scopes: readonly string[] = DEFAULT_SCOPES,
  ): Promise<AuthenticationResult> {
    this.assertInitialised();
    const cache = this.client!.getTokenCache();
    const accounts = await cache.getAllAccounts();
    const account = accounts.find((a) => a.homeAccountId === accountHomeId);
    if (!account) {
      throw new Error('No cached account found for silent refresh');
    }
    const result = await this.client!.acquireTokenSilent({
      account,
      scopes: [...scopes],
    });
    if (!result) {
      throw new Error('Silent token acquisition returned null');
    }
    return result;
  }

  /** Extract a UserInfo object from an MSAL AuthenticationResult. */
  extractUserInfo(authResult: AuthenticationResult): UserInfo {
    const claims = authResult.idTokenClaims as Record<string, unknown> | undefined;
    const id =
      (claims?.['oid'] as string | undefined) ??
      (claims?.['sub'] as string | undefined) ??
      authResult.uniqueId ??
      '';
    const username =
      (claims?.['preferred_username'] as string | undefined) ??
      (authResult.account?.username ?? '');
    const email =
      (claims?.['email'] as string | undefined) ?? undefined;
    const rawGroups = claims?.['groups'];
    const groups = Array.isArray(rawGroups)
      ? (rawGroups as string[])
      : undefined;

    return { id, username, email, groups };
  }

  /** Construct the Azure Entra ID logout URL. */
  getLogoutUrl(postLogoutRedirectUri?: string): string {
    const base = `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/logout`;
    if (postLogoutRedirectUri) {
      return `${base}?post_logout_redirect_uri=${encodeURIComponent(postLogoutRedirectUri)}`;
    }
    return base;
  }

  /** Verify that the Entra metadata endpoint is reachable. */
  async checkHealth(): Promise<boolean> {
    const url = `https://login.microsoftonline.com/${this.config.tenantId}/v2.0/.well-known/openid-configuration`;
    try {
      const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private assertInitialised(): void {
    if (!this.client) {
      throw new Error('EntraProvider has not been initialised — call initialise() first');
    }
  }
}
