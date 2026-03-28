import type { GitHostPlugin, ReadFileOptions } from './types.js';

/**
 * FileReader implementation that reads files from a remote git host
 * via the plugin API. Compatible with the core package's FileReader interface.
 */
export class RemoteFileReader {
  private readonly baseOptions: Omit<ReadFileOptions, 'path'>;

  constructor(
    private readonly plugin: GitHostPlugin,
    options: { hostUrl: string; repo: string; branch: string; token: string },
  ) {
    this.baseOptions = options;
  }

  async exists(path: string): Promise<boolean> {
    const content = await this.plugin.readFile({ ...this.baseOptions, path });
    return content !== null;
  }

  async read(path: string): Promise<string | null> {
    return this.plugin.readFile({ ...this.baseOptions, path });
  }

  async list(path: string): Promise<readonly string[]> {
    return this.plugin.listFiles({ ...this.baseOptions, path });
  }
}
