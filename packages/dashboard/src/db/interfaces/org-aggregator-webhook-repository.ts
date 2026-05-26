/**
 * Phase 63.1 — Org-wide aggregator webhook subscriptions.
 *
 * Dashboard-side webhook table that the coordinated-PR audit dispatcher
 * fans events to. Distinct from the compliance service's webhook subsystem
 * (compliance-client.ts), which is a per-service event source. Aggregator
 * webhooks are dashboard-internal — they receive coordinated_pr.* events
 * after audit() succeeds.
 */

export interface OrgAggregatorWebhook {
  readonly id: string;
  readonly orgId: string;
  readonly url: string;
  readonly secret: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

export interface CreateOrgAggregatorWebhookInput {
  readonly id?: string;
  readonly orgId: string;
  readonly url: string;
  readonly secret?: string | null;
  readonly createdBy?: string | null;
}

export interface OrgAggregatorWebhookRepository {
  create(input: CreateOrgAggregatorWebhookInput): Promise<OrgAggregatorWebhook>;
  listActive(orgId: string): Promise<readonly OrgAggregatorWebhook[]>;
  listAll(orgId: string): Promise<readonly OrgAggregatorWebhook[]>;
  delete(id: string): Promise<boolean>;
}
