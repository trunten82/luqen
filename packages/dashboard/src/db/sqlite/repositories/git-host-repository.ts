import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  GitHostRepository,
  CreateGitHostConfigInput,
  StoreCredentialInput,
  DeveloperCredentialRow,
} from '../../interfaces/git-host-repository.js';
import type { GitHostConfig, DeveloperCredential } from '../../types.js';

// ---------------------------------------------------------------------------
// Private row types and conversion
// ---------------------------------------------------------------------------

interface GitHostConfigRow {
  id: string;
  org_id: string;
  plugin_type: string;
  host_url: string;
  display_name: string;
  created_at: string;
}

interface CredentialRow {
  id: string;
  user_id: string;
  git_host_config_id: string;
  encrypted_token: string;
  token_hint: string;
  validated_username: string | null;
  created_at: string;
}

function configRowToRecord(row: GitHostConfigRow): GitHostConfig {
  return {
    id: row.id,
    orgId: row.org_id,
    pluginType: row.plugin_type,
    hostUrl: row.host_url,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

function credentialRowToRecord(row: CredentialRow): DeveloperCredential {
  return {
    id: row.id,
    userId: row.user_id,
    gitHostConfigId: row.git_host_config_id,
    tokenHint: row.token_hint,
    validatedUsername: row.validated_username,
    createdAt: row.created_at,
  };
}

function credentialRowToFullRecord(row: CredentialRow): DeveloperCredentialRow {
  return {
    ...credentialRowToRecord(row),
    encryptedToken: row.encrypted_token,
  };
}

// ---------------------------------------------------------------------------
// SqliteGitHostRepository
// ---------------------------------------------------------------------------

export class SqliteGitHostRepository implements GitHostRepository {
  constructor(private readonly db: Database.Database) {}

  async createConfig(input: CreateGitHostConfigInput): Promise<GitHostConfig> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO git_host_configs (id, org_id, plugin_type, host_url, display_name, created_at)
      VALUES (@id, @orgId, @pluginType, @hostUrl, @displayName, @createdAt)
    `).run({
      id,
      orgId: input.orgId,
      pluginType: input.pluginType,
      hostUrl: input.hostUrl,
      displayName: input.displayName,
      createdAt: now,
    });

    const created = await this.getConfig(id);
    if (created === null) {
      throw new Error(`Failed to retrieve git host config after creation: ${id}`);
    }
    return created;
  }

  async getConfig(id: string): Promise<GitHostConfig | null> {
    const row = this.db.prepare('SELECT * FROM git_host_configs WHERE id = ?').get(id) as GitHostConfigRow | undefined;
    return row !== undefined ? configRowToRecord(row) : null;
  }

  async listConfigs(orgId: string): Promise<GitHostConfig[]> {
    const rows = this.db.prepare(
      'SELECT * FROM git_host_configs WHERE org_id = ? ORDER BY created_at DESC',
    ).all(orgId) as GitHostConfigRow[];
    return rows.map(configRowToRecord);
  }

  async deleteConfig(id: string): Promise<void> {
    this.db.prepare('DELETE FROM git_host_configs WHERE id = ?').run(id);
  }

  async storeCredential(input: StoreCredentialInput): Promise<DeveloperCredential> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT OR REPLACE INTO developer_credentials
        (id, user_id, git_host_config_id, encrypted_token, token_hint, validated_username, created_at)
      VALUES (
        COALESCE(
          (SELECT id FROM developer_credentials WHERE user_id = @userId AND git_host_config_id = @gitHostConfigId),
          @id
        ),
        @userId, @gitHostConfigId, @encryptedToken, @tokenHint, @validatedUsername, @createdAt
      )
    `).run({
      id,
      userId: input.userId,
      gitHostConfigId: input.gitHostConfigId,
      encryptedToken: input.encryptedToken,
      tokenHint: input.tokenHint,
      validatedUsername: input.validatedUsername ?? null,
      createdAt: now,
    });

    const stored = await this.getCredentialForHost(input.userId, input.gitHostConfigId);
    if (stored === null) {
      throw new Error(`Failed to retrieve credential after store for user=${input.userId} host=${input.gitHostConfigId}`);
    }
    return {
      id: stored.id,
      userId: stored.userId,
      gitHostConfigId: stored.gitHostConfigId,
      tokenHint: stored.tokenHint,
      validatedUsername: stored.validatedUsername,
      createdAt: stored.createdAt,
    };
  }

  async getCredentialForHost(userId: string, gitHostConfigId: string): Promise<DeveloperCredentialRow | null> {
    const row = this.db.prepare(
      'SELECT * FROM developer_credentials WHERE user_id = ? AND git_host_config_id = ?',
    ).get(userId, gitHostConfigId) as CredentialRow | undefined;
    return row !== undefined ? credentialRowToFullRecord(row) : null;
  }

  async listCredentials(userId: string): Promise<DeveloperCredential[]> {
    const rows = this.db.prepare(
      'SELECT * FROM developer_credentials WHERE user_id = ? ORDER BY created_at DESC',
    ).all(userId) as CredentialRow[];
    return rows.map(credentialRowToRecord);
  }

  async deleteCredential(id: string, userId: string): Promise<void> {
    this.db.prepare('DELETE FROM developer_credentials WHERE id = ? AND user_id = ?').run(id, userId);
  }
}
