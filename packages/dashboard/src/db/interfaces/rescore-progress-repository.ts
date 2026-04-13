import type { RescoreProgress } from '../../services/rescore/rescore-types.js';

/**
 * Repository for tracking historical rescore progress per organization.
 *
 * Each org can have at most one active rescore progress row (UNIQUE org_id
 * constraint). The upsert method replaces the existing row when one exists,
 * enabling progress updates without requiring separate create/update paths.
 */
export interface RescoreProgressRepository {
  getByOrgId(orgId: string): Promise<RescoreProgress | null>;
  upsert(progress: RescoreProgress): Promise<void>;
  deleteByOrgId(orgId: string): Promise<void>;
}
