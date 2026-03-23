import type { DiscoveredUrl, ScanError, PageResult, AccessibilityIssue, ProgressListener } from '../types.js';
import type { WebserviceClient, Pa11yIssue, Pa11yResult } from './webservice-client.js';
import type { WebservicePool } from './webservice-client.js';
import type { DirectScanner } from './direct-scanner.js';

export interface ScanOptions {
  readonly standard: 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA';
  readonly concurrency?: number;
  readonly timeout: number;
  readonly pollTimeout: number;
  readonly ignore: readonly string[];
  readonly hideElements: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly wait: number;
  readonly onProgress?: ProgressListener;
  /** Pa11y test runner: 'htmlcs' (default) or 'axe'. Passed through to the webservice task. */
  readonly runner?: 'htmlcs' | 'axe';
}

export interface ScanResults {
  readonly pages: PageResult[];
  readonly errors: ScanError[];
}

function mapIssues(issues: readonly Pa11yIssue[]): AccessibilityIssue[] {
  return issues.map((issue) => ({
    code: issue.code,
    type: issue.type as 'error' | 'warning' | 'notice',
    message: issue.message,
    selector: issue.selector,
    context: issue.context,
    fixSuggestion: `Refer to WCAG documentation for ${issue.code}`,
  }));
}

function isCompleted(results: Pa11yResult[]): boolean {
  return results.length > 0 && results[0].date !== undefined && results[0].date !== null && results[0].date !== '';
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBackoffDelay(attempt: number, pollTimeout: number): number {
  // Use very short delays when pollTimeout is small (< 1000ms) for fast tests
  if (pollTimeout < 1000) {
    return 10; // 10ms for test mode
  }
  const base = 1000;
  const max = 10000;
  const exponential = Math.min(base * Math.pow(2, attempt), max);
  const jitter = (Math.random() - 0.5) * 1000; // ±500ms
  return Math.max(0, exponential + jitter);
}

async function pollForResults(
  client: WebserviceClient,
  taskId: string,
  pollTimeout: number,
): Promise<Pa11yResult[] | null> {
  const deadline = Date.now() + pollTimeout;
  let attempt = 0;

  while (Date.now() < deadline) {
    const results = await client.getResults(taskId);
    if (isCompleted(results)) {
      return results;
    }
    const delay = getBackoffDelay(attempt, pollTimeout);
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(delay, remaining));
    attempt++;
  }

  return null;
}

async function scanUrl(
  discoveredUrl: DiscoveredUrl,
  client: WebserviceClient,
  options: ScanOptions,
  index: number,
  total: number,
): Promise<{ page?: PageResult; error?: ScanError }> {
  const { url, discoveryMethod } = discoveredUrl;

  options.onProgress?.({
    type: 'scan:start',
    url,
    current: index + 1,
    total,
    timestamp: new Date().toISOString(),
  });

  let taskId: string | undefined;

  try {
    const task = await client.createTask({
      name: `scan-${url}`,
      url,
      standard: options.standard,
      ignore: options.ignore,
      timeout: options.timeout,
      wait: options.wait,
      hideElements: options.hideElements || undefined,
      headers: options.headers,
      ...(options.runner !== undefined ? { runner: options.runner } : {}),
    });

    taskId = task.id;
    await client.runTask(taskId);

    // First poll attempt
    let results = await pollForResults(client, taskId, options.pollTimeout);

    let retried = false;
    if (results === null) {
      // Retry once on timeout
      retried = true;
      await client.runTask(taskId);
      results = await pollForResults(client, taskId, options.pollTimeout);
    }

    if (results === null) {
      // Both attempts timed out
      await client.deleteTask(taskId);

      const scanError: ScanError = {
        url,
        code: 'TIMEOUT',
        message: `Scan timed out after ${options.pollTimeout}ms`,
        retried,
      };

      options.onProgress?.({
        type: 'scan:error',
        url,
        current: index + 1,
        total,
        timestamp: new Date().toISOString(),
        error: scanError.message,
      });

      return { error: scanError };
    }

    const pa11yResult = results[0];
    const rawIssues = pa11yResult.results ?? pa11yResult.issues ?? [];
    const issues = mapIssues(rawIssues);

    await client.deleteTask(taskId);

    const page: PageResult = {
      url,
      discoveryMethod,
      issueCount: issues.length,
      issues,
    };

    options.onProgress?.({
      type: 'scan:complete',
      url,
      current: index + 1,
      total,
      timestamp: new Date().toISOString(),
    });

    return { page };
  } catch (err) {
    if (taskId !== undefined) {
      try {
        await client.deleteTask(taskId);
      } catch {
        // Best-effort cleanup
      }
    }

    const message = err instanceof Error ? err.message : String(err);
    const scanError: ScanError = {
      url,
      code: 'WEBSERVICE_ERROR',
      message,
      retried: false,
    };

    options.onProgress?.({
      type: 'scan:error',
      url,
      current: index + 1,
      total,
      timestamp: new Date().toISOString(),
      error: message,
    });

    return { error: scanError };
  }
}

