import { describe, it, expect } from 'vitest';
import { createProgram } from '../src/cli.js';

describe('CLI', () => {
  it('exports createProgram as a function', () => {
    expect(typeof createProgram).toBe('function');
  });

  it('creates a commander program', () => {
    const program = createProgram();
    expect(program).toBeDefined();
    expect(typeof program.parse).toBe('function');
  });

  it('has serve command', () => {
    const program = createProgram();
    const commands = program.commands.map(c => c.name());
    expect(commands).toContain('serve');
  });

  it('has seed command', () => {
    const program = createProgram();
    const commands = program.commands.map(c => c.name());
    expect(commands).toContain('seed');
  });

  it('has clients command', () => {
    const program = createProgram();
    const commands = program.commands.map(c => c.name());
    expect(commands).toContain('clients');
  });

  it('has users command', () => {
    const program = createProgram();
    const commands = program.commands.map(c => c.name());
    expect(commands).toContain('users');
  });

  it('has keys command', () => {
    const program = createProgram();
    const commands = program.commands.map(c => c.name());
    expect(commands).toContain('keys');
  });

  it('has mcp command', () => {
    const program = createProgram();
    const commands = program.commands.map(c => c.name());
    expect(commands).toContain('mcp');
  });

  it('clients command has create subcommand', () => {
    const program = createProgram();
    const clientsCmd = program.commands.find(c => c.name() === 'clients');
    expect(clientsCmd).toBeDefined();
    const subcommands = clientsCmd!.commands.map(c => c.name());
    expect(subcommands).toContain('create');
  });

  it('clients command has list subcommand', () => {
    const program = createProgram();
    const clientsCmd = program.commands.find(c => c.name() === 'clients');
    const subcommands = clientsCmd!.commands.map(c => c.name());
    expect(subcommands).toContain('list');
  });

  it('clients command has revoke subcommand', () => {
    const program = createProgram();
    const clientsCmd = program.commands.find(c => c.name() === 'clients');
    const subcommands = clientsCmd!.commands.map(c => c.name());
    expect(subcommands).toContain('revoke');
  });

  it('users command has create subcommand', () => {
    const program = createProgram();
    const usersCmd = program.commands.find(c => c.name() === 'users');
    expect(usersCmd).toBeDefined();
    const subcommands = usersCmd!.commands.map(c => c.name());
    expect(subcommands).toContain('create');
  });

  it('keys command has generate subcommand', () => {
    const program = createProgram();
    const keysCmd = program.commands.find(c => c.name() === 'keys');
    expect(keysCmd).toBeDefined();
    const subcommands = keysCmd!.commands.map(c => c.name());
    expect(subcommands).toContain('generate');
  });

  it('serve command has --port option', () => {
    const program = createProgram();
    const serveCmd = program.commands.find(c => c.name() === 'serve');
    expect(serveCmd).toBeDefined();
    const optNames = serveCmd!.options.map(o => o.long);
    expect(optNames).toContain('--port');
  });
});
