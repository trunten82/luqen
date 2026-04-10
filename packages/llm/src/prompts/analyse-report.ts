const MAX_ISSUES_COUNT = 30;
const MAX_COMPLIANCE_LENGTH = 3000;
const MAX_PATTERNS_LENGTH = 1000;

export interface AnalyseReportPromptInput {
  readonly totalIssues: number;
  readonly issuesList: ReadonlyArray<{
    readonly criterion: string;
    readonly message: string;
    readonly count: number;
    readonly level: string;
  }>;
  readonly complianceSummary: string;
  readonly recurringPatterns: readonly string[];
  readonly siteUrl: string;
}

export function buildAnalyseReportPrompt(input: AnalyseReportPromptInput): string {
  // Truncate issue list to MAX_ISSUES_COUNT — take highest-count items first
  const issues = [...input.issuesList]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_ISSUES_COUNT);

  const issuesText = issues
    .map((i) => `- [${i.level.toUpperCase()}] ${i.criterion}: ${i.message} (${i.count} occurrence${i.count !== 1 ? 's' : ''})`)
    .join('\n');

  const truncated = input.issuesList.length > MAX_ISSUES_COUNT
    ? `\n[... ${input.issuesList.length - MAX_ISSUES_COUNT} additional issues omitted for brevity]`
    : '';

  const compliance = input.complianceSummary.slice(0, MAX_COMPLIANCE_LENGTH);
  const patterns = input.recurringPatterns.length > 0
    ? input.recurringPatterns.join('\n').slice(0, MAX_PATTERNS_LENGTH)
    : 'No prior scans available for comparison.';

  return `You are a WCAG accessibility expert auditor. Analyse the following scan results for ${input.siteUrl} and produce an executive summary.

<!-- LOCKED:variable-injection -->
## Scan Summary
- Total issues: ${input.totalIssues}
- Site: ${input.siteUrl}

## Issues Found
${issuesText}${truncated}

## Compliance Status
${compliance}

## Recurring Patterns Across Previous Scans
${patterns}
<!-- /LOCKED -->

## Instructions
Produce a concise executive summary suitable for a non-technical stakeholder. Identify the most critical issues, any recurring patterns, and clear remediation priorities.

<!-- LOCKED:output-format -->
## Response Format
Respond ONLY with valid JSON, no markdown fences:
{
  "executiveSummary": "2-4 sentence executive summary of the accessibility status",
  "keyFindings": ["finding 1", "finding 2", "finding 3"],
  "patterns": ["pattern 1", "pattern 2"],
  "priorities": ["priority action 1", "priority action 2"]
}

If there are no issues, return:
{"executiveSummary":"No accessibility issues were found in this scan.","keyFindings":[],"patterns":[],"priorities":[]}
<!-- /LOCKED -->`;
}
