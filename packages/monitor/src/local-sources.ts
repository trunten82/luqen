// Load monitored sources from a local JSON config file (standalone mode).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import type { MonitoredSource } from './compliance-client.js';

/** Shape of the local config file. */
interface LocalSourceEntry {
  readonly name: string;
  readonly url: string;
  readonly type: 'html' | 'rss' | 'api';
  readonly schedule?: 'daily' | 'weekly' | 'monthly';
}

interface LocalConfig {
  readonly sources: readonly LocalSourceEntry[];
}

const CONFIG_FILENAME = '.pally-monitor.json';
const VALID_TYPES = new Set(['html', 'rss', 'api']);

/**
 * Load monitored sources from a local JSON config file.
 *
 * Lookup order:
 * 1. Explicit path (from --sources-file CLI flag)
 * 2. `.pally-monitor.json` in the current working directory
 * 3. `$HOME/.pally-monitor.json`
 *
 * Returns an empty array when no config file is found at any location.
 * Throws on malformed JSON or missing required fields.
 */
export async function loadLocalSources(
  configPath?: string,
  cwd: string = process.cwd(),
  home: string = homedir(),
): Promise<readonly MonitoredSource[]> {
  // If an explicit path was given, try only that path
  if (configPath !== undefined) {
    return readAndParse(configPath, true);
  }

  // Fallback: try cwd, then home
  const cwdPath = join(cwd, CONFIG_FILENAME);
  const cwdResult = await readAndParse(cwdPath, false);
  if (cwdResult.length > 0) {
    return cwdResult;
  }

  const homePath = join(home, CONFIG_FILENAME);
  return readAndParse(homePath, false);
}

async function readAndParse(
  filePath: string,
  throwOnMissing: boolean,
): Promise<readonly MonitoredSource[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      if (throwOnMissing) {
        return [];
      }
      return [];
    }
    throw err;
  }

  const parsed: unknown = JSON.parse(raw);
  return validateAndConvert(parsed);
}

function validateAndConvert(data: unknown): readonly MonitoredSource[] {
  if (typeof data !== 'object' || data === null || !('sources' in data)) {
    throw new Error('Invalid config: missing "sources" array');
  }

  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.sources)) {
    throw new Error('Invalid config: "sources" must be an array');
  }

  return (obj.sources as unknown[]).map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`Invalid source at index ${index}: must be an object`);
    }

    const src = entry as Record<string, unknown>;

    if (typeof src.name !== 'string' || src.name.trim() === '') {
      throw new Error(`Invalid source at index ${index}: missing or empty "name"`);
    }
    if (typeof src.url !== 'string' || src.url.trim() === '') {
      throw new Error(`Invalid source at index ${index}: missing or empty "url"`);
    }
    if (typeof src.type !== 'string' || !VALID_TYPES.has(src.type)) {
      throw new Error(
        `Invalid source at index ${index}: "type" must be one of html, rss, api`,
      );
    }

    // Generate a stable id from the URL so repeated loads produce the same id
    const id = createHash('sha256').update(src.url as string).digest('hex').slice(0, 12);

    return {
      id: `local-${id}`,
      name: src.name as string,
      url: src.url as string,
      type: src.type as 'html' | 'rss' | 'api',
      schedule: (typeof src.schedule === 'string' ? src.schedule : 'daily') as
        | 'daily'
        | 'weekly'
        | 'monthly',
      createdAt: new Date().toISOString(),
    };
  });
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
