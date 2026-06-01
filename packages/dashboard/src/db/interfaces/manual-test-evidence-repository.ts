import type {
  AddManualTestEvidenceInput,
  CriterionEvidenceCount,
  ManualTestEvidenceRecord,
} from '../types.js';

/**
 * Manual-test evidence artifacts (Slice C).
 *
 * Stores file-metadata rows (N per scan+criterion) that support the manual-test
 * verdicts held in {@link ManualTestRepository}. The bytes live on disk; this
 * repository only tracks metadata + the served path. The per-criterion count is
 * surfaced in the VPAT/ACR remarks.
 */
export interface ManualTestEvidenceRepository {
  /** All evidence rows for a scan, ordered by criterion then upload time. */
  listEvidence(scanId: string): Promise<ManualTestEvidenceRecord[]>;
  /** A single evidence row by id (null when absent). */
  getEvidence(id: string): Promise<ManualTestEvidenceRecord | null>;
  /** Insert one evidence row; returns the persisted record. */
  addEvidence(data: AddManualTestEvidenceInput): Promise<ManualTestEvidenceRecord>;
  /** Delete one evidence row by id; returns true when a row was removed. */
  deleteEvidence(id: string): Promise<boolean>;
  /** Per-criterion evidence counts for a scan (used by the VPAT builder). */
  countByCriterion(scanId: string): Promise<CriterionEvidenceCount[]>;
}
