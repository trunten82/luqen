/**
 * Scan Service — business logic for scan orchestration.
 *
 * Extracted from routes/scan.ts to keep route handlers thin.
 * Handles URL validation, SSRF protection, scan record creation, and
 * scan initiation via the orchestrator. Does NOT handle HTTP
 * request/response concerns.
 */

import { randomUUID } from 'node:crypto';
import type { StorageAdapter } from '../db/index.js';
import type { ScanOrchestrator } from '../scanner/orchestrator.js';
import type { DashboardConfig } from '../config.js';
import type { ScanRecord } from '../db/types.js';

// ── Constants ────────────────────────────────────────────────────────────────

export const VALID_STANDARDS = ['WCAG2A', 'WCAG2AA', 'WCAG2AAA'] as const;
export type WcagStandard = (typeof VALID_STANDARDS)[number];

const VALID_RUNNERS = ['htmlcs', 'axe'] as const;

// ── Input types ──────────────────────────────────────────────────────────────

export interface InitiateScanInput {
  readonly siteUrl: string;
  readonly standard?: string;
  readonly scanMode?: string;
  readonly jurisdictions?: string | string[];
  readonly concurrency?: string | number;
  readonly maxPages?: string | number;
  readonly runner?: string;
  readonly incremental?: string | boolean;
}

export interface ScanContext {
  readonly username: string;
  readonly orgId: string;
  readonly complianceToken: string;
}

// ── Result types ─────────────────────────────────────────────────────────────

export interface ScanValidationError {
  readonly ok: false;
  readonly error: string;
}

export interface ScanInitiationSuccess {
  readonly ok: true;
  readonly scanId: string;
}

export type ScanInitiationResult = ScanValidationError | ScanInitiationSuccess;

export interface ScanProgressResult {
  readonly ok: true;
  readonly scan: ScanRecord;
}

export type ScanLookupResult = ScanValidationError | ScanProgressResult;

// ── Validation helpers (pure functions) ──────────────────────────────────────

function normalizeJurisdictions(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

/**
 * SSRF protection: block private/internal IP ranges and reserved hostnames.
 */
function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '0.0.0.0' ||
    h.startsWith('10.') ||
    h.startsWith('192.168.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h) ||
    h === '169.254.169.254' ||
    h.startsWith('169.254.') ||
    h.endsWith('.internal') ||
    h.endsWith('.local')
  );
}

/**
 * Validate and parse the scan URL. Returns the parsed URL or an error string.
 */
export function validateScanUrl(rawUrl: string): { url: URL } | { error: string } {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return { error: 'Please enter a URL to scan.' };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl.trim());
  } catch {
    return { error: 'Please enter a valid URL (e.g., https://example.com).' };
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    return { error: 'URL must use http or https' };
  }

  if (isPrivateHostname(parsedUrl.hostname)) {
    return { error: 'Scanning internal or private addresses is not allowed.' };
  }

  return { url: parsedUrl };
}

/**
 * Pre-validate that the URL is reachable before starting a scan.
 * Returns undefined on success, or an error string if the site is unreachable.
 */
