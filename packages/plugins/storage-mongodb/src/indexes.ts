import type { Db } from 'mongodb';

/**
 * Creates all collection indexes required by the MongoDB storage adapter.
 * Safe to call multiple times — MongoDB ignores duplicate index creation.
 */
export async function createIndexes(db: Db): Promise<void> {
  // scan_records
  const scans = db.collection('scan_records');
  await scans.createIndex({ status: 1 });
  await scans.createIndex({ createdBy: 1 });
  await scans.createIndex({ siteUrl: 1 });
  await scans.createIndex({ orgId: 1 });
  await scans.createIndex({ createdAt: -1 });
  await scans.createIndex({ orgId: 1, status: 1, createdAt: -1 });
  await scans.createIndex({ orgId: 1, siteUrl: 1, status: 1, createdAt: -1 });

  // dashboard_users
  const users = db.collection('dashboard_users');
  await users.createIndex({ username: 1 }, { unique: true });

  // organizations
  const orgs = db.collection('organizations');
  await orgs.createIndex({ slug: 1 }, { unique: true });

  // scan_schedules
  const schedules = db.collection('scan_schedules');
  await schedules.createIndex({ orgId: 1 });
  await schedules.createIndex({ nextRunAt: 1, enabled: 1 });

  // issue_assignments
  const assignments = db.collection('issue_assignments');
  await assignments.createIndex({ scanId: 1 });
  await assignments.createIndex({ assignedTo: 1 });
  await assignments.createIndex({ orgId: 1 });
  await assignments.createIndex({ scanId: 1, issueFingerprint: 1 }, { unique: true });

  // connected_repos
  const repos = db.collection('connected_repos');
  await repos.createIndex({ orgId: 1 });

  // roles (embed permissions as sub-array)
  const roles = db.collection('roles');
  await roles.createIndex({ name: 1 });
  await roles.createIndex({ orgId: 1 });

  // teams (embed members as sub-array)
  const teams = db.collection('teams');
  await teams.createIndex({ name: 1, orgId: 1 });
  await teams.createIndex({ orgId: 1 });

  // smtp_config
  const smtp = db.collection('smtp_config');
  await smtp.createIndex({ orgId: 1 }, { unique: true });

  // email_reports
  const emailReports = db.collection('email_reports');
  await emailReports.createIndex({ orgId: 1 });
  await emailReports.createIndex({ nextSendAt: 1, enabled: 1 });

  // audit_log
  const audit = db.collection('audit_log');
  await audit.createIndex({ timestamp: -1 });
  await audit.createIndex({ actor: 1 });
  await audit.createIndex({ action: 1 });
  await audit.createIndex({ resourceType: 1 });
  await audit.createIndex({ orgId: 1 });

  // plugins
  const plugins = db.collection('plugins');
  await plugins.createIndex({ packageName: 1 });
  await plugins.createIndex({ type: 1, status: 1 });
  await plugins.createIndex({ status: 1 });

  // api_keys
  const apiKeys = db.collection('api_keys');
  await apiKeys.createIndex({ keyHash: 1 });
  await apiKeys.createIndex({ orgId: 1 });

  // page_hashes
  const pageHashes = db.collection('page_hashes');
  await pageHashes.createIndex(
    { siteUrl: 1, pageUrl: 1, orgId: 1 },
    { unique: true },
  );

  // manual_test_results
  const manualTests = db.collection('manual_test_results');
  await manualTests.createIndex({ scanId: 1 });
  await manualTests.createIndex(
    { scanId: 1, criterionId: 1 },
    { unique: true },
  );
}
