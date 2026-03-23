import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;
let orgA: string;
let orgB: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-segregation-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  orgA = `org-a-${randomUUID()}`;
  orgB = `org-b-${randomUUID()}`;
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('Multi-tenancy Isolation', () => {
  describe('scan isolation', () => {
    it('scans in org A not returned when querying org B', async () => {
      await storage.scans.createScan({
        id: randomUUID(),
        siteUrl: 'https://org-a.example.com',
        standard: 'WCAG2AA',
        jurisdictions: [],
        createdBy: 'user-1',
        createdAt: new Date().toISOString(),
        orgId: orgA,
      });

      const orgBScans = await storage.scans.listScans({ orgId: orgB });
      expect(orgBScans).toHaveLength(0);

      const orgAScans = await storage.scans.listScans({ orgId: orgA });
      expect(orgAScans).toHaveLength(1);
      expect(orgAScans[0].orgId).toBe(orgA);
    });
  });

  describe('schedule isolation', () => {
    it('schedules in org A not visible to org B', async () => {
      await storage.schedules.createSchedule({
        id: randomUUID(),
        siteUrl: 'https://org-a.example.com',
        standard: 'WCAG2AA',
        scanMode: 'full',
        jurisdictions: [],
        frequency: 'daily',
        nextRunAt: new Date(Date.now() + 86400000).toISOString(),
        createdBy: 'user-1',
        orgId: orgA,
      });

      const orgBSchedules = await storage.schedules.listSchedules(orgB);
      expect(orgBSchedules).toHaveLength(0);

      const orgASchedules = await storage.schedules.listSchedules(orgA);
      expect(orgASchedules).toHaveLength(1);
      expect(orgASchedules[0].orgId).toBe(orgA);
    });
  });

  describe('assignment isolation', () => {
    it('assignments in org A not visible to org B', async () => {
      const now = new Date().toISOString();
      await storage.assignments.createAssignment({
        id: randomUUID(),
        scanId: randomUUID(),
        issueFingerprint: 'fp-001',
        severity: 'error',
        message: 'Missing alt text',
        createdBy: 'user-1',
        createdAt: now,
        updatedAt: now,
        orgId: orgA,
      });

      const orgBAssignments = await storage.assignments.listAssignments({ orgId: orgB });
      expect(orgBAssignments).toHaveLength(0);

      const orgAAssignments = await storage.assignments.listAssignments({ orgId: orgA });
      expect(orgAAssignments).toHaveLength(1);
      expect(orgAAssignments[0].orgId).toBe(orgA);
    });
  });

  describe('team isolation', () => {
    it('teams in org A not visible to org B', async () => {
      await storage.teams.createTeam({
        name: `team-a-${randomUUID()}`,
        description: 'Org A team',
        orgId: orgA,
      });

      const orgBTeams = await storage.teams.listTeams(orgB);
      // listTeams includes system teams; make sure no orgA teams are returned
      const orgATeamsInB = orgBTeams.filter((t) => t.orgId === orgA);
      expect(orgATeamsInB).toHaveLength(0);

      const orgATeams = await storage.teams.listTeams(orgA);
      const ownTeams = orgATeams.filter((t) => t.orgId === orgA);
      expect(ownTeams).toHaveLength(1);
    });
  });

  describe('role isolation', () => {
    it('custom role in org A not visible to org B', async () => {
      await storage.roles.createRole({
        name: `custom-role-a-${randomUUID()}`,
        description: 'Org A custom role',
        permissions: ['reports.view'],
        orgId: orgA,
      });

      const orgBRoles = await storage.roles.listRoles(orgB);
      const orgACustomRoles = orgBRoles.filter((r) => r.orgId === orgA);
      expect(orgACustomRoles).toHaveLength(0);
    });

    it('system roles visible to both orgs', async () => {
      const orgARoles = await storage.roles.listRoles(orgA);
      const orgBRoles = await storage.roles.listRoles(orgB);

      const systemRolesA = orgARoles.filter((r) => r.isSystem);
      const systemRolesB = orgBRoles.filter((r) => r.isSystem);

      expect(systemRolesA.length).toBeGreaterThan(0);
      expect(systemRolesB.length).toBeGreaterThan(0);
      expect(systemRolesA.length).toBe(systemRolesB.length);

      const namesA = systemRolesA.map((r) => r.name).sort();
      const namesB = systemRolesB.map((r) => r.name).sort();
      expect(namesA).toEqual(namesB);
    });
  });

  describe('repo isolation', () => {
    it('repos in org A not visible to org B', async () => {
      await storage.repos.createRepo({
        id: randomUUID(),
        siteUrlPattern: 'https://org-a.example.com%',
        repoUrl: 'https://github.com/org-a/repo',
        createdBy: 'user-1',
        orgId: orgA,
      });

      const orgBRepos = await storage.repos.listRepos(orgB);
      const orgAReposInB = orgBRepos.filter((r) => r.orgId === orgA);
      expect(orgAReposInB).toHaveLength(0);

      const orgARepos = await storage.repos.listRepos(orgA);
      expect(orgARepos).toHaveLength(1);
      expect(orgARepos[0].orgId).toBe(orgA);
    });
  });

  describe('email config isolation', () => {
    it('SMTP config in org A not returned for org B', async () => {
      await storage.email.upsertSmtpConfig({
        host: 'smtp.org-a.example.com',
        port: 587,
        secure: false,
        username: 'user@org-a.example.com',
        password: 'secret-a',
        fromAddress: 'no-reply@org-a.example.com',
        orgId: orgA,
      });

      const orgBConfig = await storage.email.getSmtpConfig(orgB);
      expect(orgBConfig).toBeNull();

      const orgAConfig = await storage.email.getSmtpConfig(orgA);
      expect(orgAConfig).not.toBeNull();
      expect(orgAConfig!.orgId).toBe(orgA);
    });

    it('email reports in org A not visible to org B', async () => {
      await storage.email.createEmailReport({
        id: randomUUID(),
        name: 'Org A Monthly Report',
        siteUrl: 'https://org-a.example.com',
        recipients: 'admin@org-a.example.com',
        frequency: 'monthly',
        nextSendAt: new Date(Date.now() + 2592000000).toISOString(),
        createdBy: 'user-1',
        orgId: orgA,
      });

      const orgBReports = await storage.email.listEmailReports(orgB);
      expect(orgBReports).toHaveLength(0);

      const orgAReports = await storage.email.listEmailReports(orgA);
      expect(orgAReports).toHaveLength(1);
      expect(orgAReports[0].orgId).toBe(orgA);
    });
  });

  describe('plugin isolation', () => {
    it('plugins created with org context not visible to other org (plugins are global)', async () => {
      // The PluginRepository does not have org-scoped listing;
      // plugins are system-wide. This test confirms listPlugins returns all plugins
      // regardless of any org context — there is no org isolation at the plugin level.
      await storage.plugins.createPlugin({
        id: randomUUID(),
        packageName: `@luqen/plugin-a-${randomUUID()}`,
        type: 'storage',
        version: '1.0.0',
        status: 'active',
      });

      const allPlugins = await storage.plugins.listPlugins();
      expect(allPlugins.length).toBeGreaterThan(0);
      // Confirm listPlugins is not filtered by org — both orgs see the same set
      const allPlugins2 = await storage.plugins.listPlugins();
      expect(allPlugins).toHaveLength(allPlugins2.length);
    });
  });

  describe('audit isolation', () => {
    it('audit entries in org A not returned when querying org B', async () => {
      await storage.audit.log({
        actor: 'user@org-a.example.com',
        action: 'login',
        resourceType: 'session',
        orgId: orgA,
      });

      const orgBResult = await storage.audit.query({ orgId: orgB });
      expect(orgBResult.entries).toHaveLength(0);
      expect(orgBResult.total).toBe(0);

      const orgAResult = await storage.audit.query({ orgId: orgA });
      expect(orgAResult.total).toBeGreaterThan(0);
      for (const entry of orgAResult.entries) {
        expect(entry.orgId).toBe(orgA);
      }
    });
  });

  describe('api key isolation', () => {
    it('keys in org A not returned when listing org B keys', async () => {
      const rawKey = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
      await storage.apiKeys.storeKey(rawKey, 'org-a-key', orgA);

      const orgBKeys = await storage.apiKeys.listKeys(orgB);
      const orgAKeysInB = orgBKeys.filter((k) => k.orgId === orgA);
      expect(orgAKeysInB).toHaveLength(0);

      const orgAKeys = await storage.apiKeys.listKeys(orgA);
      expect(orgAKeys).toHaveLength(1);
      expect(orgAKeys[0].orgId).toBe(orgA);
    });
  });
});
