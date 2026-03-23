import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OktaProvider, type UserInfo } from './okta-provider.js';

// ---------------------------------------------------------------------------
// Local interface definitions (compatible with dashboard's AuthPlugin)
// ---------------------------------------------------------------------------

interface ConfigField {
  readonly key: string;
  readonly label: string;
  readonly type: 'string' | 'secret' | 'number' | 'boolean' | 'select';
  readonly required?: boolean;
  readonly default?: unknown;
  readonly options?: readonly string[];
  readonly description?: string;
}

interface PluginManifest {
  readonly name: string;
  readonly displayName: string;
  readonly type: 'auth' | 'notification' | 'storage' | 'scanner';
  readonly version: string;
  readonly description: string;
  readonly icon?: string;
  readonly configSchema: readonly ConfigField[];
  readonly autoDeactivateOnFailure?: boolean;
}

interface AuthResult {
  readonly authenticated: boolean;
  readonly user?: {
    readonly id: string;
    readonly username: string;
    readonly email?: string;
    readonly role?: string;
  };
  readonly token?: string;
  readonly error?: string;
  readonly groups?: readonly string[];
}

interface MinimalRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly query: Readonly<Record<string, string | undefined>>;
}

interface AuthPlugin {
  readonly manifest: PluginManifest;
  activate(config: Readonly<Record<string, unknown>>): Promise<void>;
  deactivate(): Promise<void>;
  healthCheck(): Promise<boolean>;
  authenticate(request: MinimalRequest): Promise<AuthResult>;
  getLoginUrl(): Promise<string>;
  handleCallback(request: MinimalRequest): Promise<AuthResult>;
  getUserInfo(token: string): Promise<UserInfo>;
  getLogoutUrl(returnTo?: string): Promise<string>;
  refreshToken(token: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Read manifest from disk
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(__dirname, '..', 'manifest.json');

function loadManifest(): PluginManifest {
  const raw = readFileSync(manifestPath, 'utf-8');
  return JSON.parse(raw) as PluginManifest;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export default function createPlugin(): AuthPlugin {
  const manifest = loadManifest();
  let provider: OktaProvider | null = null;
  let redirectUri = '/auth/callback/auth-okta';
  let groupClaimName = 'groups';
  let lastIdToken: string | undefined;

  return {
    manifest,

    async activate(config: Readonly<Record<string, unknown>>): Promise<void> {
      const orgUrl = config['orgUrl'] as string | undefined;
      const clientId = config['clientId'] as string | undefined;
      const clientSecret = config['clientSecret'] as string | undefined;

      if (!orgUrl) throw new Error('Missing required config: orgUrl');
      if (!clientId) throw new Error('Missing required config: clientId');
      if (!clientSecret) throw new Error('Missing required config: clientSecret');

      redirectUri =
        (config['redirectUri'] as string | undefined) ?? '/auth/callback/auth-okta';
      groupClaimName =
        (config['groupClaimName'] as string | undefined) ?? 'groups';

      provider = new OktaProvider({ orgUrl, clientId, clientSecret, redirectUri });
      await provider.initialise();
    },

    async deactivate(): Promise<void> {
      if (provider) {
        provider.destroy();
        provider = null;
      }
      lastIdToken = undefined;
    },

    async healthCheck(): Promise<boolean> {
      if (!provider?.isInitialised) return false;
      return provider.checkHealth();
    },

    async authenticate(request: MinimalRequest): Promise<AuthResult> {
      const authHeader = request.headers['authorization'];
      const token =
        typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7)
          : undefined;

      if (!token) {
        return { authenticated: false, error: 'No bearer token provided' };
      }

      try {
        const userInfo = await this.getUserInfo(token);
        return {
          authenticated: true,
          user: {
            id: userInfo.id,
            username: userInfo.username,
            email: userInfo.email,
          },
          token,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Authentication failed';
        return { authenticated: false, error: message };
      }
    },

    async getLoginUrl(): Promise<string> {
      assertProvider(provider);
      return provider.getAuthCodeUrl(redirectUri);
    },

    async handleCallback(request: MinimalRequest): Promise<AuthResult> {
      assertProvider(provider);

      const code = request.query['code'];
      if (!code) {
        return { authenticated: false, error: 'Missing authorization code' };
      }

      try {
        const tokenResponse = await provider.acquireTokenByCode(code, redirectUri);
        const userInfo = provider.extractUserInfoFromIdToken(
          tokenResponse.id_token,
          groupClaimName,
        );

        // Store the ID token for logout hint
        lastIdToken = tokenResponse.id_token;

        // Extract groups from the ID token using the configured claim name
        const groups = userInfo.groups ? [...userInfo.groups] : undefined;

        return {
          authenticated: true,
          user: {
            id: userInfo.id,
            username: userInfo.username,
            email: userInfo.email,
          },
          token: tokenResponse.access_token,
          groups,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Callback handling failed';
        return { authenticated: false, error: message };
      }
    },

    async getUserInfo(token: string): Promise<UserInfo> {
      assertProvider(provider);
      return provider.fetchUserInfo(token);
    },

    async getLogoutUrl(returnTo?: string): Promise<string> {
      assertProvider(provider);
      return provider.getLogoutUrl(lastIdToken, returnTo);
    },

    async refreshToken(token: string): Promise<string> {
      assertProvider(provider);
      const result = await provider.refreshToken(token);
      // Store the new ID token for logout hint
      if (result.id_token) {
        lastIdToken = result.id_token;
      }
      return result.access_token;
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertProvider(
  p: OktaProvider | null,
): asserts p is OktaProvider {
  if (!p) {
    throw new Error('Plugin has not been activated — call activate() first');
  }
}
