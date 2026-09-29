/**
 * Real-process proof of the graceful shutdown (the 90 s `systemctl stop` hang).
 * Spawns tests/fixtures/shutdown-child.ts under tsx, sends SIGTERM and times
 * the exit. SP0 is the control: the same child WITHOUT the lifecycle must
 * still be alive after SIGTERM, or the fixture is not reproducing the bug and
 * SP1/SP2 would prove nothing.
 */
import { describe, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(DASHBOARD_ROOT, '..', '..');
const FIXTURE = resolve(HERE, 'fixtures', 'shutdown-child.ts');

function tsxBin(): string {
  const candidates = [
    resolve(DASHBOARD_ROOT, 'node_modules', '.bin', 'tsx'),
    resolve(REPO_ROOT, 'node_modules', '.bin', 'tsx'),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`tsx binary not found in any of: ${candidates.join(', ')}`);
  return found;
}

interface Run {
  readonly child: ChildProcess;
  readonly out: () => string;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null; ms: number }>;
  readonly sigterm: () => void;
}

async function start(env: Record<string, string>): Promise<Run> {
  const child = spawn(tsxBin(), [FIXTURE], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
  child.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
  let sentAt = 0;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null; ms: number }>((done) => {
    child.once('exit', (code, signal) => done({ code, signal, ms: Date.now() - sentAt }));
  });
  const ready = Date.now() + 60_000;
  while (!out.includes('READY')) {
    if (Date.now() > ready || child.exitCode !== null) throw new Error(`child never became ready:\n${out}`);
    await new Promise((r) => setTimeout(r, 25));
  }
  return { child, out: () => out, exited, sigterm: () => { sentAt = Date.now(); child.kill('SIGTERM'); } };
}

async function within<T>(p: Promise<T>, ms: number): Promise<T | 'TIMEOUT'> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<'TIMEOUT'>((done) => { timer = setTimeout(() => done('TIMEOUT'), ms); });
  try {
    return await Promise.race([p, t]);
  } finally {
    clearTimeout(timer);
  }
}

describe('dashboard-shaped process on SIGTERM', () => {
  it('SP0 [control]: without the lifecycle, a SIGTERM-swallowing listener keeps the process alive', async () => {
    const run = await start({ NO_LIFECYCLE: '1' });
    run.sigterm();
    const result = await within(run.exited, 2_000);
    run.child.kill('SIGKILL');
    expect(result).toBe('TIMEOUT');
    expect(run.out()).toContain('PUPPETEER-LIKE-LISTENER');
  }, 90_000);

  it('SP1: with the lifecycle, SIGTERM closes http, plugins and browsers and exits 0 within seconds', async () => {
    const run = await start({});
    run.sigterm();
    const result = await within(run.exited, 10_000);
    if (result === 'TIMEOUT') run.child.kill('SIGKILL');
    expect(result).not.toBe('TIMEOUT');
    if (result === 'TIMEOUT') return;
    expect(result.code).toBe(0);
    expect(result.ms).toBeLessThan(5_000);
    const out = run.out();
    expect(out.indexOf('HTTP-CLOSED')).toBeGreaterThan(-1);
    expect(out.indexOf('PLUGINS-CLOSED')).toBeGreaterThan(out.indexOf('HTTP-CLOSED'));
    expect(out.indexOf('BROWSERS-CLOSED')).toBeGreaterThan(out.indexOf('PLUGINS-CLOSED'));
  }, 90_000);

  it('SP2 [deadline]: a plugin close that never returns still ends in exit(1) at the deadline', async () => {
    const run = await start({ HANG_PLUGINS: '1', DEADLINE_MS: '800' });
    run.sigterm();
    const result = await within(run.exited, 10_000);
    if (result === 'TIMEOUT') run.child.kill('SIGKILL');
    expect(result).not.toBe('TIMEOUT');
    if (result === 'TIMEOUT') return;
    expect(result.code).toBe(1);
    expect(result.ms).toBeGreaterThanOrEqual(700);
    expect(result.ms).toBeLessThan(5_000);
    expect(run.out()).toMatch(/ERROR .*deadline/i);
  }, 90_000);
});
