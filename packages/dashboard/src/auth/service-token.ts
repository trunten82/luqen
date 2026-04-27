/**
 * Auto-refreshing service token for dashboard→compliance API calls.
 *
 * Uses OAuth2 client_credentials grant to obtain and automatically refresh
 * a token before it expires. Eliminates the need for the manual
 * DASHBOARD_COMPLIANCE_API_KEY environment variable.
 */

export class ServiceTokenManager {
  private token: string | null = null;
  private expiresAt = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly complianceUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  /**
   * Get a valid service token, refreshing if necessary.
   * Falls back to DASHBOARD_COMPLIANCE_API_KEY env var if client credentials
   * are not configured or if the token fetch fails.
   */
  async getToken(): Promise<string> {
    // If we have a valid token with >60s remaining, return it
    if (this.token !== null && Date.now() < this.expiresAt - 60_000) {
      return this.token;
    }

    // Try to fetch a new token using client_credentials
    if (this.clientId !== '' && this.clientSecret !== '') {
      try {
        await this.refresh();
        if (this.token !== null) return this.token;
      } catch {
        // Fall through to env var fallback
      }
    }

    // Fallback to manual env var
    return process.env['DASHBOARD_COMPLIANCE_API_KEY'] ?? '';
  }

  private async refresh(): Promise<void> {
    // No `scope` field — RFC 6749 §3.3: when omitted, the auth server returns
    // all scopes registered for the client. This makes the same code path
    // work for both the global dashboard client (registered with admin scope)
    // and per-org clients (registered with read+write only). Hardcoding
    // `scope: 'admin'` previously caused per-org token requests to fail with
    // 400 invalid_scope and silently fall back to '' / env-var.
    const response = await fetch(`${this.complianceUrl}/api/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.token = null;
      throw new Error(`Token endpoint returned ${response.status}: ${body.slice(0, 200)}`);
    }

    const raw = (await response.json()) as Record<string, unknown>;
    if (typeof raw['access_token'] !== 'string' || typeof raw['expires_in'] !== 'number' || raw['expires_in'] <= 0) {
      this.token = null;
      throw new Error('Malformed token response from compliance service');
    }
    this.token = raw['access_token'];
    this.expiresAt = Date.now() + (raw['expires_in'] as number) * 1000;

    // Schedule refresh 5 minutes before expiry
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    const refreshIn = Math.max(((raw['expires_in'] as number) - 300) * 1000, 30_000);
    this.refreshTimer = setTimeout(() => { void this.refresh(); }, refreshIn);
    this.refreshTimer.unref(); // Don't prevent process exit
  }

  destroy(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
