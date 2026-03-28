import type { ConnectedRepo } from '../types.js';

export interface RepoRepository {
  listRepos(orgId?: string): Promise<ConnectedRepo[]>;
  getRepo(id: string): Promise<ConnectedRepo | null>;
  findRepoForUrl(siteUrl: string, orgId: string): Promise<ConnectedRepo | null>;
  createRepo(data: {
    readonly id: string;
    readonly siteUrlPattern: string;
    readonly repoUrl: string;
    readonly repoPath?: string;
    readonly branch?: string;
    readonly authToken?: string;
    readonly gitHostConfigId?: string;
    readonly createdBy: string;
    readonly orgId?: string;
  }): Promise<ConnectedRepo>;
  deleteRepo(id: string): Promise<void>;
}
