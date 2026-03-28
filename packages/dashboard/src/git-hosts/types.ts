// packages/dashboard/src/git-hosts/types.ts

export interface GitHostValidation {
  readonly valid: boolean;
  readonly username?: string;
  readonly error?: string;
}

export interface GitHostFile {
  readonly path: string;
  readonly content: string;
}

export interface GitHostPullRequest {
  readonly url: string;
  readonly number: number;
}

export interface ReadFileOptions {
  readonly hostUrl: string;
  readonly repo: string;
  readonly path: string;
  readonly branch: string;
  readonly token: string;
}

export interface CreatePullRequestOptions {
  readonly hostUrl: string;
  readonly repo: string;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly title: string;
  readonly body: string;
  readonly changes: ReadonlyArray<GitHostFile>;
  readonly token: string;
}

export interface GitHostPlugin {
  readonly type: string;
  readonly displayName: string;
  validateToken(hostUrl: string, token: string): Promise<GitHostValidation>;
  readFile(options: ReadFileOptions): Promise<string | null>;
  listFiles(options: ReadFileOptions): Promise<readonly string[]>;
  createPullRequest(options: CreatePullRequestOptions): Promise<GitHostPullRequest>;
}
