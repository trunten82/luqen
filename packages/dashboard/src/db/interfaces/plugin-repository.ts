import type { PluginRecord } from '../types.js';

export interface PluginRepository {
  listPlugins(): Promise<PluginRecord[]>;
  getPlugin(id: string): Promise<PluginRecord | null>;
  getPluginByPackageName(packageName: string): Promise<PluginRecord | null>;
  listByTypeAndStatus(type: string, status: string): Promise<PluginRecord[]>;
  listByStatus(status: string): Promise<PluginRecord[]>;
  getByPackageNameAndStatus(packageName: string, status: string): Promise<PluginRecord | null>;
  createPlugin(data: {
    readonly id: string;
    readonly packageName: string;
    readonly type: string;
    readonly version: string;
    readonly config?: Record<string, unknown>;
    readonly status?: string;
  }): Promise<PluginRecord>;
  updatePlugin(id: string, data: Partial<{
    status: string;
    config: Record<string, unknown>;
    version: string;
    activatedAt: string | null;
    error: string | null;
  }>): Promise<void>;
  deletePlugin(id: string): Promise<void>;
}
