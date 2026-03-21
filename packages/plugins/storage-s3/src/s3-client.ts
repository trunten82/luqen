import { signRequest, type AwsCredentials } from './aws4-signer.js';

// ---------------------------------------------------------------------------
// S3 Client — zero-dependency, uses native fetch + AWS4 signing
// ---------------------------------------------------------------------------

export class S3Client {
  private readonly endpoint: string;

  constructor(
    private readonly bucket: string,
    private readonly region: string,
    private readonly credentials: AwsCredentials,
    private readonly prefix: string = 'luqen/',
  ) {
    this.endpoint = `https://${bucket}.s3.${region}.amazonaws.com`;
  }

  /** PUT object and return the S3 URI. */
  async save(key: string, data: Uint8Array): Promise<string> {
    const objectKey = `${this.prefix}${key}`;
    const url = `${this.endpoint}/${objectKey}`;

    const headers = signRequest(
      'PUT',
      url,
      { 'Content-Type': 'application/octet-stream' },
      data,
      this.credentials,
      this.region,
    );

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: data as unknown as BodyInit,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`S3 PUT failed: HTTP ${response.status} - ${errBody}`);
    }

    return `s3://${this.bucket}/${objectKey}`;
  }

  /** GET object and return its bytes. */
  async load(key: string): Promise<Uint8Array> {
    const objectKey = `${this.prefix}${key}`;
    const url = `${this.endpoint}/${objectKey}`;

    const headers = signRequest(
      'GET',
      url,
      {},
      '',
      this.credentials,
      this.region,
    );

    const response = await fetch(url, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`S3 GET failed: HTTP ${response.status} - ${body}`);
    }

    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /** DELETE object. */
  async delete(key: string): Promise<void> {
    const objectKey = `${this.prefix}${key}`;
    const url = `${this.endpoint}/${objectKey}`;

    const headers = signRequest(
      'DELETE',
      url,
      {},
      '',
      this.credentials,
      this.region,
    );

    const response = await fetch(url, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`S3 DELETE failed: HTTP ${response.status} - ${body}`);
    }
  }

  /** HEAD bucket to verify access. */
  async testConnection(): Promise<boolean> {
    const url = `${this.endpoint}/`;

    try {
      const headers = signRequest(
        'HEAD',
        url,
        {},
        '',
        this.credentials,
        this.region,
      );

      const response = await fetch(url, {
        method: 'HEAD',
        headers,
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}
