export interface CreateTaskInput {
  readonly name: string;
  readonly url: string;
  readonly standard: string;
  readonly ignore?: readonly string[];
  readonly timeout?: number;
  readonly wait?: number;
  readonly hideElements?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface Pa11yTask {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly [key: string]: unknown;
}

export interface Pa11yResult {
  readonly date: string;
  readonly results?: readonly Pa11yIssue[];  // pa11y-webservice uses 'results', not 'issues'
  readonly issues?: readonly Pa11yIssue[];   // kept for backward compat
  readonly [key: string]: unknown;
}

export interface Pa11yIssue {
  readonly code: string;
  readonly type: string;
  readonly message: string;
  readonly selector: string;
  readonly context: string;
  readonly [key: string]: unknown;
}

export class WebserviceClient {
  constructor(
    private readonly baseUrl: string,
    private readonly headers: Readonly<Record<string, string>>,
  ) {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
        ...(options.headers as Record<string, string> | undefined),
      },
    });
    if (!response.ok) {
      throw new Error(`Pa11y webservice error: ${response.status} ${response.statusText} for ${options.method ?? 'GET'} ${path}`);
    }
    if (response.status === 204 || response.status === 202) return undefined as T;
    return (await response.json()) as T;
  }

  async createTask(input: CreateTaskInput): Promise<Pa11yTask> {
    return this.request<Pa11yTask>('/tasks', { method: 'POST', body: JSON.stringify(input) });
  }

  async runTask(taskId: string): Promise<void> {
    await this.request<void>(`/tasks/${taskId}/run`, { method: 'POST' });
  }

  async getResults(taskId: string): Promise<Pa11yResult[]> {
    return this.request<Pa11yResult[]>(`/tasks/${taskId}/results?full=true`);
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.request<void>(`/tasks/${taskId}`, { method: 'DELETE' });
  }
}
