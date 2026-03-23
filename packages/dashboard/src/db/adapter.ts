import type { ScanRepository } from './interfaces/scan-repository.js';
import type { UserRepository } from './interfaces/user-repository.js';
import type { OrgRepository } from './interfaces/org-repository.js';
import type { ScheduleRepository } from './interfaces/schedule-repository.js';
import type { AssignmentRepository } from './interfaces/assignment-repository.js';
import type { RepoRepository } from './interfaces/repo-repository.js';
import type { RoleRepository } from './interfaces/role-repository.js';
import type { TeamRepository } from './interfaces/team-repository.js';
import type { EmailRepository } from './interfaces/email-repository.js';
import type { AuditRepository } from './interfaces/audit-repository.js';
import type { PluginRepository } from './interfaces/plugin-repository.js';
import type { ApiKeyRepository } from './interfaces/api-key-repository.js';
import type { PageHashRepository } from './interfaces/page-hash-repository.js';
import type { ManualTestRepository } from './interfaces/manual-test-repository.js';

export interface StorageAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  migrate(): Promise<void>;
  healthCheck(): Promise<boolean>;
  readonly name: string;

  readonly scans: ScanRepository;
  readonly users: UserRepository;
  readonly organizations: OrgRepository;
  readonly schedules: ScheduleRepository;
  readonly assignments: AssignmentRepository;
  readonly repos: RepoRepository;
  readonly roles: RoleRepository;
  readonly teams: TeamRepository;
  readonly email: EmailRepository;
  readonly audit: AuditRepository;
  readonly plugins: PluginRepository;
  readonly apiKeys: ApiKeyRepository;
  readonly pageHashes: PageHashRepository;
  readonly manualTests: ManualTestRepository;
}
