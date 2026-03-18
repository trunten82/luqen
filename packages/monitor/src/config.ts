// Monitor configuration
import { VERSION } from './version.js';

export interface MonitorConfig {
  readonly complianceUrl: string;
  readonly complianceClientId: string;
  readonly complianceClientSecret: string;
  /** Cron expression or "manual" */
  readonly checkInterval: string;
  /** User-Agent string for HTTP requests to legal sources */
  readonly userAgent: string;
  /** Organisation ID for multi-tenant scoping (omit for system-wide) */
  readonly orgId?: string;
}

export function loadConfig(): MonitorConfig {
  return {
    complianceUrl: process.env.MONITOR_COMPLIANCE_URL ?? 'http://localhost:4000',
    complianceClientId: process.env.MONITOR_CLIENT_ID ?? '',
    complianceClientSecret: process.env.MONITOR_CLIENT_SECRET ?? '',
    checkInterval: process.env.MONITOR_CHECK_INTERVAL ?? 'manual',
    userAgent:
      process.env.MONITOR_USER_AGENT ??
      `luqen-monitor/${VERSION} (+https://github.com/luqen)`,
    orgId: process.env.MONITOR_ORG_ID ?? undefined,
  };
}
