/**
 * The Audit Log filter option lists (Phase 95, AUD-02, D-04).
 *
 * The Action and Resource Type selects are built here, not hard-coded in the template, for two
 * reasons:
 *   - the dismissal entries come from the constants the dismissal store writes its audit rows with
 *     (ISSUE_DISMISSAL_AUDIT_ACTIONS), so a listed action and a written action cannot drift apart; a
 *     test fails when a dismissal action literal is written in src outside that constant, and the
 *     label record below fails tsc when a constant has no label;
 *   - the active filter always reads as selected: a value the list does not name (an address typed
 *     by hand, or an action another feature writes) is appended as one extra selected option, so the
 *     page never says "All actions" while a filter is applied. The template prints every value and
 *     label with double braces, so the appended text is escaped.
 */
import {
  ISSUE_DISMISSAL_AUDIT_ACTIONS,
  ISSUE_DISMISSAL_AUDIT_RESOURCE_TYPE,
  type IssueDismissalAuditAction,
} from '../../db/interfaces/issue-dismissal-repository.js';

/** One option of a filter select as the template prints it: a literal label or a locale key. */
export interface FilterOption {
  readonly value: string;
  readonly label?: string;
  readonly labelKey?: string;
  readonly selected: boolean;
}

type ListedOption = Omit<FilterOption, 'selected'>;

/** A label key for every dismissal audit action; a new constant without one fails tsc. */
const DISMISSAL_ACTION_LABEL_KEYS: Readonly<Record<IssueDismissalAuditAction, string>> = {
  [ISSUE_DISMISSAL_AUDIT_ACTIONS.mark]: 'audit.actionIssueDismissalMark',
  [ISSUE_DISMISSAL_AUDIT_ACTIONS.revoke]: 'audit.actionIssueDismissalRevoke',
};

const LISTED_ACTIONS: readonly ListedOption[] = [
  { value: 'login.success', label: 'Login success' },
  { value: 'login.failure', label: 'Login failure' },
  { value: 'user.create', label: 'User create' },
  { value: 'user.delete', label: 'User delete' },
  { value: 'user.activate', label: 'User activate' },
  { value: 'user.deactivate', label: 'User deactivate' },
  { value: 'user.role_change', label: 'User role change' },
  { value: 'api_key.create', label: 'API key create' },
  { value: 'api_key.delete', label: 'API key delete' },
  { value: 'plugin.install', label: 'Plugin install' },
  { value: 'plugin.activate', label: 'Plugin activate' },
  { value: 'plugin.deactivate', label: 'Plugin deactivate' },
  ...Object.values(ISSUE_DISMISSAL_AUDIT_ACTIONS).map((value) => ({
    value,
    labelKey: DISMISSAL_ACTION_LABEL_KEYS[value],
  })),
];

const LISTED_RESOURCE_TYPES: readonly ListedOption[] = [
  { value: 'session', label: 'Session' },
  { value: 'user', label: 'User' },
  { value: 'api_key', label: 'API key' },
  { value: 'plugin', label: 'Plugin' },
  { value: ISSUE_DISMISSAL_AUDIT_RESOURCE_TYPE, labelKey: 'audit.resourceIssueDismissal' },
];

/**
 * New option list for a select: each listed option with `selected` set when it is the active value,
 * then, when the active value is non-empty and not listed, one extra selected option showing it.
 */
export function buildFilterOptions(listed: readonly ListedOption[], active: string): readonly FilterOption[] {
  const options = listed.map((option) => ({ ...option, selected: option.value === active }));
  if (active === '' || listed.some((option) => option.value === active)) return options;
  return [...options, { value: active, label: active, selected: true }];
}

export function actionOptions(active: string): readonly FilterOption[] {
  return buildFilterOptions(LISTED_ACTIONS, active);
}

export function resourceTypeOptions(active: string): readonly FilterOption[] {
  return buildFilterOptions(LISTED_RESOURCE_TYPES, active);
}
