// The structure of one relation.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invoke, makeWorkspace, testUrl } from '../helpers/harness.js';

type Workspace = Awaited<ReturnType<typeof makeWorkspace>>;

interface DescribeReport {
  readonly status: string;
  readonly result: {
    readonly relation: { readonly schema: string; readonly name: string };
    readonly exactRows: number | null;
    readonly columns: readonly { readonly name: string }[];
    readonly constraints: readonly { readonly type: string }[];
    readonly indexes: readonly { readonly name: string }[];
    readonly foreignKeys: readonly { readonly name: string }[];
    readonly referencedBy: readonly { readonly name: string }[];
  };
}

describe('describe', () => {
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

  it('shows the columns, constraints, comment and referring tables', async () => {
    const result = await run(['describe', 'customers']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('public.customers');
    expect(result.stdout).toMatch(/id\s+bigint\s+PK, not null, identity/);
    expect(result.stdout).toMatch(/email\s+text\s+not null/);
    expect(result.stdout).toContain('People who have placed an order.');
    expect(result.stdout).toContain('customers_email_key');
    expect(result.stdout).toContain('unique');
    expect(result.stdout).toContain('customers_email_lowercase');
    expect(result.stdout).toContain('check');
    expect(result.stdout).toContain('Referenced by');
    const referenced = result.stdout.slice(
      result.stdout.indexOf('Referenced by'),
    );
    expect(referenced).toContain('public.orders');
    expect(referenced).toContain('public.customers');
  });

  it('accepts a schema-qualified name', async () => {
    const result = await run(['describe', 'public.customers']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('public.customers');
  });

  it('accepts a quoted name containing a space', async () => {
    const result = await run(['describe', '"Reporting"."Daily Totals"']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Daily Totals');
    expect(result.stdout).toContain('Day');
  });

  it('shows a generated column and an array type', async () => {
    const result = await run(['describe', 'inventory.products']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/price_pounds\s+numeric\s+generated/);
    expect(result.stdout).toContain('text[]');
  });

  it('describes a view', async () => {
    const result = await run(['describe', 'customer_orders']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Kind\s+view/);
    expect(result.stdout).toContain('customer_id');
  });

  it('describes a materialised view', async () => {
    const result = await run(['describe', 'popular_products']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Kind\s+materialised view/);
    expect(result.stdout).toContain('sold');
  });

  it('reports a partition as a partition of its parent', async () => {
    const result = await run(['describe', 'events_2026']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Partition of');
    expect(result.stdout).toContain('public.events');
  });

  it('distinguishes an exact count from an estimate', async () => {
    const estimated = await run(['describe', 'customers']);
    const exact = await run(['describe', 'customers', '--exact-count']);
    expect(exact.code).toBe(0);
    expect(estimated.stdout).toContain('(estimated)');
    expect(exact.stdout).toContain('(exact)');
    expect(exact.stdout).not.toContain('(estimated)');
  });

  it('fails on a table that does not exist', async () => {
    const result = await run(['describe', 'no_such_table']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no_such_table');
  });

  it('writes the whole structure as JSON', async () => {
    const result = await run(['describe', 'customers', '--json']);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as DescribeReport;
    expect(report.result.relation.name).toBe('customers');
    expect(report.result.exactRows).toBeNull();
    expect(report.result.columns.map((column) => column.name)).toEqual([
      'id',
      'email',
      'display_name',
      'referred_by',
      'created_at',
    ]);
    expect(report.result.constraints.map((one) => one.type)).toContain(
      'primary key',
    );
    expect(report.result.indexes.map((one) => one.name)).toContain(
      'customers_pkey',
    );
    expect(report.result.foreignKeys.map((one) => one.name)).toEqual([
      'customers_referred_by_fkey',
    ]);
    expect(report.result.referencedBy.map((one) => one.name)).toContain(
      'orders_customer_id_fkey',
    );
  });

  it('reports the exact row count in JSON when asked', async () => {
    const result = await run([
      'describe',
      'customers',
      '--exact-count',
      '--json',
    ]);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as DescribeReport;
    expect(report.result.exactRows).toBe(3);
  });
});
