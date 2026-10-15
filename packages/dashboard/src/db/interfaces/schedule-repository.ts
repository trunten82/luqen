import type { ScanSchedule, CreateScheduleInput } from '../types.js';

export interface ScheduleRepository {
  listSchedules(orgId?: string): Promise<ScanSchedule[]>;
  getSchedule(id: string): Promise<ScanSchedule | null>;
  createSchedule(data: CreateScheduleInput): Promise<ScanSchedule>;
  updateSchedule(id: string, data: Partial<{ enabled: boolean; nextRunAt: string; lastRunAt: string }>): Promise<void>;
  deleteSchedule(id: string): Promise<void>;
  /** Enabled schedules whose next run is at or before `now` (default: the current time). */
  getDueSchedules(now?: Date): Promise<ScanSchedule[]>;
}
