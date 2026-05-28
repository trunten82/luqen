/**
 * Phase 71 — Per-recipient notification unsubscribe.
 *
 * Tracks recipients who have opted out of a notification channel for a given
 * org. Suppression is enforced in services/notification-service.ts before
 * dispatching email reports. Unsubscribe tokens themselves are stateless
 * HMACs over (recipient + channel + org_id); this table only records the
 * outcome (unsubscribed_at / resubscribed_at) so dispatch can check it.
 */

export interface NotificationUnsubscribe {
  readonly recipientAddress: string;
  readonly channel: string;
  readonly orgId: string;
  readonly unsubscribedAt: string;
  readonly resubscribedAt: string | null;
}

export interface NotificationUnsubscribeRepository {
  isUnsubscribed(
    recipientAddress: string,
    channel: string,
    orgId: string,
  ): Promise<boolean>;

  unsubscribe(
    recipientAddress: string,
    channel: string,
    orgId: string,
  ): Promise<void>;

  resubscribe(
    recipientAddress: string,
    channel: string,
    orgId: string,
  ): Promise<boolean>;

  listForOrg(
    orgId: string,
    channel?: string,
  ): Promise<readonly NotificationUnsubscribe[]>;
}
