import { createHmac } from 'node:crypto';

// ---------------------------------------------------------------------------
// Azure Blob Storage SharedKey Authorization
// ---------------------------------------------------------------------------

export interface AzureCredentials {
  readonly accountName: string;
  readonly accountKey: string;
}

/**
 * Parse an Azure Storage connection string into account name and key.
 *
 * Expected format:
 *   DefaultEndpointsProtocol=https;AccountName=xxx;AccountKey=yyy;EndpointSuffix=core.windows.net
 */
export function parseConnectionString(connectionString: string): AzureCredentials {
  const parts = new Map<string, string>();
  for (const segment of connectionString.split(';')) {
    const eqIdx = segment.indexOf('=');
    if (eqIdx === -1) continue;
    parts.set(segment.slice(0, eqIdx).trim(), segment.slice(eqIdx + 1).trim());
  }

  const accountName = parts.get('AccountName');
  const accountKey = parts.get('AccountKey');

  if (accountName == null || accountName === '') {
    throw new Error('Connection string missing AccountName');
  }
  if (accountKey == null || accountKey === '') {
    throw new Error('Connection string missing AccountKey');
  }

  return { accountName, accountKey };
}

/**
 * Build the SharedKey Authorization header for Azure Blob Storage REST API.
 * https://learn.microsoft.com/en-us/rest/api/storageservices/authorize-with-shared-key
 */
export function signRequest(
  method: string,
  url: string,
  headers: Readonly<Record<string, string>>,
  credentials: AzureCredentials,
  contentLength: number,
): Record<string, string> {
  const parsed = new URL(url);
  const now = new Date().toUTCString();

  const msVersion = '2023-11-03';

  const signedHeaders: Record<string, string> = { ...headers };
  signedHeaders['x-ms-date'] = now;
  signedHeaders['x-ms-version'] = msVersion;
  signedHeaders['x-ms-blob-type'] = method === 'PUT' ? 'BlockBlob' : '';

  // Collect x-ms- headers for canonicalization
  const msHeaders = Object.entries(signedHeaders)
    .filter(([k]) => k.startsWith('x-ms-'))
    .filter(([, v]) => v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k.toLowerCase()}:${v.trim()}`)
    .join('\n');

  // Canonicalized resource
  const canonicalizedResource = `/${credentials.accountName}${parsed.pathname}`;
  const queryParams = [...parsed.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `\n${k.toLowerCase()}:${v}`)
    .join('');

  const contentType = signedHeaders['Content-Type'] ?? '';

  // String to sign for SharedKey
  const stringToSign = [
    method,                                     // HTTP verb
    '',                                         // Content-Encoding
    '',                                         // Content-Language
    contentLength > 0 ? String(contentLength) : '', // Content-Length
    '',                                         // Content-MD5
    contentType,                                // Content-Type
    '',                                         // Date
    '',                                         // If-Modified-Since
    '',                                         // If-Match
    '',                                         // If-None-Match
    '',                                         // If-Unmodified-Since
    '',                                         // Range
    msHeaders,                                  // CanonicalizedHeaders
    `${canonicalizedResource}${queryParams}`,   // CanonicalizedResource
  ].join('\n');

  const key = Buffer.from(credentials.accountKey, 'base64');
  const signature = createHmac('sha256', key).update(stringToSign, 'utf8').digest('base64');

  signedHeaders['Authorization'] = `SharedKey ${credentials.accountName}:${signature}`;

  // Remove empty blob type header for non-PUT requests
  if (signedHeaders['x-ms-blob-type'] === '') {
    delete signedHeaders['x-ms-blob-type'];
  }

  return signedHeaders;
}
