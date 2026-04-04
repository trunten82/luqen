// ── LLM Service Client ──────────────────────────────────────────────────────
// Proxies dashboard requests to the @luqen/llm service.
// Authentication: OAuth2 client_credentials (same pattern as compliance/branding).

import { ServiceTokenManager } from './auth/service-token.js';

function unwrapList<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result != null && typeof result === 'object' && 'data' in result) {
    return (result as { data: T[] }).data;
  }
  return [];
}

// ── Provider types ──────────────────────────────────────────────────────────

export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly baseUrl?: string;
  readonly status: 'active' | 'inactive' | 'error';
  readonly timeout: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateProviderInput {
  readonly name: string;
  readonly type: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly timeout?: number;
}

export interface UpdateProviderInput {
  readonly name?: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly status?: 'active' | 'inactive';
}

// ── Model types ─────────────────────────────────────────────────────────────

export interface LLMModel {
  readonly id: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly status: 'active' | 'inactive';
  readonly capabilities: readonly string[];
  readonly createdAt: string;
}

export interface CreateModelInput {
  readonly providerId: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly capabilities?: readonly string[];
}

// ── Capability types ────────────────────────────────────────────────────────

export interface LLMCapability {
  readonly name: string;
  readonly assignments: ReadonlyArray<{
    readonly capability: string;
    readonly modelId: string;
    readonly priority: number;
    readonly orgId: string;
  }>;
}

export interface AssignCapabilityInput {
  readonly modelId: string;
  readonly priority?: number;
}

// ── Prompt types ────────────────────────────────────────────────────────────

export interface LLMPrompt {
  readonly capability: string;
  readonly template: string;
  readonly isCustom: boolean;
  readonly updatedAt?: string;
}

// ── Health / Status types ───────────────────────────────────────────────────

export interface LLMHealth {
  readonly status: string;
  readonly version?: string;
}

export interface LLMStatus {
  readonly providers: number;
  readonly models: number;
  readonly capabilities: readonly string[];
}

// ── Remote model (from provider API) ───────────────────────────────────────

export interface RemoteModel {
  readonly id: string;
  readonly name?: string;
}

// ── Client class ────────────────────────────────────────────────────────────

export class LLMClient {
  private readonly baseUrl: string;
  private readonly tokenManager: ServiceTokenManager;

  constructor(baseUrl: string, clientId: string, clientSecret: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.tokenManager = new ServiceTokenManager(baseUrl, clientId, clientSecret);
  }

  /** Destroy the underlying token refresh timer. */
  destroy(): void {
    this.tokenManager.destroy();
  }

