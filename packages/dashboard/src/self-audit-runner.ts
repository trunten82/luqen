/**
 * Self-audit runner: scans dashboard pages for accessibility issues.
 *
 * Default mode: uses pa11y npm library directly via @luqen/core DirectScanner.
 * Legacy mode: when webserviceUrl is provided, uses the pa11y webservice HTTP API.
 */

import type { AuditIssue, AuditPageResult } from './self-audit.js';

// -------------------------------------------------------------------------
// Pa11y webservice HTTP helpers (legacy fallback)
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
// Direct scan (default) — uses pa11y npm library via DirectScanner
// -------------------------------------------------------------------------

async function scanPageDirect(pageUrl: string): Promise<AuditPageResult> {
  try {
    const { DirectScanner } = await import(
      /* webpackIgnore: true */ '@luqen/core'
    );
    const scanner = new DirectScanner();
    const result = await scanner.scan(pageUrl, {
      standard: 'WCAG2AA',
      timeout: 30000,
      wait: 0,
    });

    const issues: AuditIssue[] = result.issues.map((i: { code: string; type: string; message: string; selector: string; context: string }) => ({
      code: i.code,
      type: i.type as 'error' | 'warning' | 'notice',
      message: i.message,
      selector: i.selector,
      context: i.context,
    }));

    return { url: pageUrl, issues, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { url: pageUrl, issues: [], error: message };
  }
}

// -------------------------------------------------------------------------
// Webservice scan (legacy fallback)
// -------------------------------------------------------------------------

async function scanPageViaWebservice(pageUrl: string, webserviceUrl: string): Promise<AuditPageResult> {
  let taskId: string | undefined;

  try {
    taskId = await createTask(webserviceUrl, pageUrl);
    await runTask(webserviceUrl, taskId);

    const pollTimeout = 60_000;
    const pa11yResults = await pollResults(webserviceUrl, taskId, pollTimeout);

    if (pa11yResults === null) {
      await deleteTask(webserviceUrl, taskId);
      return { url: pageUrl, issues: [], error: 'Scan timed out' };
    }

    const raw = pa11yResults[0].results ?? pa11yResults[0].issues ?? [];
    const issues: AuditIssue[] = raw.map((i) => ({
      code: i.code,
      type: i.type as 'error' | 'warning' | 'notice',
      message: i.message,
      selector: i.selector,
      context: i.context,
    }));

    await deleteTask(webserviceUrl, taskId);
    return { url: pageUrl, issues, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (taskId !== undefined) {
      try {
        await deleteTask(webserviceUrl, taskId);
      } catch {
        // best-effort cleanup
      }
    }

    return { url: pageUrl, issues: [], error: message };
  }
}

// -------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------

/**
 * Scans a list of page URLs and returns per-page results.
 *
 * When webserviceUrl is provided, uses the legacy pa11y webservice HTTP API.
 * When omitted (or undefined), uses the direct pa11y npm library.
 */
export async function runSelfAudit(
  pageUrls: readonly string[],
  webserviceUrl?: string,
): Promise<AuditPageResult[]> {
  const results: AuditPageResult[] = [];

  for (const pageUrl of pageUrls) {
    if (webserviceUrl !== undefined) {
      results.push(await scanPageViaWebservice(pageUrl, webserviceUrl));
    } else {
      results.push(await scanPageDirect(pageUrl));
    }
  }

  return results;
}
