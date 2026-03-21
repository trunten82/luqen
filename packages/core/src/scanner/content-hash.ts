import { createHash } from 'node:crypto';

/**
 * Fetches a page and computes a SHA-256 hash of its normalized content.
 * Dynamic content (nonces, CSRF tokens, timestamps) is stripped for stable hashing.
 */
export async function computeContentHash(
  url: string,
  headers?: Readonly<Record<string, string>>,
): Promise<string> {
  const response = await fetch(url, {
    headers: headers as Record<string, string>,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();

  // Strip dynamic content for stable hashing
  const normalized = text
    .replace(/nonce="[^"]*"/g, '')
    .replace(/csrf[_-]token.*?["'][^"']*["']/gi, '')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^"'\s]*/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Compute content hashes for multiple URLs in parallel with concurrency control.
 */
export async function computeContentHashes(
  urls: readonly string[],
  concurrency: number = 5,
  headers?: Readonly<Record<string, string>>,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const queue = [...urls];
  let queueIndex = 0;

  async function worker(): Promise<void> {
    while (queueIndex < queue.length) {
      const current = queueIndex;
      queueIndex++;
      const url = queue[current];

      try {
        const hash = await computeContentHash(url, headers);
        results.set(url, hash);
      } catch {
        // If we can't hash a page, treat it as changed (no hash = will be scanned)
      }
    }
  }

  const workerCount = Math.min(concurrency, queue.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  return results;
}
