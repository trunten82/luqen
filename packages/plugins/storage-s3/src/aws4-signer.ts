import { createHmac, createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// AWS Signature V4 — minimal implementation for S3
// ---------------------------------------------------------------------------

export interface AwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function toAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return {
    amzDate: iso,                  // 20260320T120000Z
    dateStamp: iso.slice(0, 8),    // 20260320
  };
}

/**
 * Sign an HTTP request using AWS Signature Version 4.
 * Returns a new headers record that includes Authorization, x-amz-date,
 * and x-amz-content-sha256.
 */
export function signRequest(
  method: string,
  url: string,
  headers: Readonly<Record<string, string>>,
  body: Uint8Array | string,
  credentials: AwsCredentials,
  region: string,
  service: string = 's3',
  now: Date = new Date(),
): Record<string, string> {
  const { amzDate, dateStamp } = toAmzDate(now);
  const parsed = new URL(url);

  const payloadHash = sha256Hex(typeof body === 'string' ? body : body);

  // Build headers map (mutable copy)
  const signedHeaders: Record<string, string> = { ...headers };
  signedHeaders['host'] = parsed.host;
  signedHeaders['x-amz-date'] = amzDate;
  signedHeaders['x-amz-content-sha256'] = payloadHash;

  // Sorted header keys
  const sortedKeys = Object.keys(signedHeaders).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k.toLowerCase()}:${signedHeaders[k]!.trim()}`).join('\n') + '\n';
  const signedHeadersList = sortedKeys.map((k) => k.toLowerCase()).join(';');

  // Canonical query string
  const sortedParams = [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  const canonicalQueryString = sortedParams
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  // Canonical request
  const canonicalRequest = [
    method,
    parsed.pathname,
    canonicalQueryString,
    canonicalHeaders,
    signedHeadersList,
    payloadHash,
  ].join('\n');

  // String to sign
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  // Signing key
  const kDate = hmac(`AWS4${credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');

  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeadersList}, Signature=${signature}`;

  return {
    ...signedHeaders,
    'Authorization': authorization,
  };
}
