/**
 * Data migration between StorageAdapter instances.
 *
 * Copies all records from a source adapter to a target adapter using only the
 * public repository interfaces. This ensures the migration works across any
 * adapter combination (SQLite -> Postgres, SQLite -> MongoDB, etc.).
 */

import type { StorageAdapter } from './adapter.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MigrationOptions {
  readonly source: StorageAdapter;
  readonly target: StorageAdapter;
  readonly dryRun?: boolean;
  readonly onProgress?: (table: string, count: number) => void;
}

export interface MigrationResult {
  readonly tables: ReadonlyArray<{ readonly name: string; readonly count: number }>;
  readonly totalRecords: number;
  readonly durationMs: number;
}

// ---------------------------------------------------------------------------
// Per-table migration helpers
// ---------------------------------------------------------------------------

async function migrateOrganizations(
  source: StorageAdapter,
  target: StorageAdapter,
  dryRun: boolean,
): Promise<number> {
  const orgs = await source.organizations.listOrgs();
  if (dryRun) return orgs.length;

  let count = 0;
  for (const org of orgs) {
    const existing = await target.organizations.getOrgBySlug(org.slug);
    if (existing !== null) continue;

    await target.organizations.createOrg({ name: org.name, slug: org.slug });

    // Migrate org members
    const members = await source.organizations.listMembers(org.id);
    const createdOrg = await target.organizations.getOrgBySlug(org.slug);
    if (createdOrg !== null) {
      for (const member of members) {
        try {
          await target.organizations.addMember(createdOrg.id, member.userId, member.role);
        } catch {
          // Member may already exist or user not yet migrated — skip
        }
      }
    }
    count++;
  }
  return count;
}