/**
 * Scan a single URL using the DirectScanner (pa11y npm library).
 * No create/run/poll/delete cycle — pa11y runs the scan inline.
 */
async function scanUrlDirect(
  discoveredUrl: DiscoveredUrl,
  scanner: DirectScanner,
  options: ScanOptions,
  index: number,
  total: number,
): Promise<{ page?: PageResult; error?: ScanError }> {
  const { url, discoveryMethod } = discoveredUrl;

  options.onProgress?.({
    type: 'scan:start',
    url,
    current: index + 1,
    total,
    timestamp: new Date().toISOString(),
  });

  try {
    const result = await scanner.scan(url, {
      standard: options.standard,
      timeout: options.timeout,
      wait: options.wait,
      hideElements: options.hideElements || undefined,
      headers: options.headers,
      runner: options.runner,
    });

    const issues: AccessibilityIssue[] = result.issues.map((issue) => ({
      code: issue.code,
      type: issue.type as 'error' | 'warning' | 'notice',
      message: issue.message,
      selector: issue.selector,
      context: issue.context,
      fixSuggestion: `Refer to WCAG documentation for ${issue.code}`,
    }));

    const page: PageResult = {
      url: result.url,
      discoveryMethod,
      issueCount: issues.length,
      issues,
    };

    options.onProgress?.({
      type: 'scan:complete',
      url,
      current: index + 1,
      total,
      timestamp: new Date().toISOString(),
    });

    return { page };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const scanError: ScanError = {
      url,
      code: 'WEBSERVICE_ERROR',
      message,
      retried: false,
    };

    options.onProgress?.({
      type: 'scan:error',
      url,
      current: index + 1,
      total,
      timestamp: new Date().toISOString(),
      error: message,
    });

    return { error: scanError };
  }
}

/** Checks whether a value is a WebservicePool (has a `next` method). */
function isPool(clientOrPool: WebserviceClient | WebservicePool): clientOrPool is WebservicePool {
  return typeof (clientOrPool as WebservicePool).next === 'function'
    && typeof (clientOrPool as WebservicePool).size === 'number';
}

/** Checks whether a value is a DirectScanner (has a `scan` method but no `next`). */
function isDirectScanner(value: unknown): value is DirectScanner {
  return typeof (value as DirectScanner).scan === 'function'
    && typeof (value as WebservicePool).next !== 'function';
}

export async function scanUrls(
  urls: DiscoveredUrl[],
  clientOrPool: WebserviceClient | WebservicePool | DirectScanner,
  options: ScanOptions,
): Promise<ScanResults> {
  const concurrency = options.concurrency ?? 5;
  const total = urls.length;
  const pages: PageResult[] = [];
  const errors: ScanError[] = [];

  const useDirectScanner = isDirectScanner(clientOrPool);

  // Worker pool pattern: shared queue with N concurrent workers
  const queue = urls.map((url, index) => ({ url, index }));
  let queueIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      // Claim next item atomically
      const current = queueIndex;
      if (current >= queue.length) break;
      queueIndex++;

      const { url, index } = queue[current];

      let result: { page?: PageResult; error?: ScanError };

      if (useDirectScanner) {
        result = await scanUrlDirect(url, clientOrPool as DirectScanner, options, index, total);
      } else {
        // Pick the next client from the pool (round-robin) or use the single client
        const wsClientOrPool = clientOrPool as WebserviceClient | WebservicePool;
        const client = isPool(wsClientOrPool) ? wsClientOrPool.next() : wsClientOrPool;
        result = await scanUrl(url, client, options, index, total);
      }

      if (result.page !== undefined) {
        pages.push(result.page);
      }
      if (result.error !== undefined) {
        errors.push(result.error);
      }
    }
  }

  // Launch N workers in parallel
  const workerCount = Math.min(concurrency, total);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  return { pages, errors };
}
