// The stored settings.
//
// `config` never connects, so none of these invocations is given a --url;
// the command does not accept one.

import { readFile, writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invoke, makeWorkspace, testUrl } from '../helpers/harness.js';

type Workspace = Awaited<ReturnType<typeof makeWorkspace>>;

describe('config', () => {
  let workspace: Workspace;

  const run = async (
    argv: readonly string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> =>
    invoke(argv, { env: workspace.env });

  beforeAll(async () => {
    workspace = await makeWorkspace();
  });

  afterAll(async () => {
    await workspace.cleanup();
  });

  it('shows the defaults when there is no file yet', async () => {
    const result = await run(['config', 'show']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('No configuration file yet');
    expect(result.stdout).toMatch(/maxRows\s+200\s+\(default\)/);
  });

  it('prints the path it would use', async () => {
    const result = await run(['config', 'path']);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(workspace.env['SCHEMA_CONFIG']);
  });

  it('stores a setting and reports it from the file', async () => {
    const set = await run(['config', 'set', 'maxRows', '50']);
    expect(set.code).toBe(0);
    expect(set.stdout).toContain('maxRows = 50');

    const stored = JSON.parse(
      await readFile(workspace.env['SCHEMA_CONFIG'] ?? '', 'utf8'),
    ) as Record<string, unknown>;
    expect(stored['maxRows']).toBe(50);

    const show = await run(['config', 'show']);
    expect(show.code).toBe(0);
    expect(show.stdout).toContain('Settings from');
    expect(show.stdout).toMatch(/maxRows\s+50\s+\(file\)/);
  });

  it('changes the default row limit of a query', async () => {
    const set = await run(['config', 'set', 'maxRows', '1']);
    expect(set.code).toBe(0);
    const result = await invoke(
      ['query', 'SELECT * FROM customers', '--url', testUrl(), '--json'],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as {
      status: string;
      result: { rowCount: number; truncatedBy: string | null };
    };
    expect(report.result.rowCount).toBe(1);
    expect(report.result.truncatedBy).toBe('rows');
    expect(report.status).toBe('truncated');
  });

  it('unsets a setting again', async () => {
    const unset = await run(['config', 'unset', 'maxRows']);
    expect(unset.code).toBe(0);
    expect(unset.stdout).toContain('maxRows');
    const show = await run(['config', 'show']);
    expect(show.stdout).toMatch(/maxRows\s+200\s+\(default\)/);
  });

  it('refuses a value of the wrong kind', async () => {
    const result = await run(['config', 'set', 'maxRows', 'plenty']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('maxRows');
  });

  it('refuses an unknown key', async () => {
    const result = await run(['config', 'set', 'colour', 'blue']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('is not a known setting');
  });

  it('refuses an unknown subcommand', async () => {
    const result = await run(['config', 'enable']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('is not a config subcommand');
  });

  it('writes the settings as JSON', async () => {
    const result = await run(['config', 'show', '--json']);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as {
      command: string;
      result: {
        path: string;
        exists: boolean;
        settings: Record<string, unknown>;
      };
    };
    expect(report.command).toBe('config');
    expect(report.result.path).toBe(workspace.env['SCHEMA_CONFIG']);
    expect(report.result.settings['maxRows']).toBe(200);
  });

  it('refuses a damaged configuration file', async () => {
    await writeFile(workspace.env['SCHEMA_CONFIG'] ?? '', '{not json', 'utf8');
    const result = await run(['config', 'show']);
    expect(result.code).toBe(2);
    expect(result.stderr).not.toBe('');
  });
});
