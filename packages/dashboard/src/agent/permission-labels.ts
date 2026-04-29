/**
 * Phase 44 Plan 01 (AGENT-04) — Curated permission → human-friendly label
 * map used by the per-turn context block's "role hints" section.
 *
 * NOT a mirror of `permissions.ts` ALL_PERMISSIONS — only the highest-signal
 * capabilities are surfaced. The agent uses these as a hint about what the
 * caller is allowed to do, not as an authoritative permission table. RBAC is
 * still enforced via `resolvePermissions()` at tool-dispatch time.
 *
 * Keep this list short (5-8 entries). Adding more dilutes the signal and
 * burns tokens in every turn's system prompt.
 */
export const PERMISSION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'compliance.manage': 'manage regulations & proposals',
  'scans.create': 'run accessibility scans',
  'branding.manage': 'edit brand guidelines',
  'users.create': 'invite teammates',
  'reports.export': 'export scan reports',
  'admin.org': 'manage your organisation',
  'admin.system': 'system admin (all orgs)',
});

/**
 * Return a comma-separated list of human-friendly action labels matching the
 * caller's effective permissions. Returns null when no curated entry matches —
 * caller omits the section entirely (no orphan heading).
 *
 * Ordering follows the declaration order in PERMISSION_LABELS so the rendered
 * hint is stable across turns.
 */
export function formatRoleHints(perms: ReadonlySet<string>): string | null {
  if (perms.size === 0) return null;
  const matched: string[] = [];
  for (const [permId, label] of Object.entries(PERMISSION_LABELS)) {
    if (perms.has(permId)) {
      matched.push(label);
    }
  }
  if (matched.length === 0) return null;
  return matched.join(', ');
}
