/**
 * testServiceConnection — validate candidate service connection values without
 * saving them. Used by `POST /admin/service-connections/:id/test` (plan 06-03).
 *
 * Performs a full OAuth2 client_credentials handshake followed by a GET
 * {url}/health with the acquired Bearer token. Each network call is bounded
 * by a 10-second timeout (CONTEXT D-21). The candidate clientSecret is never
 * logged, rethrown, or interpolated into the returned error string.
 *
 * This helper performs NO persistence — it is a read-only probe used by the
 * admin UI to let the operator validate before committing a save.
 */

export type ServiceTestResult =
  | { ok: true; latencyMs: number }
  | { ok: false; step: 'oauth' | 'health'; error: string };

const REQUEST_TIMEOUT_MS = 10_000;

export interface ServiceTestInput {
  readonly url: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * Run the OAuth + /health probe against the candidate connection values.
 *
 * Never throws — all failures are returned as `{ ok: false, step, error }`.
 * The error message is scrubbed of the candidate clientSecret to prevent
 * accidental leakage in transport-level error output.
 */
export async function testServiceConnection(
  input: ServiceTestInput,
): Promise<ServiceTestResult> {
  const { url, clientId, clientSecret } = input;
  const baseUrl = url.replace(/\/$/, '');
  const startedAt = Date.now();

  // ── Step 1: OAuth2 client_credentials token fetch ─────────────────────────
  let accessToken: string;
  try {
    const body =
      'grant_type=client_credentials' +
      `&client_id=${encodeURIComponent(clientId)}` +
      `&client_secret=${encodeURIComponent(clientSecret)}`;

    const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text().catch(() => '');
      return {
        ok: false,
        step: 'oauth',
        error: scrub(
          `token endpoint returned ${tokenResponse.status}: ${text.slice(0, 200)}`,
          clientSecret,
        ),
      };
    }

    const parsed = (await tokenResponse.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (parsed === null || typeof parsed['access_token'] !== 'string' || parsed['access_token'] === '') {
      return {
        ok: false,
        step: 'oauth',
        error: 'no access_token in response',
      };
    }
    accessToken = parsed['access_token'];
  } catch (err) {
    return {
      ok: false,
      step: 'oauth',
      error: scrub(errorMessage(err), clientSecret),
    };
  }

  // ── Step 2: GET /health with Bearer token ─────────────────────────────────
  try {
    const healthResponse = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!healthResponse.ok) {
      return {
        ok: false,
        step: 'health',
        error: scrub(
          `health endpoint returned ${healthResponse.status}`,
          clientSecret,
        ),
      };
    }
  } catch (err) {
    return {
      ok: false,
      step: 'health',
      error: scrub(errorMessage(err), clientSecret),
    };
  }

  return { ok: true, latencyMs: Date.now() - startedAt };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return 'request timed out after 10000ms';
    }
    return err.message;
  }
  return String(err);
}

/**
 * Remove any occurrence of the candidate clientSecret from an error message
 * before returning it to the caller. Belt-and-braces: the helper never
 * intentionally interpolates the secret, but transports (and upstream error
 * strings) occasionally echo request bodies.
 */
function scrub(message: string, secret: string): string {
  if (secret === '') return message;
  // Escape regex metacharacters in the secret before constructing a replacer.
  const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return message.replace(new RegExp(escaped, 'g'), '[REDACTED]');
}
