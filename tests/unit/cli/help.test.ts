import { describe, expect, it } from 'vitest';
import {
  COMMANDS,
  commandHelp,
  findCommand,
  renderOptions,
  rootHelp,
} from '../../../src/cli/help.js';
import { VERSION } from '../../../src/version.js';

const NAMES = [
  'connect',
  'databases',
  'schemas',
  'tables',
  'describe',
  'relations',
  'indexes',
  'sequences',
  'query',
  'export',
  'inspect',
  'config',
];

describe('findCommand', () => {
  it.each(NAMES)('finds %s', (name) => {
    const command = findCommand(name);
    expect(command).toBeDefined();
    expect(command?.name).toBe(name);
  });

  it('returns undefined for an unknown command', () => {
    expect(findCommand('nonsense')).toBeUndefined();
  });

  it('knows exactly these commands', () => {
    expect(COMMANDS.map((command) => command.name)).toEqual(NAMES);
  });
});

describe('rootHelp', () => {
  it('names every command with its summary', () => {
    const text = rootHelp();
    for (const command of COMMANDS) {
      expect(text).toContain(command.name);
      expect(text).toContain(command.summary);
    }
  });

  it('states the release number and the exit codes', () => {
    const text = rootHelp();
    expect(text).toContain(`schema ${VERSION}`);
    expect(text).toContain('Exit codes: 0 success, 1 failure, 2 usage');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('lists the global options', () => {
    const text = rootHelp();
    expect(text).toContain('-h, --help');
    expect(text).toContain('--no-color');
  });
});

describe('commandHelp', () => {
  it('renders the usage line and the options', () => {
    const command = findCommand('query');
    expect(command).toBeDefined();
    if (command === undefined) return;
    const text = commandHelp(command);
    expect(text).toContain('schema query — Run one read-only statement.');
    expect(text).toContain(
      '  schema query SQL [--param VALUE]... [connection options]',
    );
    expect(text).toContain('Options');
    expect(text).toContain('--param <VALUE>');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('includes the detail paragraph when there is one', () => {
    const command = findCommand('describe');
    expect(command).toBeDefined();
    if (command === undefined) return;
    expect(commandHelp(command)).toContain('"My Schema"."My Table"');
  });

  it('omits the detail paragraph when there is none', () => {
    const command = findCommand('databases');
    expect(command).toBeDefined();
    if (command === undefined) return;
    expect(command.detail).toBeUndefined();
    expect(commandHelp(command)).toContain('Usage\n  schema databases');
  });

  it.each(NAMES)('gives %s the global options', (name) => {
    const command = findCommand(name);
    expect(command).toBeDefined();
    if (command === undefined) return;
    for (const option of ['help', 'version', 'json', 'quiet', 'no-color']) {
      expect(Object.keys(command.options)).toContain(option);
    }
  });
});

describe('renderOptions', () => {
  it('aligns the descriptions in one column', () => {
    const text = renderOptions({
      a: { kind: 'boolean', short: 'a', describe: 'First.' },
      longer: { kind: 'string', describe: 'Second.', valueName: 'N' },
    });
    const lines = text.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^ {2}-a, --a {11}First\.$/);
    expect(lines[1]).toMatch(/^ {6}--longer <N> {2}Second\.$/);
    expect(lines[0]?.indexOf('First.')).toBe(lines[1]?.indexOf('Second.'));
  });

  it('renders an empty table as an empty string', () => {
    expect(renderOptions({})).toBe('');
  });
});
