import type { StorageAdapter } from '../adapter.js';
import { createSqliteConnection } from './connection.js';
import { MigrationRunner, DASHBOARD_MIGRATIONS } from './migrations.js';
import {
  SqliteScanRepository,
  SqliteUserRepository,
  SqliteOrgRepository,
  SqliteScheduleRepository,
  SqliteAssignmentRepository,
  SqliteRepoRepository,
  SqliteRoleRepository,
  SqliteTeamRepository,
  SqliteEmailRepository,
  SqliteAuditRepository,
  SqlitePluginRepository,
  SqliteApiKeyRepository,
  SqlitePageHashRepository,
  SqliteManualTestRepository,
  SqliteGitHostRepository,
  SqliteBrandingRepository,
  SqliteBrandScoreRepository,
  SqliteConversationRepository,
} from './repositories/index.js';
import type Database from 'better-sqlite3';

export class SqliteStorageAdapter implements StorageAdapter {
  readonly name = 'sqlite';
  private readonly db: Database.Database;

  readonly scans: SqliteScanRepository;
  readonly users: SqliteUserRepository;
  readonly organizations: SqliteOrgRepository;
  readonly schedules: SqliteScheduleRepository;
  readonly assignments: SqliteAssignmentRepository;
  readonly repos: SqliteRepoRepository;
  readonly roles: SqliteRoleRepository;
  readonly teams: SqliteTeamRepository;
  readonly email: SqliteEmailRepository;
  readonly audit: SqliteAuditRepository;
  readonly plugins: SqlitePluginRepository;
  readonly apiKeys: SqliteApiKeyRepository;
  readonly pageHashes: SqlitePageHashRepository;
  readonly manualTests: SqliteManualTestRepository;
  readonly gitHosts: SqliteGitHostRepository;
  readonly branding: SqliteBrandingRepository;
  readonly brandScores: SqliteBrandScoreRepository;
  readonly conversations: SqliteConversationRepository;

  constructor(dbPath: string) {
    this.db = createSqliteConnection({ dbPath });
    this.scans = new SqliteScanRepository(this.db);
    this.users = new SqliteUserRepository(this.db);
    this.organizations = new SqliteOrgRepository(this.db);
    this.schedules = new SqliteScheduleRepository(this.db);
    this.assignments = new SqliteAssignmentRepository(this.db);
    this.repos = new SqliteRepoRepository(this.db);
    this.roles = new SqliteRoleRepository(this.db);
    this.teams = new SqliteTeamRepository(this.db);
    this.email = new SqliteEmailRepository(this.db);
    this.audit = new SqliteAuditRepository(this.db);
    this.plugins = new SqlitePluginRepository(this.db);
    this.apiKeys = new SqliteApiKeyRepository(this.db);
    this.pageHashes = new SqlitePageHashRepository(this.db);
    this.manualTests = new SqliteManualTestRepository(this.db);
    this.gitHosts = new SqliteGitHostRepository(this.db);
    this.branding = new SqliteBrandingRepository(this.db);
    this.brandScores = new SqliteBrandScoreRepository(this.db);
    this.conversations = new SqliteConversationRepository(this.db);
  }

  async connect(): Promise<void> {
    // SQLite connection is synchronous, done in constructor
  }

  async disconnect(): Promise<void> {
    this.db.close();
  }

  async migrate(): Promise<void> {
    new MigrationRunner(this.db).run(DASHBOARD_MIGRATIONS);
  }

  async healthCheck(): Promise<boolean> {
    try {
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  /** Escape hatch for code that still needs raw DB access during migration. */
  getRawDatabase(): Database.Database {
    return this.db;
  }
}
