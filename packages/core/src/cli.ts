#!/usr/bin/env node

import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { discoverUrls, type DiscoverResult } from './discovery/discover.js';
import { WebserviceClient } from './scanner/webservice-client.js';
import { DirectScanner } from './scanner/direct-scanner.js';
import { scanUrls } from './scanner/scanner.js';
import { generateJsonReport } from './reporter/json-reporter.js';
import { generateHtmlReport } from './reporter/html-reporter.js';
import { mapIssuesToSource } from './source-mapper/source-mapper.js';
import { proposeFixesFromReport } from './fixer/fix-proposer.js';
import { applyFix, generateDiffPreview } from './fixer/fix-applier.js';
import { fetchComplianceEnrichment } from './compliance-client.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ScanReport, FixProposal, ComplianceEnrichment } from './types.js';
import { VERSION } from './version.js';
import {
  readBaseline,
  writeBaseline,
  fingerprint,
  normalizePath,
  type BaselineFinding,
} from './baseline/baseline.js';
import { diffBaseline, computeGateExitCode, type BaselineDiff } from './baseline/diff.js';
import { formatGateSummary } from './reporter/gate-reporter.js';

// Exit codes
// 0 = clean (no issues found)
// 1 = issues found (or gate: new findings present)
// 2 = partial failure (page-level errors) / gate infra error
// 3 = fatal (only from catch block)

// ---------------------------------------------------------------------------
// runGateAction — exported helper for testing the gate logic without a real scan
// ---------------------------------------------------------------------------

export interface GateActionOptions {
  readonly updateBaseline: boolean;
  readonly baselinePath: string;
  readonly currentFindings: readonly BaselineFinding[];
  readonly targetUrl: string;
  readonly failOn?: string;
  readonly minSeverity?: string;
  readonly gateOutputPath?: string;
}

export interface GateActionResult {
  readonly exitCode: number;
  readonly summary: string;
}

export async function runGateAction(opts: GateActionOptions): Promise<GateActionResult> {
  const failOn = opts.failOn ?? 'new';
  const minSeverity = (opts.minSeverity ?? 'error') as 'error' | 'warning';

  if (opts.updateBaseline) {
    // Write current findings as the new baseline and exit 0
    const file = {
      meta: {
        schemaVersion: 1 as const,
        generatedAt: new Date().toISOString(),
        generatedBy: 'luqen scan --update-baseline' as const,
        target: opts.targetUrl,
      },
      findings: [...opts.currentFindings],
    };
    await writeBaseline(opts.baselinePath, file);
    const count = opts.currentFindings.length;
    const copy = count === 0
      ? `Baseline updated: 0 findings (clean baseline) written to ${opts.baselinePath}`
      : `Baseline updated: ${count} findings written to ${opts.baselinePath}`;
    return { exitCode: 0, summary: copy };
  }

  // Gate run: read baseline (read-only)
  const baseline = await readBaseline(opts.baselinePath);

  if (baseline === null) {
    // Infra error — baseline unreadable or path-traversal rejection (D-10, T-79-04)
    const copy = `Luqen gate: baseline file unreadable at ${opts.baselinePath}. Scan result not assessed. Resolve the baseline or run with --fail-on=none to report-only.`;

    // Write infra-error gate output if requested (Plan 02 contract)
    if (opts.gateOutputPath) {
      const infraOutput = {
        newFindings: [] as BaselineFinding[],
        fixedFindings: [] as BaselineFinding[],
        unchanged: [] as BaselineFinding[],
        infraError: true,
      };
      await mkdir(dirname(opts.gateOutputPath), { recursive: true });
      await writeFile(opts.gateOutputPath, JSON.stringify(infraOutput, null, 2), 'utf-8');
    }

    return { exitCode: 2, summary: copy };
  }

  // Compute diff
  const diff: BaselineDiff = diffBaseline(baseline.findings, opts.currentFindings);
  const gateExitCode = computeGateExitCode(
    failOn,
    diff,
    opts.currentFindings,
    false,
    minSeverity,
  );

  const summary = formatGateSummary(diff, opts.baselinePath);

  // Write machine-readable gate output if requested (Plan 02 contract)
  if (opts.gateOutputPath) {
    await mkdir(dirname(opts.gateOutputPath), { recursive: true });
    await writeFile(opts.gateOutputPath, JSON.stringify(diff, null, 2), 'utf-8');
  }

  return { exitCode: gateExitCode, summary };
}