export async function probeUrl(url: URL): Promise<string | undefined> {
  try {
    const probe = await fetch(url.toString(), {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
    if (!probe.ok && probe.status >= 500) {
      return `Site returned ${probe.status} — check the URL and try again.`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
      return 'Domain not found — check the URL for typos.';
    }
    if (msg.includes('ECONNREFUSED')) {
      return 'Connection refused — the server is not responding.';
    }
    if (msg.includes('TimeoutError') || msg.includes('timed out')) {
      return 'Connection timed out — the site took too long to respond.';
    }
    // Other network errors — let the scan proceed (WAFs may block HEAD)
  }
  return undefined;
}

// ── Service class ────────────────────────────────────────────────────────────

export class ScanService {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly orchestrator: ScanOrchestrator,
    private readonly config: DashboardConfig,
  ) {}

  /**
   * Validate inputs, create a scan record, and start the scanner.
   * Returns the scan ID on success or an error message on validation failure.
   */
  async initiateScan(
    input: InitiateScanInput,
    context: ScanContext,
  ): Promise<ScanInitiationResult> {
    // 1. Validate URL
    const urlResult = validateScanUrl(input.siteUrl);
    if ('error' in urlResult) {
      return { ok: false, error: urlResult.error };
    }
    const { url: parsedUrl } = urlResult;

    // 2. Pre-validate reachability
    const probeError = await probeUrl(parsedUrl);
    if (probeError !== undefined) {
      return { ok: false, error: probeError };
    }

    // 3. Validate standard
    const standard = (input.standard ?? 'WCAG2AA') as string;
    if (!VALID_STANDARDS.includes(standard as WcagStandard)) {
      return { ok: false, error: `standard must be one of: ${VALID_STANDARDS.join(', ')}` };
    }

    // 4. Validate concurrency
    const rawConcurrency = input.concurrency !== undefined
      ? (typeof input.concurrency === 'string' ? parseInt(input.concurrency, 10) : input.concurrency)
      : this.config.maxConcurrentScans;
    if (isNaN(rawConcurrency) || rawConcurrency < 1 || rawConcurrency > 10) {
      return { ok: false, error: 'concurrency must be between 1 and 10' };
    }

    // 5. Validate jurisdictions
    const jurisdictions = normalizeJurisdictions(input.jurisdictions);
    if (jurisdictions.length > 50) {
      return { ok: false, error: 'Maximum 50 jurisdictions per scan' };
    }

    // 6. Validate runner
    const runner = input.runner !== undefined && (VALID_RUNNERS as readonly string[]).includes(input.runner)
      ? (input.runner as 'htmlcs' | 'axe')
      : this.config.runner;

    // 7. Validate maxPages
    const rawMaxPages = input.maxPages !== undefined
      ? (typeof input.maxPages === 'string' ? parseInt(input.maxPages, 10) : input.maxPages)
      : undefined;
    const maxPages = (rawMaxPages !== undefined && !isNaN(rawMaxPages) && rawMaxPages >= 1 && rawMaxPages <= 1000)
      ? rawMaxPages
      : this.config.maxPages;

    // 8. Determine scan mode and incremental flag
    const scanMode = input.scanMode === 'single' ? 'single' : 'site';
    const incremental = input.incremental === 'true' || input.incremental === true;

    // 9. Create scan record
    const scanId = randomUUID();
    await this.storage.scans.createScan({
      id: scanId,
      siteUrl: parsedUrl.toString(),
      standard,
      jurisdictions,
      createdBy: context.username,
      createdAt: new Date().toISOString(),
      orgId: context.orgId,
    });

    // 10. Start the scanner
    this.orchestrator.startScan(scanId, {
      siteUrl: parsedUrl.toString(),
      standard,
      concurrency: rawConcurrency,
      jurisdictions,
      scanMode,
      ...(this.config.webserviceUrl !== undefined ? { webserviceUrl: this.config.webserviceUrl } : {}),
      ...(this.config.webserviceUrls !== undefined && this.config.webserviceUrls.length > 0
        ? { webserviceUrls: this.config.webserviceUrls }
        : {}),
      complianceUrl: this.config.complianceUrl,
      complianceToken: context.complianceToken,
      maxPages,
      ...(runner !== undefined ? { runner } : {}),
      ...(incremental ? { incremental, orgId: context.orgId } : {}),
    });

    return { ok: true, scanId };
  }

  /**
   * Look up a scan by ID with org-level access control.
   */
  async getScanForOrg(scanId: string, orgId: string): Promise<ScanLookupResult> {
    const scan = await this.storage.scans.getScan(scanId);
    if (scan === null) {
      return { ok: false, error: 'Scan not found' };
    }

    if (scan.orgId !== orgId && scan.orgId !== 'system') {
      return { ok: false, error: 'Scan not found' };
    }

    return { ok: true, scan };
  }
}
