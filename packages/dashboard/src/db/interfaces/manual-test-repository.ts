import type { ManualTestResult, UpsertManualTestInput } from '../types.js';

export interface ManualTestRepository {
  getManualTests(scanId: string): Promise<ManualTestResult[]>;
  upsertManualTest(data: UpsertManualTestInput): Promise<ManualTestResult>;
}
