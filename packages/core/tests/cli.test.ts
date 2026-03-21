import { describe, it, expect } from 'vitest';

describe('CLI', () => {
  it('exports a commander program', async () => {
    const { program } = await import('../src/cli.js');
    expect(program).toBeDefined();
    expect(program.name()).toBe('luqen');
  });

  it('has scan and fix commands', async () => {
    const { program } = await import('../src/cli.js');
    const commands = program.commands.map((c) => c.name());
    expect(commands).toContain('scan');
    expect(commands).toContain('fix');
  });

  it('scan command accepts expected options', async () => {
    const { program } = await import('../src/cli.js');
    const scan = program.commands.find((c) => c.name() === 'scan');
    expect(scan).toBeDefined();
    const optionNames = scan!.options.map((o) => o.long);
    expect(optionNames).toContain('--standard');
    expect(optionNames).toContain('--concurrency');
    expect(optionNames).toContain('--repo');
    expect(optionNames).toContain('--output');
    expect(optionNames).toContain('--format');
    expect(optionNames).toContain('--also-crawl');
    expect(optionNames).toContain('--config');
  });

  it('fix command has --repo and --from-report options', async () => {
    const { program } = await import('../src/cli.js');
    const fix = program.commands.find((c) => c.name() === 'fix');
    expect(fix).toBeDefined();
    const optionNames = fix!.options.map((o) => o.long);
    expect(optionNames).toContain('--repo');
    expect(optionNames).toContain('--from-report');
  });
});
