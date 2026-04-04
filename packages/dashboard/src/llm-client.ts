// ── LLM Service Client ──────────────────────────────────────────────────────
// Proxies dashboard requests to the @luqen/llm service.
// Authentication: Bearer token from LLM_API_KEY env var.

async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const apiKey = process.env['LLM_API_KEY'] ?? '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${body}`);
  }

  return response.json() as Promise<T>;
}

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
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateProviderInput {
  readonly name: string;
  readonly type: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly enabled?: boolean;
}

export interface UpdateProviderInput {
  readonly name?: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly enabled?: boolean;
}

// ── Model types ─────────────────────────────────────────────────────────────

export interface LLMModel {
  readonly id: string;
  readonly providerId: string;
  readonly externalId: string;
  readonly name: string;
  readonly contextWindow?: number;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateModelInput {
  readonly providerId: string;
  readonly externalId: string;
  readonly name: string;
  readonly contextWindow?: number;
  readonly enabled?: boolean;
}

// ── Capability types ────────────────────────────────────────────────────────

export interface LLMCapability {
  readonly name: string;
  readonly description?: string;
  readonly assignedModels: readonly string[];
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

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  // -- Providers ──────────────────────────────────────────────────────────

  async listProviders(): Promise<LLMProvider[]> {
    const result = await apiFetch<unknown>(`${this.baseUrl}/api/v1/providers`);
    return unwrapList<LLMProvider>(result);
  }

  async createProvider(data: CreateProviderInput): Promise<LLMProvider> {
    return apiFetch<LLMProvider>(`${this.baseUrl}/api/v1/providers`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateProvider(id: string, data: UpdateProviderInput): Promise<LLMProvider> {
    return apiFetch<LLMProvider>(`${this.baseUrl}/api/v1/providers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteProvider(id: string): Promise<void> {
    const apiKey = process.env['LLM_API_KEY'] ?? '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const response = await fetch(`${this.baseUrl}/api/v1/providers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
      body: '{}',
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${body}`);
    }
  }

  async testProvider(id: string): Promise<{ ok: boolean; message?: string }> {
    return apiFetch<{ ok: boolean; message?: string }>(
      `${this.baseUrl}/api/v1/providers/${encodeURIComponent(id)}/test`,
      { method: 'POST', body: '{}' },
    );
  }

  async listRemoteModels(providerId: string): Promise<RemoteModel[]> {
    const result = await apiFetch<unknown>(
      `${this.baseUrl}/api/v1/providers/${encodeURIComponent(providerId)}/models`,
    );
    return unwrapList<RemoteModel>(result);
  }

  // -- Models ─────────────────────────────────────────────────────────────

  async listModels(): Promise<LLMModel[]> {
    const result = await apiFetch<unknown>(`${this.baseUrl}/api/v1/models`);
    return unwrapList<LLMModel>(result);
  }

  async createModel(data: CreateModelInput): Promise<LLMModel> {
    return apiFetch<LLMModel>(`${this.baseUrl}/api/v1/models`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteModel(id: string): Promise<void> {
    const apiKey = process.env['LLM_API_KEY'] ?? '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const response = await fetch(`${this.baseUrl}/api/v1/models/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
      body: '{}',
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${body}`);
    }
  }

  // -- Capabilities ───────────────────────────────────────────────────────

  async listCapabilities(): Promise<LLMCapability[]> {
    const result = await apiFetch<unknown>(`${this.baseUrl}/api/v1/capabilities`);
    return unwrapList<LLMCapability>(result);
  }

  async assignCapability(name: string, data: AssignCapabilityInput): Promise<void> {
    await apiFetch<unknown>(
      `${this.baseUrl}/api/v1/capabilities/${encodeURIComponent(name)}/assign`,
      { method: 'PUT', body: JSON.stringify(data) },
    );
  }

  async unassignCapability(name: string, modelId: string): Promise<void> {
    const apiKey = process.env['LLM_API_KEY'] ?? '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const response = await fetch(
      `${this.baseUrl}/api/v1/capabilities/${encodeURIComponent(name)}/assign/${encodeURIComponent(modelId)}`,
      { method: 'DELETE', headers, body: '{}' },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${body}`);
    }
  }

  // -- Prompts ────────────────────────────────────────────────────────────

  async listPrompts(): Promise<LLMPrompt[]> {
    const result = await apiFetch<unknown>(`${this.baseUrl}/api/v1/prompts`);
    return unwrapList<LLMPrompt>(result);
  }

  async getPrompt(capability: string): Promise<LLMPrompt> {
    return apiFetch<LLMPrompt>(
      `${this.baseUrl}/api/v1/prompts/${encodeURIComponent(capability)}`,
    );
  }

  async setPrompt(capability: string, template: string): Promise<LLMPrompt> {
    return apiFetch<LLMPrompt>(
      `${this.baseUrl}/api/v1/prompts/${encodeURIComponent(capability)}`,
      { method: 'PUT', body: JSON.stringify({ template }) },
    );
  }

  async deletePrompt(capability: string): Promise<void> {
    const apiKey = process.env['LLM_API_KEY'] ?? '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const response = await fetch(
      `${this.baseUrl}/api/v1/prompts/${encodeURIComponent(capability)}`,
      { method: 'DELETE', headers, body: '{}' },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${body}`);
    }
  }

  // -- Health / Status ────────────────────────────────────────────────────

  async health(): Promise<LLMHealth> {
    return apiFetch<LLMHealth>(`${this.baseUrl}/api/v1/health`);
  }

  async status(): Promise<LLMStatus> {
    return apiFetch<LLMStatus>(`${this.baseUrl}/api/v1/status`);
  }
}

/** Create an LLMClient from the configured URL. Returns null if not configured. */
export function createLLMClient(llmUrl: string | undefined): LLMClient | null {
  if (!llmUrl) return null;
  return new LLMClient(llmUrl);
}
