// Help, versions, usage errors and global options.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANSI, invoke, makeWorkspace, testUrl } from '../helpers/harness.js';

type Workspace = Awaited<ReturnType<typeof makeWorkspace>>;

/** The workspace environment without the NO_COLOR the harness sets. */
function colourable(workspace: Workspace): Record<string, string> {
  return Object.fromEntries(
    Object.entries(workspace.env).filter(([name]) => name !== 'NO_COLOR'),
  );
}

const COMMANDS = [
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
] as const;

describe('global behaviour', () => {
  let workspace: Workspace;

  beforeAll(async () => {
    workspace = await makeWorkspace();
  });

  afterAll(async () => {
    await workspace.cleanup();
  });

  it('prints the root help when given no arguments', async () => {
    const result = await invoke([], { env: workspace.env });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage');
    expect(result.stdout).toContain('Commands');
    for (const command of COMMANDS) {
      expect(result.stdout).toContain(command);
    }
    expect(result.stderr).toBe('');
  });

  it('prints the root help for --help', async () => {
    const result = await invoke(['--help'], { env: workspace.env });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage');
  });

  it('prints the release number for --version', async () => {
    const result = await invoke(['--version'], { env: workspace.env });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('refuses an unknown command', async () => {
    const result = await invoke(['explain-everything'], {
      env: workspace.env,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('is not a command');
  });

  it('refuses an unknown option', async () => {
    const result = await invoke(['tables', '--verbose'], {
      env: workspace.env,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unknown option');
  });

  it('refuses an empty numeric option value', async () => {
    const result = await invoke(['tables', '--limit=', '--url', testUrl()], {
      env: workspace.env,
    });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--limit');
  });

  it('requires a table name for describe', async () => {
    const result = await invoke(['describe'], { env: workspace.env });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('required');
  });

  it.each(COMMANDS)('accepts --help for %s', async (command) => {
    const result = await invoke([command, '--help'], { env: workspace.env });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`schema ${command}`);
    expect(result.stderr).toBe('');
  });

  it('writes no escape sequence when NO_COLOR is set', async () => {
    const result = await invoke(['connect', '--url', testUrl()], {
      env: workspace.env,
      stdoutIsTty: true,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).not.toMatch(ANSI);
  });

  it('writes no escape sequence for --no-color on a terminal', async () => {
    const result = await invoke(['connect', '--url', testUrl(), '--no-color'], {
      env: colourable(workspace),
      stdoutIsTty: true,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).not.toMatch(ANSI);
  });

  it('colours the output on a terminal without NO_COLOR', async () => {
    const result = await invoke(['connect', '--url', testUrl()], {
      env: colourable(workspace),
      stdoutIsTty: true,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(ANSI);
  });

  // --quiet suppresses the confirmation lines of the commands that have
  // one: config set, config unset and export to a file.
  it('silences the confirmation of config set and unset', async () => {
    const loud = await invoke(['config', 'set', 'maxRows', '10'], {
      env: workspace.env,
    });
    expect(loud.code).toBe(0);
    expect(loud.stdout).toContain('maxRows = 10');

    const quiet = await invoke(['config', 'set', 'maxRows', '20', '--quiet'], {
      env: workspace.env,
    });
    expect(quiet.code).toBe(0);
    expect(quiet.stdout).toBe('');

    const unset = await invoke(['config', 'unset', 'maxRows', '--quiet'], {
      env: workspace.env,
    });
    expect(unset.code).toBe(0);
    expect(unset.stdout).toBe('');
  });

  it('silences the confirmation of an export to a file', async () => {
    const path = join(workspace.dir, 'quiet.csv');
    const result = await invoke(
      ['export', 'customers', '--output', path, '--url', testUrl(), '--quiet'],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(await readFile(path, 'utf8')).toContain('ada@example.test');
  });
});
