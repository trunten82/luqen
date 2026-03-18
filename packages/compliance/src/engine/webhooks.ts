import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DbAdapter } from '../db/adapter.js';
import type { WebhookPayload } from '../types.js';

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 250;

export function createWebhookSignature(body: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(body);
  return `sha256=${hmac.digest('hex')}`;
}

export function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature.startsWith('sha256=')) {
    return false;
  }
  const expected = createWebhookSignature(body, secret);
  try {
    const expectedBuf = Buffer.from(expected, 'utf8');
    const actualBuf = Buffer.from(signature, 'utf8');
    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

async function sendWithRetry(
  url: string,
  body: string,
  signature: string,
  attempt: number = 1,
): Promise<void> {
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Luqen-Signature': signature,
      },
      body,
    });
  } catch (err) {
    if (attempt < MAX_ATTEMPTS) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
      await sendWithRetry(url, body, signature, attempt + 1);
    }
    // After exhausting retries, swallow the error (fire-and-forget)
  }
}

/**
 * Dispatches an event to all active webhooks subscribed to that event.
 * Fire-and-forget: returns immediately and retries in the background.
 */
export function dispatchWebhook(
  db: DbAdapter,
  event: string,
  data: Record<string, unknown>,
): void {
  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };
  const body = JSON.stringify(payload);

  // Kick off async work without blocking the caller
  void (async () => {
    const webhooks = await db.listWebhooks();
    const targets = webhooks.filter(
      (wh) => wh.active && wh.events.includes(event),
    );

    await Promise.all(
      targets.map((wh) => {
        const signature = createWebhookSignature(body, wh.secret);
        return sendWithRetry(wh.url, body, signature);
      }),
    );
  })();
}
