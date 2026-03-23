export type { StorageAdapter } from './adapter.js';
export type { StorageConfig } from './factory.js';
export { resolveStorageAdapter } from './factory.js';
export { SqliteStorageAdapter } from './sqlite/index.js';
export { migrateData } from './migrate-data.js';
export type { MigrationOptions, MigrationResult } from './migrate-data.js';
export * from './types.js';
export type {
  ScanRepository,
  UserRepository,
  OrgRepository,
  ScheduleRepository,
  AssignmentRepository,
  RepoRepository,
  RoleRepository,
  TeamRepository,
  EmailRepository,
  AuditRepository,
  PluginRepository,
  ApiKeyRepository,
  PageHashRepository,
  ManualTestRepository,
} from './interfaces/index.js';
