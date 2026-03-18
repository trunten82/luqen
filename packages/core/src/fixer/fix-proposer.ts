import type { ScanReport, FixProposal } from '../types.js';
import { mapIssuesToSource } from '../source-mapper/source-mapper.js';
import { getFixForIssue } from './fix-rules.js';

export interface ProposeFixesResult {
  readonly fixable: number;
  readonly unfixable: number;
  readonly fixes: readonly FixProposal[];
}

export async function proposeFixesFromReport(
  report: ScanReport,
  repoPath: string,
  sourceMapOverrides: Readonly<Record<string, string>>,
): Promise<ProposeFixesResult> {
  const mappedPages = await mapIssuesToSource(report.pages, repoPath, sourceMapOverrides);

  let fixable = 0;
  let unfixable = 0;
  const fixes: FixProposal[] = [];

  for (const page of mappedPages) {
    const sourceFile = page.sourceMap?.file ?? null;

    for (const issue of page.issues) {
      const fixSuggestion = getFixForIssue(issue);

      if (fixSuggestion !== null && sourceFile !== null) {
        fixes.push({
          file: sourceFile,
          line: page.sourceMap?.line ?? 0,
          issue: issue.code,
          description: fixSuggestion.description,
          oldText: fixSuggestion.oldText,
          newText: fixSuggestion.newText,
          confidence: page.sourceMap?.confidence === 'high' ? 'high' : 'low',
        });
        fixable++;
      } else {
        unfixable++;
      }
    }
  }

  return { fixable, unfixable, fixes };
}
