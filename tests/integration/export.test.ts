// Exporting rows from one table.

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invoke, makeWorkspace, testUrl } from '../helpers/harness.js';

type Workspace = Awaited<ReturnType<typeof makeWorkspace>>;

describe('export', () => {
  let workspace: Workspace;

  const run = async (
    argv: readonly string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> =>
    invoke([...argv, '--url', testUrl()], { env: workspace.env });

  beforeAll(async () => {
    workspace = await makeWorkspace();
  });

  afterAll(async () => {
    await workspace.cleanup();
  });

  it('writes CSV to stdout', async () => {
    const result = await run(['export', 'customers']);
    expect(result.code).toBe(0);
    const lines = result.stdout.split('\r\n');
    expect(lines[0]).toBe('id,email,display_name,referred_by,created_at');
    expect(result.stdout).toContain('"Alan, ""the"" tester"');
  });

  it('writes JSON when asked', async () => {
    const result = await run(['export', 'customers', '--format', 'json']);
    expect(result.code).toBe(0);
    const rows = JSON.parse(result.stdout) as readonly {
      email: string;
      display_name: string | null;
    }[];
    expect(rows).toHaveLength(3);
    expect(rows[0]?.email).toBe('ada@example.test');
    expect(rows[1]?.display_name).toBeNull();
  });

  it('writes a file readable only by its owner and reports on stderr', async () => {
    const path = join(workspace.dir, 'customers.csv');
    const result = await run(['export', 'customers', '--output', path]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(path);
    expect(result.stderr).toContain('3');
    const contents = await readFile(path, 'utf8');
    expect(contents).toContain('ada@example.test');
    const info = await stat(path);
    expect(info.mode & 0o777).toBe(0o600);
  });

  it('honours --limit', async () => {
    const result = await run(['export', 'customers', '--limit', '1']);
    expect(result.code).toBe(0);
    const lines = result.stdout.trimEnd().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('ada@example.test');
  });

  it('refuses an unknown format', async () => {
    const result = await run(['export', 'customers', '--format', 'xml']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('is not an export format');
  });

  it('exports a quoted name', async () => {
    const result = await run(['export', '"Reporting"."Daily Totals"']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Day,Total Pence');
  });
});
