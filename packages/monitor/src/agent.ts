import { loadConfig, type MonitorConfig } from './config.js';
import {
  fetchSource,
  diffContent,
  type SourceType,
  type FetchOptions,
} from './sources.js';
import { analyzeChanges } from './analyzer.js';
import {
  getToken,
  listSources,
  proposeUpdate,
  updateSourceLastChecked,
  type MonitoredSource,
  type UpdateProposal,
} from './compliance-client.js';
import { loadLocalSources } from './local-sources.js';

// ---- Types ----

export interface ScanResult {
  readonly scanned: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly errors: number;
  readonly proposalsCreated: readonly UpdateProposal[];
  readonly errorDetails: readonly { readonly sourceId: string; readonly error: string }[];
  readonly scannedAt: string;
}

export interface AgentOptions {
  readonly config?: MonitorConfig;
  readonly fetchOptions?: FetchOptions;
  /** Path to a local sources JSON file (--sources-file). Enables standalone mode. */
  readonly sourcesFile?: string;
  /** Organisation ID for multi-tenant scoping (omit for system-wide). */
  readonly orgId?: string;
}

// ---- Main scan loop ----

/**
 * Run one full scan cycle:
 * 1. Obtain an access token from the compliance service.
 * 2. List all monitored sources.
 * 3. For each source, fetch the current content and compare its hash.
 * 4. If changed, create an UpdateProposal via the compliance API.
 * 5. Update the source's lastChecked timestamp and hash.
 * 6. Return a summary.
 */
export async function runScan(options: AgentOptions = {}): Promise<ScanResult> {
  const config = options.config ?? loadConfig();
  const orgId = options.orgId ?? config.orgId;
  const fetchOptions: FetchOptions = {
    userAgent: config.userAgent,
    ...options.fetchOptions,
  };

  const baseUrl = config.complianceUrl;

  // Determine whether we can reach the compliance service or must use local sources
  let sources: readonly MonitoredSource[];
  let token: string | undefined;
  let standaloneMode = false;

  if (options.sourcesFile !== undefined) {
    // Explicit local sources file — go straight to standalone mode
    sources = await loadLocalSources(options.sourcesFile);
    standaloneMode = true;
    console.warn('[monitor] Using local source config from', options.sourcesFile);
  } else {
    try {
      // Step 1: Get token
      token = await getToken(
        baseUrl,
        config.complianceClientId,
        config.complianceClientSecret,
      );

      // Step 2: List sources
      sources = await listSources(baseUrl, token, orgId);
    } catch {
      // Compliance service unavailable — try local fallback
      console.warn('[monitor] Compliance service unavailable, using local source config');
      sources = await loadLocalSources();
      standaloneMode = true;
    }
  }

  const proposalsCreated: UpdateProposal[] = [];
  const errorDetails: { sourceId: string; error: string }[] = [];
  let unchanged = 0;

  // Step 3–5: Process each source
  for (const source of sources) {
    try {
      const fetched = await fetchSource(
        source.url,
        source.type as SourceType,
        fetchOptions,
      );

      const previousHash = source.lastContentHash ?? '';
      const diff = diffContent(previousHash, fetched.contentHash);

      if (!diff.changed) {
        unchanged++;
        // Still update lastCheckedAt even when unchanged (only when connected)
        if (!standaloneMode && token !== undefined) {
          await updateSourceLastChecked(baseUrl, token, source.id, fetched.contentHash, orgId);
        }
        continue;
      }

      // Content changed — analyse the diff
      const analysis = analyzeChanges(
        source.type as SourceType,
        '', // We don't cache old text; use hash-only path for changed detection
        fetched.content,
      );

      if (standaloneMode) {
        // In standalone mode, log changes but skip proposal creation
        console.warn(
          `[monitor] Change detected in "${source.name}" (${source.url}): ${analysis.summary}`,
        );
      } else if (token !== undefined) {
        // Build a meaningful summary
        const proposalSummary = buildProposalSummary(source, analysis.summary);

        // Create update proposal
        const proposal = await proposeUpdate(baseUrl, token, {
          source: source.url,
          type: 'amendment',
          summary: proposalSummary,
          proposedChanges: {
            action: 'update',
            entityType: 'regulation',
            after: {
              sourceUrl: source.url,
              contentHash: fetched.contentHash,
              detectedChangeAt: fetched.fetchedAt,
              analysisSummary: analysis.summary,
              addedSections: analysis.sections.added,
              removedSections: analysis.sections.removed,
              modifiedSections: analysis.sections.modified,
            },
          },
        }, orgId);

        proposalsCreated.push(proposal);

        // Update source tracking
        await updateSourceLastChecked(baseUrl, token, source.id, fetched.contentHash, orgId);
      }
    } catch (err) {
      errorDetails.push({
        sourceId: source.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    scanned: sources.length,
    changed: standaloneMode ? sources.length - unchanged - errorDetails.length : proposalsCreated.length,
    unchanged,
    errors: errorDetails.length,
    proposalsCreated,
    errorDetails,
    scannedAt: new Date().toISOString(),
  };
}

function buildProposalSummary(source: MonitoredSource, analysisSummary: string): string {
  return `Change detected in "${source.name}" (${source.url}): ${analysisSummary}`;
}

// ---- Status ----

export interface MonitorStatus {
  readonly sourcesCount: number;
  readonly pendingProposals: number;
  readonly lastScanAt: string | null;
  readonly complianceUrl: string;
}

/**
 * Get the current monitor status from the compliance service.
 */
export async function getStatus(options: AgentOptions = {}): Promise<MonitorStatus> {
  const config = options.config ?? loadConfig();
  const orgId = options.orgId ?? config.orgId;
  const baseUrl = config.complianceUrl;

  const token = await getToken(
    baseUrl,
    config.complianceClientId,
    config.complianceClientSecret,
  );

  const sources = await listSources(baseUrl, token, orgId);

  // Find the most recent lastCheckedAt across all sources
  const lastScanAt =
    sources
      .map((s) => s.lastCheckedAt)
      .filter((t): t is string => t !== undefined)
      .sort()
      .at(-1) ?? null;

  return {
    sourcesCount: sources.length,
    pendingProposals: 0, // Would need a dedicated endpoint; placeholder for now
    lastScanAt,
    complianceUrl: baseUrl,
  };
}