export const program = new Command();

program
  .name('luqen')
  .description('Accessibility testing agent using pa11y webservice')
  .version(VERSION);

// ---------------------------------------------------------------------------
// scan command
// ---------------------------------------------------------------------------

program
  .command('scan <url>')
  .description('Discover and scan URLs for accessibility issues')
  .option('--standard <standard>', 'WCAG standard (WCAG2A, WCAG2AA, WCAG2AAA)')
  .option('--concurrency <number>', 'Number of concurrent scans', parseInt)
  .option('--repo <path>', 'Path to source repository for source mapping')
  .option('--output <dir>', 'Output directory for reports')
  .option('--format <format>', 'Report format: json, html, or both (default: json)', 'json')
  .option('--also-crawl', 'Also crawl the site in addition to using sitemaps')
  .option('--runner <runner>', 'Pa11y test runner: htmlcs (default) or axe')
  .option('--config <path>', 'Path to configuration file')
  .option('--compliance-url <url>', 'URL of the compliance service for legal enrichment')
  .option('--jurisdictions <list>', 'Comma-separated jurisdiction IDs (e.g. EU,US)', 'EU,US')
  .option('--compliance-client-id <id>', 'OAuth client ID for the compliance service')
  .option('--compliance-client-secret <secret>', 'OAuth client secret for the compliance service')
  .option('--fail-on <mode>', 'Gate failure mode: new (default), none, all', 'new')
  .option('--min-severity <level>', 'Minimum severity to count: error (default) or warning', 'error')
  .option('--baseline <path>', 'Path to baseline file', '.luqen/baseline.json')
  .option('--update-baseline', 'Write current findings to baseline and exit 0')
  .option('--gate-output <path>', 'Write the BaselineDiff JSON for the gate run to this path (consumed by the GitHub Action)')
  .action(async (url: string, opts: {
    standard?: string;
    concurrency?: number;
    repo?: string;
    output?: string;
    format?: string;
    alsoCrawl?: boolean;
    runner?: string;
    config?: string;
    complianceUrl?: string;
    jurisdictions?: string;
    complianceClientId?: string;
    complianceClientSecret?: string;
    failOn?: string;
    minSeverity?: string;
    baseline?: string;
    updateBaseline?: boolean;
    gateOutput?: string;
  }) => {
    try {
      const config = await loadConfig({
        configPath: opts.config,
        repoPath: opts.repo,
      });

      // CLI options override config file
      const validRunners = ['htmlcs', 'axe'];
      const runnerFromOpts = opts.runner !== undefined && validRunners.includes(opts.runner)
        ? (opts.runner as 'htmlcs' | 'axe')
        : undefined;

      const effectiveConfig = {
        ...config,
        ...(opts.standard ? { standard: opts.standard as typeof config.standard } : {}),
        ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
        ...(opts.output ? { outputDir: opts.output } : {}),
        ...(opts.alsoCrawl !== undefined ? { alsoCrawl: opts.alsoCrawl } : {}),
        ...(runnerFromOpts !== undefined ? { runner: runnerFromOpts } : {}),
      };

      console.log(`Discovering URLs from ${url}...`);
      const discoverResult: DiscoverResult = await discoverUrls(url, {
        maxPages: effectiveConfig.maxPages,
        crawlDepth: effectiveConfig.crawlDepth,
        alsoCrawl: effectiveConfig.alsoCrawl,
      }, true);
      const discoveredUrls = discoverResult.urls;

      if (discoverResult.wafWarning) {
        console.warn(discoverResult.wafWarning);
      }

      console.log(`Found ${discoveredUrls.length} URLs to scan`);

      const clientOrScanner = effectiveConfig.webserviceUrl !== undefined
        ? new WebserviceClient(effectiveConfig.webserviceUrl, effectiveConfig.webserviceHeaders)
        : new DirectScanner();

      const { pages, errors } = await scanUrls(discoveredUrls, clientOrScanner, {
        standard: effectiveConfig.standard,
        concurrency: effectiveConfig.concurrency,
        timeout: effectiveConfig.timeout,
        pollTimeout: effectiveConfig.pollTimeout,
        ignore: effectiveConfig.ignore,
        hideElements: effectiveConfig.hideElements,
        headers: effectiveConfig.headers,
        wait: effectiveConfig.wait,
        ...(effectiveConfig.runner !== undefined ? { runner: effectiveConfig.runner } : {}),
        onProgress: (progress) => {
          if (progress.type === 'scan:start') {
            console.log(`[${progress.current}/${progress.total}] Scanning ${progress.url}`);
          } else if (progress.type === 'scan:complete') {
            console.log(`[${progress.current}/${progress.total}] Done: ${progress.url}`);
          } else if (progress.type === 'scan:error') {
            console.error(`[${progress.current}/${progress.total}] Error: ${progress.url} — ${progress.error}`);
          }
        },
      });

      // Optionally map source
      let mappedPages = pages;
      if (opts.repo) {
        console.log('Mapping issues to source files...');
        mappedPages = await mapIssuesToSource(pages, opts.repo, effectiveConfig.sourceMap);
      }

      // Optionally enrich with compliance data
      let compliance: ComplianceEnrichment | null = null;
      const complianceUrl = opts.complianceUrl ?? (effectiveConfig as { compliance?: { url?: string } }).compliance?.url;
      if (complianceUrl) {
        const configCompliance = (effectiveConfig as { compliance?: { jurisdictions?: string[]; clientId?: string; clientSecret?: string } }).compliance;
        const jurisdictionList = opts.jurisdictions
          ? opts.jurisdictions.split(',').map((j: string) => j.trim())
          : configCompliance?.jurisdictions ?? ['EU', 'US'];
        const clientId = opts.complianceClientId ?? configCompliance?.clientId;
        const clientSecret = opts.complianceClientSecret ?? configCompliance?.clientSecret;

        const allIssues = mappedPages.flatMap((p) =>
          p.issues.map((i) => ({
            code: i.code,
            type: i.type,
            message: i.message,
            selector: i.selector,
            context: i.context,
          })),
        );

        console.log(`Fetching compliance data from ${complianceUrl}...`);
        compliance = await fetchComplianceEnrichment(
          complianceUrl,
          jurisdictionList,
          allIssues,
          clientId,
          clientSecret,
        );

        if (compliance) {
          // Compute confirmed vs. needs-review breakdown for CLI output
          let confirmedFailingJurisdictions = 0;
          let reviewJurisdictions = 0;
          let confirmedViolationsTotal = 0;
          let needsReviewTotal = 0;
          for (const j of Object.values(compliance.matrix)) {
            let confirmed = 0;
            let needsReview = 0;
            for (const page of mappedPages) {
              for (const issue of page.issues) {
                const annotations = compliance.issueAnnotations.get(issue.code);
                if (!annotations) continue;
                const hasMandatory = annotations.some(
                  (a) => a.jurisdictionId === j.jurisdictionId && a.obligation === 'mandatory',
                );
                if (!hasMandatory) continue;
                if (issue.type === 'error') {
                  confirmed++;
                } else {
                  needsReview++;
                }
              }
            }
            if (confirmed > 0) confirmedFailingJurisdictions++;
            else if (needsReview > 0) reviewJurisdictions++;
            confirmedViolationsTotal += confirmed;
            needsReviewTotal += needsReview;
          }
          console.log(
            `Compliance: ${confirmedFailingJurisdictions} confirmed failure(s), ${reviewJurisdictions} need review, ${confirmedViolationsTotal} confirmed violations, ${needsReviewTotal} need review`,
          );
        }
      }

      const formats = (opts.format ?? 'json').split(',').map((f: string) => f.trim());
      const reportInput = {
        siteUrl: url,
        pages: mappedPages,
        errors,
        outputDir: effectiveConfig.outputDir,
        compliance,
      };

      let report: ScanReport | undefined;

      if (formats.includes('json')) {
        report = await generateJsonReport(reportInput);
        console.log(`JSON report written to: ${report.reportPath}`);
      }

      if (formats.includes('html')) {
        const htmlPath = await generateHtmlReport(reportInput);
        console.log(`HTML report written to: ${htmlPath}`);
      }

      // ---------------------------------------------------------------------------
      // Gate logic: --update-baseline / --fail-on / --gate-output
      // ---------------------------------------------------------------------------

      // Build current findings from scan results (fingerprinted + path-normalized)
      const currentFindings: BaselineFinding[] = mappedPages.flatMap((p) =>
        p.issues.map((issue) => {
          const normalizedP = normalizePath(p.url);
          return {
            fingerprint: fingerprint(normalizedP, issue.code, issue.selector),
            normalizedPath: normalizedP,
            code: issue.code,
            type: issue.type as 'error' | 'warning' | 'notice',
            selector: issue.selector,
            message: issue.message,
          };
        }),
      );

      const baselinePath = opts.baseline ?? '.luqen/baseline.json';

      if (opts.updateBaseline || opts.failOn !== undefined || opts.gateOutput !== undefined) {
        // Gate mode is active (explicit flags were passed or gate output requested)
        const gateResult = await runGateAction({
          updateBaseline: opts.updateBaseline === true,
          baselinePath,
          currentFindings,
          targetUrl: url,
          failOn: opts.failOn,
          minSeverity: opts.minSeverity,
          gateOutputPath: opts.gateOutput,
        });

        console.log(gateResult.summary);
        process.exit(gateResult.exitCode);
      }

      // Standard (non-gate) exit code logic
      if (errors.length > 0 && pages.length > 0) {
        process.exit(2);
      } else if (errors.length > 0 && pages.length === 0) {
        process.exit(2);
      }

      const totalIssues = pages.reduce((sum, p) => sum + p.issueCount, 0);
      if (totalIssues > 0) {
        process.exit(1);
      }

      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Fatal error: ${message}`);
      process.exit(3);
    }
  });

// ---------------------------------------------------------------------------
// fix command
// ---------------------------------------------------------------------------

program
  .command('fix [url]')
  .description('Propose and interactively apply accessibility fixes')
  .requiredOption('--repo <path>', 'Path to source repository (required)')
  .option('--from-report <path>', 'Load scan results from an existing JSON report')
  .option('--config <path>', 'Path to configuration file')
  .option('--standard <standard>', 'WCAG standard (WCAG2A, WCAG2AA, WCAG2AAA)')
  .action(async (url: string | undefined, opts: {
    repo: string;
    fromReport?: string;
    config?: string;
    standard?: string;
  }) => {
    try {
      let report: ScanReport;

      if (opts.fromReport) {
        // Load report from file
        console.log(`Loading report from ${opts.fromReport}...`);
        const content = await readFile(opts.fromReport, 'utf-8');
        report = JSON.parse(content) as ScanReport;
      } else if (url) {
        // Run a fresh scan
        const config = await loadConfig({
          configPath: opts.config,
          repoPath: opts.repo,
        });

        const effectiveConfig = {
          ...config,
          ...(opts.standard ? { standard: opts.standard as typeof config.standard } : {}),
        };

        console.log(`Discovering URLs from ${url}...`);
        const fixDiscoverResult: DiscoverResult = await discoverUrls(url, {
          maxPages: effectiveConfig.maxPages,
          crawlDepth: effectiveConfig.crawlDepth,
          alsoCrawl: effectiveConfig.alsoCrawl,
        }, true);
        const discoveredUrls = fixDiscoverResult.urls;

        if (fixDiscoverResult.wafWarning) {
          console.warn(fixDiscoverResult.wafWarning);
        }

        console.log(`Found ${discoveredUrls.length} URLs to scan`);

        const clientOrScanner = effectiveConfig.webserviceUrl !== undefined
          ? new WebserviceClient(effectiveConfig.webserviceUrl, effectiveConfig.webserviceHeaders)
          : new DirectScanner();

        const { pages, errors } = await scanUrls(discoveredUrls, clientOrScanner, {
          standard: effectiveConfig.standard,
          concurrency: effectiveConfig.concurrency,
          timeout: effectiveConfig.timeout,
          pollTimeout: effectiveConfig.pollTimeout,
          ignore: effectiveConfig.ignore,
          hideElements: effectiveConfig.hideElements,
          headers: effectiveConfig.headers,
          wait: effectiveConfig.wait,
          onProgress: (progress) => {
            if (progress.type === 'scan:start') {
              console.log(`[${progress.current}/${progress.total}] Scanning ${progress.url}`);
            } else if (progress.type === 'scan:complete') {
              console.log(`[${progress.current}/${progress.total}] Done: ${progress.url}`);
            } else if (progress.type === 'scan:error') {
              console.error(`[${progress.current}/${progress.total}] Error: ${progress.url} — ${progress.error}`);
            }
          },
        });

        report = await generateJsonReport({
          siteUrl: url,
          pages,
          errors,
          outputDir: effectiveConfig.outputDir,
        });

        console.log(`Scan report saved to: ${report.reportPath}`);
      } else {
        console.error('Error: Either provide a URL to scan or use --from-report <path>');
        process.exit(3);
        return;
      }

      // Propose fixes
      console.log('Analyzing issues and proposing fixes...');
      const config = await loadConfig({ configPath: opts.config, repoPath: opts.repo });
      const { fixable, unfixable, fixes } = await proposeFixesFromReport(
        report,
        opts.repo,
        config.sourceMap,
      );

      console.log(`Found ${fixable} fixable issues, ${unfixable} unfixable issues`);

      if (fixes.length === 0) {
        console.log('No fixes to apply.');
        process.exit(0);
        return;
      }

      // Interactive prompt loop
      await runInteractiveFixLoop(fixes);

      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Fatal error: ${message}`);
      process.exit(3);
    }
  });

