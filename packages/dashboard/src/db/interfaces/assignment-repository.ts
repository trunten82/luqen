import type { IssueAssignment, IssueAssignmentStatus, AssignmentFilters, AssignmentStats, CreateAssignmentInput } from '../types.js';

export interface AssignmentRepository {
  listAssignments(filters?: AssignmentFilters): Promise<IssueAssignment[]>;
  getAssignment(id: string): Promise<IssueAssignment | null>;
  getAssignmentByFingerprint(scanId: string, fingerprint: string): Promise<IssueAssignment | null>;
  createAssignment(data: CreateAssignmentInput): Promise<IssueAssignment>;
  updateAssignment(id: string, data: { status?: IssueAssignmentStatus; assignedTo?: string; notes?: string }): Promise<void>;
  deleteAssignment(id: string): Promise<void>;
  getAssignmentStats(scanId: string): Promise<AssignmentStats>;
}
