import type { PageHashEntry } from '../types.js';

export interface PageHashRepository {
  getPageHashes(siteUrl: string, orgId: string): Promise<Map<string, string>>;
  upsertPageHash(siteUrl: string, pageUrl: string, hash: string, orgId: string): Promise<void>;
  upsertPageHashes(entries: ReadonlyArray<PageHashEntry>): Promise<void>;
}
