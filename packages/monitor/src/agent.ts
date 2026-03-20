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
  const fetchOptions: FetchOptions = {
    userAgent: config.userAgent,
    ...options.fetchOptions,
  };

  const baseUrl = config.complianceUrl;

  // Step 1: Get token
  const token = await getToken(
    baseUrl,
    config.complianceClientId,
    config.complianceClientSecret,
  );

  // Step 2: List sources
  const sources = await listSources(baseUrl, token);

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
        // Still update lastCheckedAt even when unchanged
        await updateSourceLastChecked(baseUrl, token, source.id, fetched.contentHash);
        continue;
      }

      // Content changed — analyse the diff
      const analysis = analyzeChanges(
        source.type as SourceType,
        '', // We don't cache old text; use hash-only path for changed detection
        fetched.content,
      );

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
      });

      proposalsCreated.push(proposal);

      // Update source tracking
      await updateSourceLastChecked(baseUrl, token, source.id, fetched.contentHash);
    } catch (err) {
      errorDetails.push({
        sourceId: source.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    scanned: sources.length,
    changed: proposalsCreated.length,
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
  const baseUrl = config.complianceUrl;

  const token = await getToken(
    baseUrl,
    config.complianceClientId,
    config.complianceClientSecret,
  );

  const sources = await listSources(baseUrl, token);

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
