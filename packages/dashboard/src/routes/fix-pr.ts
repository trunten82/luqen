import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { StorageAdapter } from '../db/index.js';
import type { DashboardConfig } from '../config.js';
import { requirePermission } from '../auth/middleware.js';
import { getGitHostPlugin } from '../git-hosts/registry.js';
import { decryptSecret } from '../plugins/crypto.js';
import { getFixSuggestion } from '../fix-suggestions.js';
import { toastHtml } from './admin/helpers.js';
import type { GitHostFile } from '../git-hosts/types.js';
import { RemoteFileReader } from '../git-hosts/remote-file-reader.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreatePrBody {
  readonly fixIndices?: string | string[];
  readonly _csrf?: string;
}

interface ReportFixIssue {
  readonly type: string;
  readonly code: string;
  readonly message: string;
  readonly selector: string;
  readonly context: string;
  readonly wcagCriterion?: string;
  readonly wcagTitle?: string;
}

interface ReportFixPage {
  readonly url: string;
  readonly issues: readonly ReportFixIssue[];
}

interface JsonReportForFixes {
  readonly pages?: readonly ReportFixPage[];
  readonly issues?: readonly ReportFixIssue[];
  readonly siteUrl?: string;
  readonly templateIssues?: ReadonlyArray<ReportFixIssue & {
    readonly affectedPages: readonly string[];
    readonly affectedCount: number;
  }>;
}