async function migrateUsers(
  source: StorageAdapter,
  target: StorageAdapter,
  dryRun: boolean,
): Promise<number> {
  const users = await source.users.listUsers();
  if (dryRun) return users.length;

  let count = 0;
  for (const user of users) {
    const existing = await target.users.getUserByUsername(user.username);
    if (existing !== null) continue;

    // createUser generates a new password hash. Since we cannot access the
    // raw hash through the StorageAdapter interface, we create the user with a
    // random placeholder password. The user will need to reset their password
    // after migration, or the adapter can be extended to support raw-hash import.
    const placeholder = `migrate-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const created = await target.users.createUser(user.username, placeholder, user.role);

    if (!user.active) {
      await target.users.deactivateUser(created.id);
    }
    count++;
  }
  return count;
}

async function migrateRoles(
  source: StorageAdapter,
  target: StorageAdapter,
  dryRun: boolean,
): Promise<number> {
  const roles = await source.roles.listRoles();
  if (dryRun) return roles.length;

  let count = 0;
  for (const role of roles) {
    const existing = await target.roles.getRoleByName(role.name);
    if (existing !== null) continue;

    // createRole includes permissions
    await target.roles.createRole({
      name: role.name,
      description: role.description,
      permissions: role.permissions,
      orgId: role.orgId,
    });
    count++;
  }
  return count;
}

async function migrateTeams(
  source: StorageAdapter,
  target: StorageAdapter,
  dryRun: boolean,
): Promise<number> {
  const teams = await source.teams.listTeams();
  if (dryRun) return teams.length;

  let count = 0;
  for (const team of teams) {
    const existing = await target.teams.getTeamByName(team.name, team.orgId);
    if (existing !== null) continue;

    const created = await target.teams.createTeam({
      name: team.name,
      description: team.description,
      orgId: team.orgId,
    });

    // Migrate team members
    const members = await source.teams.listTeamMembers(team.id);
    for (const member of members) {
      try {
        await target.teams.addTeamMember(created.id, member.userId, member.role);
      } catch {
        // Member may not exist in target yet — skip
      }
    }
    count++;
  }
  return count;
}

async function migrateScans(
  source: StorageAdapter,
  target: StorageAdapter,
  dryRun: boolean,
): Promise<number> {
  const scans = await source.scans.listScans();
  if (dryRun) return scans.length;

  let count = 0;
  for (const scan of scans) {
    const existing = await target.scans.getScan(scan.id);
    if (existing !== null) continue;

    await target.scans.createScan({
      id: scan.id,
      siteUrl: scan.siteUrl,
      standard: scan.standard,
      jurisdictions: scan.jurisdictions,
      regulations: scan.regulations ?? [],
      createdBy: scan.createdBy,
      createdAt: scan.createdAt,
      orgId: scan.orgId,
    });

    // Update with completion data if the scan has progressed beyond creation
    if (scan.status !== 'queued') {
      await target.scans.updateScan(scan.id, {
        status: scan.status,
        completedAt: scan.completedAt,
        pagesScanned: scan.pagesScanned,
        totalIssues: scan.totalIssues,
        errors: scan.errors,
        warnings: scan.warnings,
        notices: scan.notices,
        confirmedViolations: scan.confirmedViolations,
        jsonReportPath: scan.jsonReportPath,
        jsonReport: scan.jsonReport,
        error: scan.error,
      });
    }
    count++;
  }
  return count;
}

async function migrateSchedules(
  source: StorageAdapter,
  target: StorageAdapter,
  dryRun: boolean,
): Promise<number> {
  const schedules = await source.schedules.listSchedules();
  if (dryRun) return schedules.length;

  let count = 0;
  for (const sched of schedules) {
    const existing = await target.schedules.getSchedule(sched.id);
    if (existing !== null) continue;

    await target.schedules.createSchedule({
      id: sched.id,
      siteUrl: sched.siteUrl,
      standard: sched.standard,
      scanMode: sched.scanMode,
      jurisdictions: sched.jurisdictions,
      frequency: sched.frequency,
      nextRunAt: sched.nextRunAt,
      createdBy: sched.createdBy,
      orgId: sched.orgId,
      runner: sched.runner ?? undefined,
      incremental: sched.incremental,
    });

    if (!sched.enabled || sched.lastRunAt !== null) {
      await target.schedules.updateSchedule(sched.id, {
        enabled: sched.enabled,
        lastRunAt: sched.lastRunAt ?? undefined,
      });
    }
    count++;
  }
  return count;
}

async function migrateAssignments(
  source: StorageAdapter,
  target: StorageAdapter,
  dryRun: boolean,
): Promise<number> {
  const assignments = await source.assignments.listAssignments();
  if (dryRun) return assignments.length;

  let count = 0;
  for (const a of assignments) {
    const existing = await target.assignments.getAssignment(a.id);
    if (existing !== null) continue;

    await target.assignments.createAssignment({
      id: a.id,
      scanId: a.scanId,
      issueFingerprint: a.issueFingerprint,
      wcagCriterion: a.wcagCriterion,
      wcagTitle: a.wcagTitle,
      severity: a.severity,
      message: a.message,
      selector: a.selector,
      pageUrl: a.pageUrl,
      status: a.status,
      assignedTo: a.assignedTo,
      notes: a.notes,
      createdBy: a.createdBy,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      orgId: a.orgId,
    });
    count++;
  }
  return count;
}

async function migrateRepos(
  source: StorageAdapter,
  target: StorageAdapter,
  dryRun: boolean,
): Promise<number> {
  const repos = await source.repos.listRepos();
  if (dryRun) return repos.length;

  let count = 0;
  for (const repo of repos) {
    const existing = await target.repos.getRepo(repo.id);
    if (existing !== null) continue;

    await target.repos.createRepo({
      id: repo.id,
      siteUrlPattern: repo.siteUrlPattern,
      repoUrl: repo.repoUrl,
      repoPath: repo.repoPath ?? undefined,
      branch: repo.branch,
      authToken: repo.authToken ?? undefined,
      createdBy: repo.createdBy,
      orgId: repo.orgId,
    });
    count++;
  }
  return count;
}

async function migrateEmail(
  source: StorageAdapter,
  target: StorageAdapter,
  dryRun: boolean,
  sourceAdapter: StorageAdapter,
): Promise<number> {
  let count = 0;

  // Migrate SMTP config for each org (and the default 'system' org)
  const orgs = await sourceAdapter.organizations.listOrgs();
  const orgIds = ['system', ...orgs.map((o) => o.id)];

  for (const orgId of orgIds) {
    const smtpConfig = await source.email.getSmtpConfig(orgId);
    if (smtpConfig !== null) {
      count++;
      if (!dryRun) {
        await target.email.upsertSmtpConfig({
          host: smtpConfig.host,
          port: smtpConfig.port,
          secure: smtpConfig.secure,
          username: smtpConfig.username,
          password: smtpConfig.password,
          fromAddress: smtpConfig.fromAddress,
          fromName: smtpConfig.fromName,
          orgId: smtpConfig.orgId,
        });
      }
    }
  }

  // Migrate email reports
  const reports = await source.email.listEmailReports();
  count += reports.length;
  if (!dryRun) {
    for (const report of reports) {
      const existing = await target.email.getEmailReport(report.id);
      if (existing !== null) continue;

      await target.email.createEmailReport({
        id: report.id,
        name: report.name,
        siteUrl: report.siteUrl,
        recipients: report.recipients,
        frequency: report.frequency,
        format: report.format,
        includeCsv: report.includeCsv,
        nextSendAt: report.nextSendAt,
        createdBy: report.createdBy,
        orgId: report.orgId,
      });

      // Update fields that createEmailReport may not set
      if (!report.enabled || report.lastSentAt !== null) {
        await target.email.updateEmailReport(report.id, {
          enabled: report.enabled,
          lastSentAt: report.lastSentAt ?? undefined,
        });
      }
    }
  }

  return count;
}

async function migrateAuditLog(
  source: StorageAdapter,
  target: StorageAdapter,
  dryRun: boolean,
): Promise<number> {
  // Fetch all audit entries (use a large limit)
  const { entries, total } = await source.audit.query({ limit: 200 });
  if (dryRun) return total;

  // Audit log entries are write-only via log() which generates a new id.
  // We still migrate them so the target has the history, accepting new ids.
  let migrated = 0;
  let offset = 0;
  let batch = entries;

  while (batch.length > 0) {
    for (const entry of batch) {
      await target.audit.log({
        actor: entry.actor,
        actorId: entry.actorId ?? undefined,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? undefined,
        details: entry.details ?? undefined,
        ipAddress: entry.ipAddress ?? undefined,
        orgId: entry.orgId,
      });
      migrated++;
    }
    offset += batch.length;
    if (offset >= total) break;
    const next = await source.audit.query({ limit: 200, offset });
    batch = next.entries;
  }

  return migrated;
}

async function migratePlugins(
  source: StorageAdapter,
  target: StorageAdapter,
  dryRun: boolean,
): Promise<number> {
  const plugins = await source.plugins.listPlugins();
  if (dryRun) return plugins.length;

  let count = 0;
  for (const plugin of plugins) {
    const existing = await target.plugins.getPlugin(plugin.id);
    if (existing !== null) continue;

    await target.plugins.createPlugin({
      id: plugin.id,
      packageName: plugin.packageName,
      type: plugin.type,
      version: plugin.version,
      config: plugin.config as Record<string, unknown>,
      status: plugin.status,
    });

    if (plugin.activatedAt !== undefined || plugin.error !== undefined) {
      await target.plugins.updatePlugin(plugin.id, {
        activatedAt: plugin.activatedAt ?? null,
        error: plugin.error ?? null,
      });
    }
    count++;
  }
  return count;
}

async function migrateApiKeys(
  source: StorageAdapter,
  target: StorageAdapter,
  dryRun: boolean,
): Promise<number> {
  const keys = await source.apiKeys.listKeys();
  if (dryRun) return keys.length;

  let count = 0;
  for (const key of keys) {
    // storeKey takes the raw key string, but we only have the record.
    // We store a placeholder since the raw key is hashed and not recoverable.
    // API keys should be regenerated after migration.
    try {
      await target.apiKeys.storeKey(`migrated-${key.id}`, key.label, key.orgId);
      count++;
    } catch {
      // Key may already exist — skip
    }
  }
  return count;
}

async function migratePageHashes(
  source: StorageAdapter,
  target: StorageAdapter,
  dryRun: boolean,
  sourceAdapter: StorageAdapter,
): Promise<number> {
  // PageHashRepository only exposes getPageHashes(siteUrl, orgId).
  // We need to discover all siteUrls from scans to enumerate hashes.
  const scans = await sourceAdapter.scans.listScans();
  const orgs = await sourceAdapter.organizations.listOrgs();

  // Build unique (siteUrl, orgId) pairs
  const pairs = new Set<string>();
  const pairList: Array<{ siteUrl: string; orgId: string }> = [];
  for (const scan of scans) {
    const key = `${scan.siteUrl}||${scan.orgId}`;
    if (!pairs.has(key)) {
      pairs.add(key);
      pairList.push({ siteUrl: scan.siteUrl, orgId: scan.orgId });
    }
  }
  // Also check orgs without scans — unlikely to have hashes but be thorough
  for (const org of orgs) {
    // We already covered org IDs from scans, but there may be hashes for other sites
    // The interface doesn't allow enumerating all, so we rely on scan data
    void org;
  }

  let count = 0;
  for (const { siteUrl, orgId } of pairList) {
    const hashes = await source.pageHashes.getPageHashes(siteUrl, orgId);
    count += hashes.size;
    if (!dryRun && hashes.size > 0) {
      const entries = Array.from(hashes.entries()).map(([pageUrl, hash]) => ({
        siteUrl,
        pageUrl,
        hash,
        orgId,
      }));
      await target.pageHashes.upsertPageHashes(entries);
    }
  }

  return count;
}

async function migrateManualTests(
  source: StorageAdapter,
  target: StorageAdapter,
  dryRun: boolean,
  sourceAdapter: StorageAdapter,
): Promise<number> {
  // ManualTestRepository only exposes getManualTests(scanId).
  // Enumerate scanIds from the scans repository.
  const scans = await sourceAdapter.scans.listScans();

  let count = 0;
  for (const scan of scans) {
    const tests = await source.manualTests.getManualTests(scan.id);
    count += tests.length;
    if (!dryRun) {
      for (const test of tests) {
        try {
          await target.manualTests.upsertManualTest({
            scanId: test.scanId,
            criterionId: test.criterionId,
            status: test.status,
            notes: test.notes,
            testedBy: test.testedBy,
            testedAt: test.testedAt,
            orgId: test.orgId,
          });
        } catch {
          // May already exist — upsert should handle it
        }
      }
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Main migration function
// ---------------------------------------------------------------------------

export async function migrateData(options: MigrationOptions): Promise<MigrationResult> {
  const { source, target, dryRun = false, onProgress } = options;
  const start = Date.now();
  const tables: Array<{ name: string; count: number }> = [];

  const steps: ReadonlyArray<{
    readonly name: string;
    readonly fn: () => Promise<number>;
  }> = [
    { name: 'organizations', fn: () => migrateOrganizations(source, target, dryRun) },
    { name: 'dashboard_users', fn: () => migrateUsers(source, target, dryRun) },
    { name: 'roles', fn: () => migrateRoles(source, target, dryRun) },
    { name: 'teams', fn: () => migrateTeams(source, target, dryRun) },
    { name: 'scan_records', fn: () => migrateScans(source, target, dryRun) },
    { name: 'scan_schedules', fn: () => migrateSchedules(source, target, dryRun) },
    { name: 'issue_assignments', fn: () => migrateAssignments(source, target, dryRun) },
    { name: 'connected_repos', fn: () => migrateRepos(source, target, dryRun) },
    { name: 'email_reports', fn: () => migrateEmail(source, target, dryRun, source) },
    { name: 'audit_log', fn: () => migrateAuditLog(source, target, dryRun) },
    { name: 'plugins', fn: () => migratePlugins(source, target, dryRun) },
    { name: 'api_keys', fn: () => migrateApiKeys(source, target, dryRun) },
    { name: 'page_hashes', fn: () => migratePageHashes(source, target, dryRun, source) },
    { name: 'manual_test_results', fn: () => migrateManualTests(source, target, dryRun, source) },
  ];

  for (const step of steps) {
    const count = await step.fn();
    tables.push({ name: step.name, count });
    if (onProgress !== undefined) {
      onProgress(step.name, count);
    }
  }

  const totalRecords = tables.reduce((sum, t) => sum + t.count, 0);
  const durationMs = Date.now() - start;

  return { tables, totalRecords, durationMs };
}
