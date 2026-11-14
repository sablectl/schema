// Listing databases, schemas, relations and sequences.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invoke, makeWorkspace, testUrl } from '../helpers/harness.js';

type Workspace = Awaited<ReturnType<typeof makeWorkspace>>;

describe('the catalogue commands', () => {
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

  it('lists the databases and marks the current one', async () => {
    const result = await run(['databases']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('schema_fixture');
    expect(result.stdout).toMatch(/schema_fixture.*current/);
  });

  it('lists the user schemas but not the system ones', async () => {
    const result = await run(['schemas']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('public');
    expect(result.stdout).toContain('inventory');
    expect(result.stdout).toContain('Reporting');
    expect(result.stdout).not.toContain('pg_catalog');
  });

  it('includes the system schemas with --system', async () => {
    const result = await run(['schemas', '--system']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('pg_catalog');
    expect(result.stdout).toContain('information_schema');
  });

  it('lists every relation with its kind', async () => {
    const result = await run(['tables']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('customers');
    expect(result.stdout).toContain('order_lines');
    expect(result.stdout).toContain('shipments');
    expect(result.stdout).toContain('products');
    expect(result.stdout).toContain('Daily Totals');
    expect(result.stdout).toContain('customer_orders');
    expect(result.stdout).toContain('popular_products');
    expect(result.stdout).toMatch(/customer_orders\s+view/);
    expect(result.stdout).toMatch(/popular_products\s+mat/);
  });

  it('restricts the listing to one schema', async () => {
    const result = await run(['tables', '--schema', 'inventory']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('products');
    expect(result.stdout).not.toContain('customers');
  });

  it('accepts a LIKE pattern as a positional argument', async () => {
    const result = await run(['tables', 'cust%']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('customers');
    expect(result.stdout).toContain('customer_orders');
    expect(result.stdout).not.toContain('shipments');
  });

  it('filters by one kind', async () => {
    const result = await run(['tables', '--kind', 'view']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('customer_orders');
    expect(result.stdout).not.toContain('customers  ');
  });

  it('accepts two --kind values', async () => {
    const result = await run(['tables', '--kind', 'view', '--kind', 'matview']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('customer_orders');
    expect(result.stdout).toContain('popular_products');
    expect(result.stdout).not.toContain('order_lines');
  });

  it('refuses an unknown kind', async () => {
    const result = await run(['tables', '--kind', 'spreadsheet']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('is not a relation kind');
  });

  it('reports a limited listing as truncated', async () => {
    const result = await run(['tables', '--limit', '1', '--json']);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as {
      status: string;
      result: { relations: readonly unknown[] };
    };
    expect(report.status).toBe('truncated');
    expect(report.result.relations).toHaveLength(1);
  });

  it('lists sequences with the columns that own them', async () => {
    const result = await run(['sequences']);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/inventory\s+restock_seq/);
    expect(result.stdout).toContain('customers_id_seq');
    expect(result.stdout).toContain('public.customers.id');
  });
});