interface FixEntry {
  readonly criterion: string;
  readonly message: string;
  readonly context: string;
  readonly selector: string;
  readonly pageUrl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract owner/repo from a git URL.
 * Supports https://github.com/owner/repo, git@github.com:owner/repo.git, etc.
 */
function extractRepoSlug(repoUrl: string): string | null {
  // HTTPS: https://github.com/owner/repo or https://github.com/owner/repo.git
  const httpsMatch = repoUrl.match(/https?:\/\/[^/]+\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch !== null) return httpsMatch[1];

  // SSH: git@github.com:owner/repo.git
  const sshMatch = repoUrl.match(/:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch !== null) return sshMatch[1];

  return null;
}

function parseFixIndices(raw: string | string[] | undefined): number[] {
  if (raw === undefined) return [];

  const items = Array.isArray(raw) ? raw : [raw];
  const indices: number[] = [];

  for (const item of items) {
    // Support comma-separated values
    const parts = String(item).split(',');
    for (const part of parts) {
      const n = parseInt(part.trim(), 10);
      if (!Number.isNaN(n) && n >= 0) {
        indices.push(n);
      }
    }
  }

  return indices;
}

function collectIssuesFromReport(raw: JsonReportForFixes, siteUrl: string): FixEntry[] {
  const issues: FixEntry[] = [];

  if (raw.pages !== undefined) {
    for (const page of raw.pages) {
      for (const issue of page.issues) {
        issues.push({
          criterion: issue.wcagCriterion ?? '',
          message: issue.message,
          context: issue.context,
          selector: issue.selector,
          pageUrl: page.url,
        });
      }
    }
  } else if (raw.issues !== undefined) {
    for (const issue of raw.issues) {
      issues.push({
        criterion: issue.wcagCriterion ?? '',
        message: issue.message,
        context: issue.context,
        selector: issue.selector,
        pageUrl: siteUrl,
      });
    }
  }

  if (raw.templateIssues !== undefined) {
    for (const ti of raw.templateIssues) {
      issues.push({
        criterion: ti.wcagCriterion ?? '',
        message: ti.message,
        context: ti.context,
        selector: ti.selector,
        pageUrl: ti.affectedPages[0] ?? siteUrl,
      });
    }
  }

  return issues;
}

/**
 * Build deduplicated fix list matching the same logic as the GET /reports/:id/fixes
 * route, so fix indices are consistent.
 */
function buildFixList(issues: readonly FixEntry[]): Array<FixEntry & { readonly oldText: string; readonly newText: string }> {
  const seen = new Set<string>();
  const fixes: Array<FixEntry & { readonly oldText: string; readonly newText: string }> = [];

  for (const issue of issues) {
    const suggestion = getFixSuggestion(issue.criterion, issue.message);
    if (suggestion === null) continue;

    const fingerprint = `${suggestion.criterion}:${suggestion.issuePattern}:${issue.selector}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    // Extract oldText/newText from the code example's Before/After pattern
    const { oldText, newText } = parseCodeExample(suggestion.codeExample, issue.context);

    fixes.push({ ...issue, oldText, newText });
  }

  // Sort identically to the GET route: errors would be first, then by criterion.
  // Since we don't have severity here, sort by criterion only.
  fixes.sort((a, b) => a.criterion.localeCompare(b.criterion));

  return fixes;
}

/**
 * Parse the code example's Before/After sections.
 * If the issue's HTML context is available, use it as oldText and apply the
 * pattern from the suggestion to generate newText. Otherwise fall back to the
 * example's literal text.
 */
function parseCodeExample(codeExample: string, context: string): { oldText: string; newText: string } {
  // Try to extract Before and After sections from the code example
  const beforeMatch = codeExample.match(/<!-- Before -->\s*\n([\s\S]*?)(?=\n\s*\n<!-- After -->)/);
  const afterMatch = codeExample.match(/<!-- After -->\s*\n([\s\S]*?)$/);

  // Also try CSS-style comments
  const cssBefore = codeExample.match(/\/\* Before[^*]*\*\/\s*\n([\s\S]*?)(?=\n\s*\n\/\* After)/);
  const cssAfter = codeExample.match(/\/\* After[^*]*\*\/\s*\n([\s\S]*?)$/);

  const oldText = beforeMatch?.[1]?.trim() ?? cssBefore?.[1]?.trim() ?? context;
  const newText = afterMatch?.[1]?.trim() ?? cssAfter?.[1]?.trim() ?? context;

  return { oldText, newText };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function fixPrRoutes(
  server: FastifyInstance,
  storage: StorageAdapter,
  config: DashboardConfig,
): Promise<void> {

  // ── POST /reports/:id/fixes/create-pr ───────────────────────────────────

  server.post(
    '/reports/:id/fixes/create-pr',
    { preHandler: [requirePermission('repos.credentials'), requirePermission('issues.fix')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id: reportId } = request.params as { id: string };
      const body = request.body as CreatePrBody;
      const userId = request.user!.id;
      const orgId = request.user?.currentOrgId ?? 'system';
      const isHtmx = request.headers['hx-request'] === 'true';

      // 1. Parse selected fix indices
      const fixIndices = parseFixIndices(body.fixIndices);
      if (fixIndices.length === 0) {
        const msg = 'No fixes selected. Please select at least one fix proposal.';
        return isHtmx
          ? reply.code(422).send(toastHtml(msg, 'error'))
          : reply.code(422).send({ error: msg });
      }

      // 2. Load scan record
      const scan = await storage.scans.getScan(reportId);
      if (scan === null) {
        return isHtmx
          ? reply.code(404).send(toastHtml('Report not found.', 'error'))
          : reply.code(404).send({ error: 'Report not found' });
      }

      if (scan.orgId !== orgId && scan.orgId !== 'system') {
        return isHtmx
          ? reply.code(404).send(toastHtml('Report not found.', 'error'))
          : reply.code(404).send({ error: 'Report not found' });
      }

      // 3. Find connected repo
      const repo = await storage.repos.findRepoForUrl(scan.siteUrl, orgId);
      if (repo === null || repo.gitHostConfigId === null) {
        const msg = 'No git host configured for this repository';
        return isHtmx
          ? reply.code(422).send(toastHtml(msg, 'error'))
          : reply.code(422).send({ error: msg });
      }

      // 4. Load git host config
      const gitHostConfig = await storage.gitHosts.getConfig(repo.gitHostConfigId);
      if (gitHostConfig === null) {
        const msg = 'Git host configuration not found';
        return isHtmx
          ? reply.code(422).send(toastHtml(msg, 'error'))
          : reply.code(422).send({ error: msg });
      }

      // 5. Get plugin
      const plugin = getGitHostPlugin(gitHostConfig.pluginType);
      if (plugin === undefined) {
        const msg = `Unsupported git host type: ${gitHostConfig.pluginType}`;
        return isHtmx
          ? reply.code(422).send(toastHtml(msg, 'error'))
          : reply.code(422).send({ error: msg });
      }

      // 6. Load user's credential
      const credential = await storage.gitHosts.getCredentialForHost(userId, gitHostConfig.id);
      if (credential === null) {
        const msg = 'No git credentials configured for this git host';
        return isHtmx
          ? reply.code(422).send(toastHtml(msg, 'error'))
          : reply.code(422).send({ error: msg });
      }

      // 7. Decrypt token
      let token: string;
      try {
        token = decryptSecret(credential.encryptedToken, config.sessionSecret);
      } catch {
        const msg = 'Failed to decrypt git credentials. Please re-save your token.';
        return isHtmx
          ? reply.code(422).send(toastHtml(msg, 'error'))
          : reply.code(422).send({ error: msg });
      }

      // 8. Load scan JSON report
      if (scan.jsonReportPath === undefined || !existsSync(scan.jsonReportPath)) {
        const msg = 'Scan report data not available';
        return isHtmx
          ? reply.code(422).send(toastHtml(msg, 'error'))
          : reply.code(422).send({ error: msg });
      }

      let rawReport: JsonReportForFixes;
      try {
        rawReport = JSON.parse(await readFile(scan.jsonReportPath, 'utf-8')) as JsonReportForFixes;
      } catch {
        const msg = 'Failed to parse scan report';
        return isHtmx
          ? reply.code(422).send(toastHtml(msg, 'error'))
          : reply.code(422).send({ error: msg });
      }

      // 9. Build fix list and select requested indices
      const allIssues = collectIssuesFromReport(rawReport, scan.siteUrl);
      const allFixes = buildFixList(allIssues);
      const selectedFixes = fixIndices
        .filter((idx) => idx < allFixes.length)
        .map((idx) => allFixes[idx]);

      if (selectedFixes.length === 0) {
        const msg = 'Selected fix indices are out of range';
        return isHtmx
          ? reply.code(422).send(toastHtml(msg, 'error'))
          : reply.code(422).send({ error: msg });
      }

      // 10. Extract repo slug (owner/repo) from the connected repo URL
      const repoSlug = extractRepoSlug(repo.repoUrl);
      if (repoSlug === null) {
        const msg = 'Cannot parse repository URL';
        return isHtmx
          ? reply.code(422).send(toastHtml(msg, 'error'))
          : reply.code(422).send({ error: msg });
      }

      // 11. For each fix, read the file from the repo and apply replacements
      const changedFiles = new Map<string, string>();
      const repoPath = repo.repoPath ?? '';
      const baseBranch = repo.branch;
      const sourceMapOverrides: Record<string, string> = {};

      // Create remote file reader for the git host
      const remoteReader = new RemoteFileReader(plugin, {
        hostUrl: gitHostConfig.hostUrl,
        repo: repoSlug,
        branch: baseBranch,
        token,
      });

      // Try the core's proposeFixesFromReport with remote reader (may not accept
      // the 4th parameter yet — the core FileReader change is a parallel task).
      let usedCoreProposer = false;
      try {
        const { proposeFixesFromReport } = await import('@luqen/core');
        // Check if proposeFixesFromReport accepts a 4th argument (FileReader)
        if (proposeFixesFromReport.length >= 4) {
          const proposals = await (proposeFixesFromReport as (
            report: unknown, repoPath: string, overrides: Record<string, string>, reader: RemoteFileReader,
          ) => Promise<{ fixes: ReadonlyArray<{ file: string; oldText: string; newText: string }> }>)(
            rawReport, repoPath, sourceMapOverrides, remoteReader,
          );

          // Filter to selected fixes only
          const selectedProposals = proposals.fixes.filter((_, i) => fixIndices.includes(i));

          for (const proposal of selectedProposals) {
            const filePath = proposal.file;
            let content = changedFiles.get(filePath);
            if (content === undefined) {
              content = await remoteReader.read(filePath) ?? undefined;
            }
            if (content !== undefined && proposal.oldText && content.includes(proposal.oldText)) {
              changedFiles.set(filePath, content.replace(proposal.oldText, proposal.newText));
            }
          }

          usedCoreProposer = true;
        }
      } catch {
        // Core not built with FileReader support yet — fall back to naive approach
      }

      // Fallback: naive file-path guessing when core proposer is unavailable
      if (!usedCoreProposer) {
        for (const fix of selectedFixes) {
          if (fix.oldText === '' || fix.newText === '' || fix.oldText === fix.newText) {
            continue;
          }

          const filePaths = repoPath !== ''
            ? [repoPath]
            : ['index.html', 'src/index.html', 'public/index.html'];

          for (const filePath of filePaths) {
            let content = changedFiles.get(filePath);
            if (content === undefined) {
              content = await remoteReader.read(filePath) ?? undefined;
            }

            if (content !== undefined && content.includes(fix.oldText)) {
              changedFiles.set(filePath, content.replace(fix.oldText, fix.newText));
              break;
            }
          }
        }
      }

      if (changedFiles.size === 0) {
        const msg = 'No matching code found in repository files. The fix suggestions are code examples — the actual source may differ.';
        return isHtmx
          ? reply.code(422).send(toastHtml(msg, 'error'))
          : reply.code(422).send({ error: msg });
      }

      // 12. Build branch name and PR content
      const branchName = `luqen/a11y-fix-${reportId.slice(0, 8)}`;
      const changes: GitHostFile[] = [...changedFiles.entries()].map(([path, content]) => ({
        path,
        content,
      }));

      const fixSummary = selectedFixes
        .map((f) => `- WCAG ${f.criterion}: ${f.message.slice(0, 100)}`)
        .join('\n');

      const prTitle = `fix(a11y): accessibility fixes from Luqen scan`;
      const prBody = [
        '## Accessibility Fixes',
        '',
        `Automated fix proposals from [Luqen](https://luqen.com) scan report \`${reportId.slice(0, 8)}\`.`,
        '',
        '### Changes',
        fixSummary,
        '',
        `**${changedFiles.size}** file(s) modified with **${selectedFixes.length}** fix(es) applied.`,
      ].join('\n');

      // 13. Create the pull request
      try {
        const pr = await plugin.createPullRequest({
          hostUrl: gitHostConfig.hostUrl,
          repo: repoSlug,
          baseBranch,
          headBranch: branchName,
          title: prTitle,
          body: prBody,
          changes,
          token,
        });

        if (isHtmx) {
          const escapedUrl = pr.url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
          return reply
            .code(200)
            .header('content-type', 'text/html')
            .send(`<div class="alert alert--success"><div class="alert__body">Pull request #${pr.number} created: <a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">View PR</a></div></div>`);
        }

        return reply.send({ success: true, url: pr.url, number: pr.number });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to create pull request');
        const msg = `Failed to create pull request: ${message}`;
        return isHtmx
          ? reply.code(500).send(toastHtml(msg, 'error'))
          : reply.code(500).send({ error: msg });
      }
    },
  );
}
