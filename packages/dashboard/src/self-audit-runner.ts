/**
 * Self-audit runner: scans dashboard pages via the pa11y webservice API.
 *
 * Uses the same pa11y webservice HTTP API that the core scanner uses,
 * but implemented inline to avoid a dependency on @pally-agent/core.
 */

import type { AuditIssue, AuditPageResult } from './self-audit.js';

// -------------------------------------------------------------------------
// Pa11y webservice HTTP helpers
// -------------------------------------------------------------------------

interface Pa11yTask {
  readonly id: string;
}

interface Pa11yIssue {
  readonly code: string;
  readonly type: string;
  readonly message: string;
  readonly selector: string;
  readonly context: string;
}

interface Pa11yResult {
  readonly date?: string;
  readonly results?: readonly Pa11yIssue[];
  readonly issues?: readonly Pa11yIssue[];
}

async function wsRequest<T>(baseUrl: string, path: string, init: RequestInit = {}): Promise<T> {
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
  });

  if (!response.ok) {
    throw new Error(`pa11y webservice ${init.method ?? 'GET'} ${path}: ${response.status} ${response.statusText}`);
  }

  if (response.status === 204 || response.status === 202) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function createTask(wsUrl: string, pageUrl: string): Promise<string> {
  const task = await wsRequest<Pa11yTask>(wsUrl, '/tasks', {
    method: 'POST',
    body: JSON.stringify({
      name: `self-audit-${pageUrl}`,
      url: pageUrl,
      standard: 'WCAG2AA',
      timeout: 30000,
      wait: 0,
    }),
  });
  return task.id;
}

async function runTask(wsUrl: string, taskId: string): Promise<void> {
  await wsRequest<void>(wsUrl, `/tasks/${taskId}/run`, { method: 'POST' });
}

async function getResults(wsUrl: string, taskId: string): Promise<Pa11yResult[]> {
  return wsRequest<Pa11yResult[]>(wsUrl, `/tasks/${taskId}/results?full=true`);
}

async function deleteTask(wsUrl: string, taskId: string): Promise<void> {
  await wsRequest<void>(wsUrl, `/tasks/${taskId}`, { method: 'DELETE' });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollResults(wsUrl: string, taskId: string, timeoutMs: number): Promise<Pa11yResult[] | null> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    const results = await getResults(wsUrl, taskId);
    if (results.length > 0 && results[0].date) {
      return results;
    }

    const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(delay, remaining));
    attempt++;
  }

  return null;
}

// -------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------

/**
 * Scans a list of page URLs via the pa11y webservice and returns per-page results.
 */
export async function runSelfAudit(
  pageUrls: readonly string[],
  webserviceUrl: string,
): Promise<AuditPageResult[]> {
  const results: AuditPageResult[] = [];

  for (const pageUrl of pageUrls) {
    let taskId: string | undefined;

    try {
      taskId = await createTask(webserviceUrl, pageUrl);
      await runTask(webserviceUrl, taskId);

      const pollTimeout = 60_000;
      const pa11yResults = await pollResults(webserviceUrl, taskId, pollTimeout);

      if (pa11yResults === null) {
        results.push({ url: pageUrl, issues: [], error: 'Scan timed out' });
      } else {
        const raw = pa11yResults[0].results ?? pa11yResults[0].issues ?? [];
        const issues: AuditIssue[] = raw.map((i) => ({
          code: i.code,
          type: i.type as 'error' | 'warning' | 'notice',
          message: i.message,
          selector: i.selector,
          context: i.context,
        }));
        results.push({ url: pageUrl, issues, error: null });
      }

      await deleteTask(webserviceUrl, taskId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ url: pageUrl, issues: [], error: message });

      if (taskId !== undefined) {
        try {
          await deleteTask(webserviceUrl, taskId);
        } catch {
          // best-effort cleanup
        }
      }
    }
  }

  return results;
}
