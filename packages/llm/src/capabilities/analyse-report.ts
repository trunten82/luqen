import type { DbAdapter } from '../db/adapter.js';
import type { LLMProviderAdapter } from '../providers/types.js';
import { buildAnalyseReportPrompt, type AnalyseReportPromptInput } from '../prompts/analyse-report.js';
import { CapabilityExhaustedError, CapabilityNotConfiguredError, type CapabilityResult } from './types.js';

export interface AnalyseReportInput {
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
}

export interface AnalyseReportResult {
  readonly executiveSummary: string;
  readonly keyFindings: readonly string[];
  readonly patterns: readonly string[];
  readonly priorities: readonly string[];
}

export function parseAnalyseReportResponse(text: string): AnalyseReportResult {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      executiveSummary: typeof parsed['executiveSummary'] === 'string' ? parsed['executiveSummary'] : '',
      keyFindings: Array.isArray(parsed['keyFindings'])
        ? (parsed['keyFindings'] as unknown[]).filter((x): x is string => typeof x === 'string')
        : [],
      patterns: Array.isArray(parsed['patterns'])
        ? (parsed['patterns'] as unknown[]).filter((x): x is string => typeof x === 'string')
        : [],
      priorities: Array.isArray(parsed['priorities'])
        ? (parsed['priorities'] as unknown[]).filter((x): x is string => typeof x === 'string')
        : [],
    };
  } catch {
    return { executiveSummary: '', keyFindings: [], patterns: [], priorities: [] };
  }
}

function applyPromptTemplate(template: string, input: AnalyseReportInput): string {
  const issuesText = input.issuesList
    .map((i) => `- [${i.level}] ${i.criterion}: ${i.message} (${i.count}x)`)
    .join('\n');
  return template
    .replace(/\{\{siteUrl\}\}/g, input.siteUrl)
    .replace(/\{\{totalIssues\}\}/g, String(input.totalIssues))
    .replace(/\{\{issuesList\}\}/g, issuesText)
    .replace(/\{\{complianceSummary\}\}/g, input.complianceSummary)
    .replace(/\{\{recurringPatterns\}\}/g, input.recurringPatterns.join('\n'));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
}

export async function executeAnalyseReport(
  db: DbAdapter,
  adapterFactory: (type: string) => LLMProviderAdapter,
  input: AnalyseReportInput,
  retryOpts?: RetryOptions,
): Promise<CapabilityResult<AnalyseReportResult>> {
  const maxRetries = retryOpts?.maxRetries ?? 2;
  const retryDelayMs = retryOpts?.retryDelayMs ?? 5000;

  const models = await db.getModelsForCapability('analyse-report', input.orgId);
  if (models.length === 0) {
    throw new CapabilityNotConfiguredError('analyse-report');
  }

  const promptOverride = await db.getPromptOverride('analyse-report', input.orgId);
  let totalAttempts = 0;
  let lastError: Error | undefined;

  for (const model of models) {
    const provider = await db.getProvider(model.providerId);
    if (provider == null) continue;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      totalAttempts += 1;

      if (attempt > 0 && retryDelayMs > 0) {
        const delay = retryDelayMs * Math.pow(3, attempt - 1);
        await sleep(delay);
      }

      try {
        const adapter = adapterFactory(provider.type);
        await adapter.connect({ baseUrl: provider.baseUrl, apiKey: provider.apiKey });

        const promptInput: AnalyseReportPromptInput = {
          siteUrl: input.siteUrl,
          totalIssues: input.totalIssues,
          issuesList: input.issuesList,
          complianceSummary: input.complianceSummary,
          recurringPatterns: input.recurringPatterns,
        };

        const prompt = promptOverride != null
          ? applyPromptTemplate(promptOverride.template, input)
          : buildAnalyseReportPrompt(promptInput);

        const result = await adapter.complete(prompt, {
          model: model.modelId,
          temperature: 0.3,
          timeout: provider.timeout,
        });

        const data = parseAnalyseReportResponse(result.text);

        return {
          data,
          model: model.displayName,
          provider: provider.name,
          attempts: totalAttempts,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  throw new CapabilityExhaustedError('analyse-report', totalAttempts, lastError);
}