async function runInteractiveFixLoop(fixes: readonly FixProposal[]): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer.trim().toLowerCase());
      });
    });
  };

  try {
    for (const fix of fixes) {
      console.log(`\nFile: ${fix.file} (line ${fix.line})`);
      console.log(`Issue: ${fix.issue}`);
      console.log(`Description: ${fix.description}`);
      console.log(`Confidence: ${fix.confidence}`);

      let answered = false;
      while (!answered) {
        const response = await ask('Apply fix? [y]es / [n]o / [s]how diff / [a]bort all: ');

        if (response === 'y' || response === 'yes') {
          const result = await applyFix(fix);
          if (result.applied) {
            console.log(`Applied fix to ${result.file}`);
          } else {
            console.log(`Could not apply fix to ${result.file} (original text not found)`);
          }
          answered = true;
        } else if (response === 'n' || response === 'no') {
          console.log('Skipped');
          answered = true;
        } else if (response === 's' || response === 'show') {
          const diff = await generateDiffPreview(fix);
          if (diff) {
            console.log('\nDiff preview:');
            console.log(diff);
          } else {
            console.log('No diff available (original text not found in file)');
          }
          // Loop again to ask y/n/a
        } else if (response === 'a' || response === 'abort') {
          console.log('Aborting all remaining fixes.');
          return;
        } else {
          console.log('Please enter y, n, s, or a');
        }
      }
    }
  } finally {
    rl.close();
  }
}

// Only parse args when run as the main module
const currentFile = fileURLToPath(import.meta.url);
const isMain = process.argv[1] === currentFile;

if (isMain) {
  program.parse(process.argv);
}