  private async apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
    const token = await this.tokenManager.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${body}`);
    }

    return response.json() as Promise<T>;
  }

  private async deleteRequest(url: string): Promise<void> {
    const token = await this.tokenManager.getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers,
      body: '{}',
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${body}`);
    }
  }

  // -- Providers ──────────────────────────────────────────────────────────

  async listProviders(): Promise<LLMProvider[]> {
    const result = await this.apiFetch<unknown>(`${this.baseUrl}/api/v1/providers`);
    return unwrapList<LLMProvider>(result);
  }

  async createProvider(data: CreateProviderInput): Promise<LLMProvider> {
    return this.apiFetch<LLMProvider>(`${this.baseUrl}/api/v1/providers`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateProvider(id: string, data: UpdateProviderInput): Promise<LLMProvider> {
    return this.apiFetch<LLMProvider>(`${this.baseUrl}/api/v1/providers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteProvider(id: string): Promise<void> {
    await this.deleteRequest(`${this.baseUrl}/api/v1/providers/${encodeURIComponent(id)}`);
  }

  async testProvider(id: string): Promise<{ ok: boolean; status: string }> {
    return this.apiFetch<{ ok: boolean; status: string }>(
      `${this.baseUrl}/api/v1/providers/${encodeURIComponent(id)}/test`,
      { method: 'POST', body: '{}' },
    );
  }

  async listRemoteModels(providerId: string): Promise<RemoteModel[]> {
    const result = await this.apiFetch<unknown>(
      `${this.baseUrl}/api/v1/providers/${encodeURIComponent(providerId)}/models`,
    );
    return unwrapList<RemoteModel>(result);
  }

  // -- Models ─────────────────────────────────────────────────────────────

  async listModels(): Promise<LLMModel[]> {
    const result = await this.apiFetch<unknown>(`${this.baseUrl}/api/v1/models`);
    return unwrapList<LLMModel>(result);
  }

  async createModel(data: CreateModelInput): Promise<LLMModel> {
    return this.apiFetch<LLMModel>(`${this.baseUrl}/api/v1/models`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteModel(id: string): Promise<void> {
    await this.deleteRequest(`${this.baseUrl}/api/v1/models/${encodeURIComponent(id)}`);
  }

  // -- Capabilities ───────────────────────────────────────────────────────

  async listCapabilities(): Promise<LLMCapability[]> {
    const result = await this.apiFetch<unknown>(`${this.baseUrl}/api/v1/capabilities`);
    return unwrapList<LLMCapability>(result);
  }

  async assignCapability(name: string, data: AssignCapabilityInput): Promise<void> {
    await this.apiFetch<unknown>(
      `${this.baseUrl}/api/v1/capabilities/${encodeURIComponent(name)}/assign`,
      { method: 'PUT', body: JSON.stringify(data) },
    );
  }

  async unassignCapability(name: string, modelId: string): Promise<void> {
    await this.deleteRequest(
      `${this.baseUrl}/api/v1/capabilities/${encodeURIComponent(name)}/assign/${encodeURIComponent(modelId)}`,
    );
  }

  async updateCapabilityPriority(capability: string, modelId: string, priority: number): Promise<void> {
    await this.apiFetch<unknown>(
      `${this.baseUrl}/api/v1/capabilities/${encodeURIComponent(capability)}/assign/${encodeURIComponent(modelId)}`,
      { method: 'PATCH', body: JSON.stringify({ priority }) },
    );
  }

  // -- Prompts ────────────────────────────────────────────────────────────

  async listPrompts(): Promise<LLMPrompt[]> {
    const result = await this.apiFetch<unknown>(`${this.baseUrl}/api/v1/prompts`);
    return unwrapList<LLMPrompt>(result);
  }

  async getPrompt(capability: string): Promise<LLMPrompt> {
    return this.apiFetch<LLMPrompt>(
      `${this.baseUrl}/api/v1/prompts/${encodeURIComponent(capability)}`,
    );
  }

  async setPrompt(capability: string, template: string): Promise<LLMPrompt> {
    return this.apiFetch<LLMPrompt>(
      `${this.baseUrl}/api/v1/prompts/${encodeURIComponent(capability)}`,
      { method: 'PUT', body: JSON.stringify({ template }) },
    );
  }

  async deletePrompt(capability: string): Promise<void> {
    await this.deleteRequest(
      `${this.baseUrl}/api/v1/prompts/${encodeURIComponent(capability)}`,
    );
  }

  // -- Generate Fix ───────────────────────────────────────────────────────

  async generateFix(input: {
    readonly wcagCriterion: string;
    readonly issueMessage: string;
    readonly htmlContext: string;
    readonly cssContext?: string;
    readonly orgId?: string;
  }): Promise<{ fixedHtml: string; explanation: string; effort: string }> {
    return this.apiFetch<{ fixedHtml: string; explanation: string; effort: string }>(
      `${this.baseUrl}/api/v1/generate-fix`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  // -- Analyse Report ─────────────────────────────────────────────────────

  async analyseReport(input: {
    readonly siteUrl: string;
    readonly totalIssues: number;
    readonly issuesList: ReadonlyArray<{
      readonly criterion: string;
      readonly message: string;
      readonly count: number;
      readonly level: string;
    }>;
    readonly complianceSummary: string;
    readonly recurringPatterns: readonly string[];
    readonly orgId?: string;
  }): Promise<{
    executiveSummary: string;
    keyFindings: string[];
    patterns: string[];
    priorities: string[];
  }> {
    return this.apiFetch<{
      executiveSummary: string;
      keyFindings: string[];
      patterns: string[];
      priorities: string[];
    }>(`${this.baseUrl}/api/v1/analyse-report`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  // -- OAuth Clients (admin) ──────────────────────────────────────────────

  async listOAuthClients(): Promise<Array<{ id: string; name: string; scopes: string[]; grantTypes: string[]; orgId: string; createdAt: string }>> {
    const result = await this.apiFetch<unknown>(`${this.baseUrl}/api/v1/clients`);
    return unwrapList(result);
  }

  async createOAuthClient(
    name: string,
    scopes: string[],
    grantTypes: string[],
    orgId?: string,
  ): Promise<{ id: string; clientId: string; clientSecret: string; name: string; createdAt: string }> {
    return this.apiFetch(`${this.baseUrl}/api/v1/clients`, {
      method: 'POST',
      body: JSON.stringify({ name, scopes, grantTypes, orgId }),
    });
  }

  async deleteOAuthClient(id: string): Promise<void> {
    await this.deleteRequest(`${this.baseUrl}/api/v1/clients/${encodeURIComponent(id)}`);
  }

  // -- Health / Status ────────────────────────────────────────────────────

  async health(): Promise<LLMHealth> {
    return this.apiFetch<LLMHealth>(`${this.baseUrl}/api/v1/health`);
  }

  async status(): Promise<LLMStatus> {
    return this.apiFetch<LLMStatus>(`${this.baseUrl}/api/v1/status`);
  }
}

/** Create an LLMClient from the configured URL + credentials. Returns null if not configured. */
export function createLLMClient(
  llmUrl: string | undefined,
  clientId: string,
  clientSecret: string,
): LLMClient | null {
  if (!llmUrl) return null;
  return new LLMClient(llmUrl, clientId, clientSecret);
}
