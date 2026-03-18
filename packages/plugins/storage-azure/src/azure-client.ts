import { parseConnectionString, signRequest, type AzureCredentials } from './azure-signer.js';

// ---------------------------------------------------------------------------
// Azure Blob Storage Client — zero-dependency, uses native fetch
// ---------------------------------------------------------------------------

export class AzureBlobClient {
  private readonly credentials: AzureCredentials;
  private readonly endpoint: string;

  constructor(
    connectionString: string,
    private readonly containerName: string,
    private readonly prefix: string = 'luqen/',
  ) {
    this.credentials = parseConnectionString(connectionString);
    this.endpoint = `https://${this.credentials.accountName}.blob.core.windows.net`;
  }

  /** PUT blob. */
  async save(key: string, data: Uint8Array): Promise<void> {
    const blobPath = `${this.prefix}${key}`;
    const url = `${this.endpoint}/${this.containerName}/${blobPath}`;

    const headers = signRequest(
      'PUT',
      url,
      { 'Content-Type': 'application/octet-stream' },
      this.credentials,
      data.byteLength,
    );

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: data as unknown as BodyInit,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Azure PUT failed: HTTP ${response.status} - ${errBody}`);
    }
  }

  /** GET blob and return its bytes. */
  async load(key: string): Promise<Uint8Array> {
    const blobPath = `${this.prefix}${key}`;
    const url = `${this.endpoint}/${this.containerName}/${blobPath}`;

    const headers = signRequest(
      'GET',
      url,
      {},
      this.credentials,
      0,
    );

    const response = await fetch(url, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Azure GET failed: HTTP ${response.status} - ${body}`);
    }

    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /** DELETE blob. */
  async delete(key: string): Promise<void> {
    const blobPath = `${this.prefix}${key}`;
    const url = `${this.endpoint}/${this.containerName}/${blobPath}`;

    const headers = signRequest(
      'DELETE',
      url,
      {},
      this.credentials,
      0,
    );

    const response = await fetch(url, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Azure DELETE failed: HTTP ${response.status} - ${body}`);
    }
  }

  /** List blobs with maxResults=1 to verify access. */
  async testConnection(): Promise<boolean> {
    const url = `${this.endpoint}/${this.containerName}?restype=container&comp=list&maxresults=1`;

    try {
      const headers = signRequest(
        'GET',
        url,
        {},
        this.credentials,
        0,
      );

      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}
