import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AxeScanner, type ScannerIssue, type PageResult } from './axe-scanner.js';
import type { WcagRule } from './rule-mapper.js';

// ---------------------------------------------------------------------------
// Local interface definitions (compatible with dashboard's ScannerPlugin)
// ---------------------------------------------------------------------------

interface ConfigField {
  readonly key: string;
  readonly label: string;
  readonly type: 'string' | 'secret' | 'number' | 'boolean' | 'select';
  readonly required?: boolean;
  readonly default?: unknown;
  readonly options?: readonly string[];
  readonly description?: string;
}

interface PluginManifest {
  readonly name: string;
  readonly displayName: string;
  readonly type: 'auth' | 'notification' | 'storage' | 'scanner';
  readonly version: string;
  readonly description: string;
  readonly icon?: string;
  readonly configSchema: readonly ConfigField[];
  readonly autoDeactivateOnFailure?: boolean;
}

interface ScannerPlugin {
  readonly manifest: PluginManifest;
  readonly rules: readonly WcagRule[];
  activate(config: Readonly<Record<string, unknown>>): Promise<void>;
  deactivate(): Promise<void>;
  healthCheck(): Promise<boolean>;
  evaluate(page: PageResult): Promise<readonly ScannerIssue[]>;
}

// ---------------------------------------------------------------------------
// Read manifest from disk
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(__dirname, '..', 'manifest.json');

function loadManifest(): PluginManifest {
  const raw = readFileSync(manifestPath, 'utf-8');
  return JSON.parse(raw) as PluginManifest;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export default function createPlugin(): ScannerPlugin {
  const manifest = loadManifest();
  let scanner: AxeScanner | null = null;

  return {
    manifest,

    get rules(): readonly WcagRule[] {
      return scanner?.rules ?? [];
    },

    async activate(config: Readonly<Record<string, unknown>>): Promise<void> {
      const browserPath = config['browserPath'] as string | undefined;
      const headless = (config['headless'] as boolean | undefined) ?? true;
      const timeout = (config['timeout'] as number | undefined) ?? 30000;
      const standard =
        (config['standard'] as 'wcag2a' | 'wcag2aa' | 'wcag2aaa' | undefined) ?? 'wcag2aa';

      if (typeof headless !== 'boolean') {
        throw new Error('Config "headless" must be a boolean');
      }
      if (typeof timeout !== 'number' || timeout <= 0) {
        throw new Error('Config "timeout" must be a positive number');
      }

      scanner = new AxeScanner({ browserPath, headless, timeout, standard });
      await scanner.initialize();
    },

    async deactivate(): Promise<void> {
      if (scanner) {
        await scanner.close();
        scanner = null;
      }
    },

    async healthCheck(): Promise<boolean> {
      return scanner !== null;
    },

    async evaluate(page: PageResult): Promise<readonly ScannerIssue[]> {
      if (!scanner) {
        throw new Error('Plugin has not been activated — call activate() first');
      }
      return scanner.evaluate(page);
    },
  };
}
