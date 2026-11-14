// The indexes on one table.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invoke, makeWorkspace, testUrl } from '../helpers/harness.js';

type Workspace = Awaited<ReturnType<typeof makeWorkspace>>;

interface IndexReport {
  readonly result: {
    readonly indexes: readonly {
      readonly name: string;
      readonly method: string;
      readonly isUnique: boolean;
      readonly isPrimary: boolean;
      readonly sizeBytes: number;
    }[];
  };
}

describe('indexes', () => {
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

  it('lists the primary key and the secondary index with sizes', async () => {
    const result = await run(['indexes', 'inventory.products']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/products_pkey\s+btree\s+primary key/);
    expect(result.stdout).toMatch(/products_title_idx\s+btree\s+no/);
    expect(result.stdout).toMatch(/products_title_idx.*\d+(\.\d+)? KiB/);
    expect(result.stdout).toContain('USING btree (title)');
  });

  it('reports a table with no index of its own', async () => {
    const result = await run(['indexes', 'shipments']);
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('shipments_pkey');
    expect(result.stdout).toMatch(/no indexes|0 indexes/i);
  });

  it('writes the indexes as JSON', async () => {
    const result = await run(['indexes', 'inventory.products', '--json']);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as IndexReport;
    const primary = report.result.indexes.find((one) => one.isPrimary);
    expect(primary?.name).toBe('products_pkey');
    expect(primary?.isUnique).toBe(true);
    const secondary = report.result.indexes.find(
      (one) => one.name === 'products_title_idx',
    );
    expect(secondary?.isUnique).toBe(false);
    expect(secondary?.method).toBe('btree');
    expect(secondary?.sizeBytes).toBeGreaterThan(0);
  });
});
