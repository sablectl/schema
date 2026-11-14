// Server, database and permission diagnostics.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invoke, makeWorkspace, testUrl } from '../helpers/harness.js';

type Workspace = Awaited<ReturnType<typeof makeWorkspace>>;

interface InspectReport {
  readonly result: {
    readonly serverVersion: string;
    readonly databaseSizeBytes: number | null;
    readonly extensions: readonly { readonly name: string }[];
    readonly settings: readonly { readonly name: string }[];
    readonly largestRelations: readonly { readonly name: string }[];
  };
}

describe('inspect', () => {
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

  it('reports the server, the database and what it contains', async () => {
    const result = await run(['inspect']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Version\s+\d+/);
    expect(result.stdout).toContain('schema_fixture');
    expect(result.stdout).toMatch(/Role\s+\w+/);
    expect(result.stdout).toContain('read only');
    expect(result.stdout).toMatch(/Database size\s+\S+/);
    expect(result.stdout).toContain('Largest relations');
    expect(result.stdout).toContain('customers');
    expect(result.stdout).toContain('plpgsql');
    expect(result.stdout).toContain('Settings');
    expect(result.stdout).toContain('statement_timeout');
  });

  it('limits the list of largest relations', async () => {
    const result = await run(['inspect', '--largest', '2']);
    expect(result.code).toBe(0);
    const section = result.stdout.slice(
      result.stdout.indexOf('Largest relations'),
      result.stdout.indexOf('Extensions'),
    );
    // A heading, a rule and two relations.
    const rows = section
      .split('\n')
      .filter((line) => /\d+(\.\d+)? (B|KiB|MiB)/.test(line));
    expect(rows).toHaveLength(2);
  });

  it('writes the diagnostics as JSON', async () => {
    const result = await run(['inspect', '--json']);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as InspectReport;
    expect(report.result.serverVersion).toMatch(/^\d+/);
    expect(report.result.databaseSizeBytes).toBeGreaterThan(0);
    expect(report.result.extensions.map((one) => one.name)).toContain(
      'plpgsql',
    );
    expect(report.result.settings.map((one) => one.name)).toContain(
      'statement_timeout',
    );
    expect(report.result.largestRelations.length).toBeGreaterThan(0);
  });
});
