#!/usr/bin/env node

import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { discoverUrls } from './discovery/discover.js';
import { WebserviceClient } from './scanner/webservice-client.js';
import { scanUrls } from './scanner/scanner.js';
import { generateJsonReport } from './reporter/json-reporter.js';
import { generateHtmlReport } from './reporter/html-reporter.js';
import { mapIssuesToSource } from './source-mapper/source-mapper.js';
import { proposeFixesFromReport } from './fixer/fix-proposer.js';
import { applyFix, generateDiffPreview } from './fixer/fix-applier.js';
import type { ScanReport, FixProposal } from './types.js';

// Exit codes
// 0 = clean (no issues found)
// 1 = issues found
// 2 = partial failure (page-level errors)
// 3 = fatal (only from catch block)

export const program = new Command();

program
  .name('pally-agent')
  .description('Accessibility testing agent using pa11y webservice')
  .version('0.1.0');

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
  .option('--config <path>', 'Path to configuration file')
  .action(async (url: string, opts: {
    standard?: string;
    concurrency?: number;
    repo?: string;
    output?: string;
    format?: string;
    alsoCrawl?: boolean;
    config?: string;
  }) => {
    try {
      const config = await loadConfig({
        configPath: opts.config,
        repoPath: opts.repo,
      });

      // CLI options override config file
      const effectiveConfig = {
        ...config,
        ...(opts.standard ? { standard: opts.standard as typeof config.standard } : {}),
        ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
        ...(opts.output ? { outputDir: opts.output } : {}),
        ...(opts.alsoCrawl !== undefined ? { alsoCrawl: opts.alsoCrawl } : {}),
      };

      console.log(`Discovering URLs from ${url}...`);
      const discoveredUrls = await discoverUrls(url, {
        maxPages: effectiveConfig.maxPages,
        crawlDepth: effectiveConfig.crawlDepth,
        alsoCrawl: effectiveConfig.alsoCrawl,
      });

      console.log(`Found ${discoveredUrls.length} URLs to scan`);

      const client = new WebserviceClient(
        effectiveConfig.webserviceUrl,
        effectiveConfig.webserviceHeaders,
      );

      const { pages, errors } = await scanUrls(discoveredUrls, client, {
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

      // Optionally map source
      let mappedPages = pages;
      if (opts.repo) {
        console.log('Mapping issues to source files...');
        mappedPages = await mapIssuesToSource(pages, opts.repo, effectiveConfig.sourceMap);
      }

      const format = opts.format ?? 'json';
      const reportInput = {
        siteUrl: url,
        pages: mappedPages,
        errors,
        outputDir: effectiveConfig.outputDir,
      };

      let report: ScanReport | undefined;

      if (format === 'json' || format === 'both') {
        report = await generateJsonReport(reportInput);
        console.log(`JSON report written to: ${report.reportPath}`);
      }

      if (format === 'html' || format === 'both') {
        const htmlPath = await generateHtmlReport(reportInput);
        console.log(`HTML report written to: ${htmlPath}`);
      }

      // Determine exit code
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
        const discoveredUrls = await discoverUrls(url, {
          maxPages: effectiveConfig.maxPages,
          crawlDepth: effectiveConfig.crawlDepth,
          alsoCrawl: effectiveConfig.alsoCrawl,
        });

        console.log(`Found ${discoveredUrls.length} URLs to scan`);

        const client = new WebserviceClient(
          effectiveConfig.webserviceUrl,
          effectiveConfig.webserviceHeaders,
        );

        const { pages, errors } = await scanUrls(discoveredUrls, client, {
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
