import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { migrateData } from '../../src/db/migrate-data.js';
import type { MigrationResult } from '../../src/db/migrate-data.js';

function makeTempDb(): { storage: SqliteStorageAdapter; path: string } {
  const path = join(tmpdir(), `test-migrate-${randomUUID()}.db`);
  const storage = new SqliteStorageAdapter(path);
  void storage.migrate();
  return { storage, path };
}

describe('migrateData', () => {
  let source: SqliteStorageAdapter;
  let target: SqliteStorageAdapter;
  let sourcePath: string;
  let targetPath: string;

  beforeEach(() => {
    const s = makeTempDb();
    source = s.storage;
    sourcePath = s.path;
    const t = makeTempDb();
    target = t.storage;
    targetPath = t.path;
  });

  afterEach(() => {
    void source.disconnect();
    void target.disconnect();
    if (existsSync(sourcePath)) rmSync(sourcePath);
    if (existsSync(targetPath)) rmSync(targetPath);
  });

  async function seedSourceData(): Promise<void> {
    // Create an organization with a member
    const org = await source.organizations.createOrg({ name: 'Test Org', slug: 'test-org' });

    // Create users
    const user = await source.users.createUser('alice', 'password123', 'admin');
    await source.organizations.addMember(org.id, user.id, 'admin');

    const user2 = await source.users.createUser('bob', 'password456', 'user');
    await source.users.deactivateUser(user2.id);

    // Create role with permissions
    await source.roles.createRole({
      name: 'editor-role',
      description: 'Can edit content',
      permissions: ['scan:read', 'scan:write'],
      orgId: org.id,
    });

    // Create team with member
    const team = await source.teams.createTeam({
      name: 'Dev Team',
      description: 'Development team',
      orgId: org.id,
    });
    await source.teams.addTeamMember(team.id, user.id, 'lead');

    // Create scan
    const scanId = randomUUID();
    await source.scans.createScan({
      id: scanId,
      siteUrl: 'https://example.com',
      standard: 'WCAG2AA',
      jurisdictions: ['eu'],
      createdBy: user.username,
      createdAt: new Date().toISOString(),
      orgId: org.id,
    });
    await source.scans.updateScan(scanId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      pagesScanned: 5,
      totalIssues: 3,
      errors: 1,
      warnings: 1,
      notices: 1,
    });

    // Create schedule
    await source.schedules.createSchedule({
      id: randomUUID(),
      siteUrl: 'https://example.com',
      standard: 'WCAG2AA',
      scanMode: 'full',
      jurisdictions: ['eu'],
      frequency: 'weekly',
      nextRunAt: new Date().toISOString(),
      createdBy: user.username,
      orgId: org.id,
    });

    // Create assignment
    await source.assignments.createAssignment({
      id: randomUUID(),
      scanId,
      issueFingerprint: 'fp-001',
      wcagCriterion: '1.1.1',
      wcagTitle: 'Non-text Content',
      severity: 'error',
      message: 'Image missing alt text',
      selector: 'img.hero',
      pageUrl: 'https://example.com/',
      status: 'open',
      assignedTo: user.username,
      notes: null,
      createdBy: user.username,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      orgId: org.id,
    });

    // Create connected repo
    await source.repos.createRepo({
      id: randomUUID(),
      siteUrlPattern: 'https://example.com/*',
      repoUrl: 'https://github.com/test/repo',
      branch: 'main',
      createdBy: user.username,
      orgId: org.id,
    });

    // Create email report
    await source.email.createEmailReport({
      id: randomUUID(),
      name: 'Weekly Report',
      siteUrl: 'https://example.com',
      recipients: 'alice@example.com',
      frequency: 'weekly',
      nextSendAt: new Date().toISOString(),
      createdBy: user.username,
      orgId: org.id,
    });

    // SMTP config
    await source.email.upsertSmtpConfig({
      host: 'smtp.example.com',
      port: 587,
      secure: true,
      username: 'smtp-user',
      password: 'smtp-pass',
      fromAddress: 'noreply@example.com',
      fromName: 'Luqen',
      orgId: org.id,
    });

    // Audit log entry
    await source.audit.log({
      actor: user.username,
      action: 'scan.create',
      resourceType: 'scan',
      resourceId: scanId,
      orgId: org.id,
    });

    // Plugin
    await source.plugins.createPlugin({
      id: randomUUID(),
      packageName: '@luqen/plugin-test',
      type: 'scanner',
      version: '1.0.0',
      config: { key: 'value' },
      status: 'active',
    });

    // API key
    await source.apiKeys.storeKey('test-api-key-123', 'test-key', org.id);

    // Page hash
    await source.pageHashes.upsertPageHash(
      'https://example.com',
      'https://example.com/about',
      'abc123',
      org.id,
    );

    // Manual test result
    await source.manualTests.upsertManualTest({
      scanId,
      criterionId: 'manual-1.3.4',
      status: 'pass',
      notes: 'Orientation works fine',
      testedBy: user.username,
      testedAt: new Date().toISOString(),
      orgId: org.id,
    });
  }

  it('migrates all data between two SQLite adapters', async () => {
    await seedSourceData();

    const result = await migrateData({ source, target });

    expect(result.totalRecords).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.tables).toHaveLength(14);

    // Verify specific tables have data
    const tableMap = new Map(result.tables.map((t) => [t.name, t.count]));
    expect(tableMap.get('organizations')).toBe(1);
    expect(tableMap.get('dashboard_users')).toBe(2);
    expect(tableMap.get('roles')).toBe(1);
    expect(tableMap.get('teams')).toBe(1);
    expect(tableMap.get('scan_records')).toBe(1);
    expect(tableMap.get('scan_schedules')).toBe(1);
    expect(tableMap.get('issue_assignments')).toBe(1);
    expect(tableMap.get('connected_repos')).toBe(1);
    // email_reports includes SMTP config + 1 report
    expect(tableMap.get('email_reports')).toBe(2);
    expect(tableMap.get('audit_log')).toBe(1);
    expect(tableMap.get('plugins')).toBe(1);
    expect(tableMap.get('api_keys')).toBe(1);
    expect(tableMap.get('page_hashes')).toBe(1);
    expect(tableMap.get('manual_test_results')).toBe(1);

    // Verify data in target
    const targetOrgs = await target.organizations.listOrgs();
    expect(targetOrgs).toHaveLength(1);
    expect(targetOrgs[0].name).toBe('Test Org');

    const targetUsers = await target.users.listUsers();
    expect(targetUsers).toHaveLength(2);

    const alice = targetUsers.find((u) => u.username === 'alice');
    expect(alice).toBeDefined();
    expect(alice?.role).toBe('admin');
    expect(alice?.active).toBe(true);

    const bob = targetUsers.find((u) => u.username === 'bob');
    expect(bob).toBeDefined();
    expect(bob?.active).toBe(false);

    const targetScans = await target.scans.listScans();
    expect(targetScans).toHaveLength(1);
    expect(targetScans[0].status).toBe('completed');
    expect(targetScans[0].pagesScanned).toBe(5);

    const targetSchedules = await target.schedules.listSchedules();
    expect(targetSchedules).toHaveLength(1);

    const targetAssignments = await target.assignments.listAssignments();
    expect(targetAssignments).toHaveLength(1);
    expect(targetAssignments[0].wcagCriterion).toBe('1.1.1');

    const targetRepos = await target.repos.listRepos();
    expect(targetRepos).toHaveLength(1);

    const targetReports = await target.email.listEmailReports();
    expect(targetReports).toHaveLength(1);

    // SMTP config is migrated with the source org's ID
    const sourceOrgs = await source.organizations.listOrgs();
    const targetSmtp = await target.email.getSmtpConfig(sourceOrgs[0].id);
    expect(targetSmtp).not.toBeNull();
    expect(targetSmtp?.host).toBe('smtp.example.com');

    const targetPlugins = await target.plugins.listPlugins();
    expect(targetPlugins).toHaveLength(1);
    expect(targetPlugins[0].packageName).toBe('@luqen/plugin-test');
  });

  it('counts records without writing in dry-run mode', async () => {
    await seedSourceData();

    const result = await migrateData({ source, target, dryRun: true });

    expect(result.totalRecords).toBeGreaterThan(0);

    // Verify target is still empty
    const targetOrgs = await target.organizations.listOrgs();
    expect(targetOrgs).toHaveLength(0);

    const targetUsers = await target.users.listUsers();
    expect(targetUsers).toHaveLength(0);

    const targetScans = await target.scans.listScans();
    expect(targetScans).toHaveLength(0);
  });

  it('is idempotent — migrating the same data twice produces no duplicates', async () => {
    await seedSourceData();

    const first = await migrateData({ source, target });
    const second = await migrateData({ source, target });

    // Second run should skip existing records (count = 0 for most tables)
    const secondTableMap = new Map(second.tables.map((t) => [t.name, t.count]));

    // Organizations, users, roles, teams, scans, schedules, assignments, repos, plugins
    // should all be 0 because they already exist
    expect(secondTableMap.get('organizations')).toBe(0);
    expect(secondTableMap.get('dashboard_users')).toBe(0);
    expect(secondTableMap.get('roles')).toBe(0);
    expect(secondTableMap.get('teams')).toBe(0);
    expect(secondTableMap.get('scan_records')).toBe(0);
    expect(secondTableMap.get('scan_schedules')).toBe(0);
    expect(secondTableMap.get('issue_assignments')).toBe(0);
    expect(secondTableMap.get('connected_repos')).toBe(0);
    expect(secondTableMap.get('plugins')).toBe(0);

    // Verify target counts match first run
    const targetOrgs = await target.organizations.listOrgs();
    expect(targetOrgs).toHaveLength(1);

    const targetUsers = await target.users.listUsers();
    expect(targetUsers).toHaveLength(first.tables.find((t) => t.name === 'dashboard_users')!.count);

    const targetScans = await target.scans.listScans();
    expect(targetScans).toHaveLength(1);
  });

  it('handles empty source gracefully', async () => {
    const result = await migrateData({ source, target });

    expect(result.totalRecords).toBe(0);
    expect(result.tables).toHaveLength(14);

    for (const table of result.tables) {
      expect(table.count).toBe(0);
    }
  });

  it('calls progress callback for each table', async () => {
    await seedSourceData();

    const progressCalls: Array<{ table: string; count: number }> = [];

    await migrateData({
      source,
      target,
      onProgress: (table, count) => {
        progressCalls.push({ table, count });
      },
    });

    // Should have one callback per table
    expect(progressCalls).toHaveLength(14);

    // Verify the expected table names are reported
    const tableNames = progressCalls.map((c) => c.table);
    expect(tableNames).toContain('organizations');
    expect(tableNames).toContain('dashboard_users');
    expect(tableNames).toContain('roles');
    expect(tableNames).toContain('teams');
    expect(tableNames).toContain('scan_records');
    expect(tableNames).toContain('scan_schedules');
    expect(tableNames).toContain('issue_assignments');
    expect(tableNames).toContain('connected_repos');
    expect(tableNames).toContain('email_reports');
    expect(tableNames).toContain('audit_log');
    expect(tableNames).toContain('plugins');
    expect(tableNames).toContain('api_keys');
    expect(tableNames).toContain('page_hashes');
    expect(tableNames).toContain('manual_test_results');

    // organizations should be called first (index 0) to respect FK order
    expect(progressCalls[0].table).toBe('organizations');
  });

  it('reports correct duration', async () => {
    const result = await migrateData({ source, target });

    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
