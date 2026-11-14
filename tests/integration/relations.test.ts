// Declared foreign-key relationships and the Mermaid diagram.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invoke, makeWorkspace, testUrl } from '../helpers/harness.js';

type Workspace = Awaited<ReturnType<typeof makeWorkspace>>;

interface Relationship {
  readonly name: string;
  readonly table: string;
  readonly columns: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  readonly onUpdate: string;
  readonly onDelete: string;
  readonly composite: boolean;
}

describe('relations', () => {
  let workspace: Workspace;

  const run = async (
    argv: readonly string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> =>
    invoke([...argv, '--url', testUrl()], { env: workspace.env });

  const relationships = async (
    argv: readonly string[],
  ): Promise<readonly Relationship[]> => {
    const result = await run([...argv, '--json']);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as {
      result: { relationships: readonly Relationship[] };
    };
    return report.result.relationships;
  };

  beforeAll(async () => {
    workspace = await makeWorkspace();
  });

  afterAll(async () => {
    await workspace.cleanup();
  });

  it('lists every foreign key with its referential actions', async () => {
    const result = await run(['relations']);
    expect(result.code).toBe(0);
    for (const name of [
      'customers_referred_by_fkey',
      'order_lines_order_id_fkey',
      'order_lines_sku_fkey',
      'orders_customer_id_fkey',
      'shipments_line_fk',
    ]) {
      expect(result.stdout).toContain(name);
    }
    expect(result.stdout).toMatch(
      /orders_customer_id_fkey.*cascade\s+restrict/,
    );
    expect(result.stdout).toMatch(/customers_referred_by_fkey.*set null/);
  });

  it('keeps the column order on both sides of a composite key', async () => {
    const all = await relationships(['relations']);
    const composite = all.find((one) => one.name === 'shipments_line_fk');
    expect(composite).toBeDefined();
    expect(composite?.columns).toEqual(['order_id', 'line_no']);
    expect(composite?.referencedColumns).toEqual(['order_id', 'line_no']);
    expect(composite?.composite).toBe(true);
    expect(all.filter((one) => one.composite)).toHaveLength(1);
  });

  it('shows both directions for one table', async () => {
    const result = await run(['relations', 'order_lines']);
    expect(result.code).toBe(0);
    // Outgoing: order_lines refers to orders and to inventory.products.
    expect(result.stdout).toContain('order_lines_order_id_fkey');
    expect(result.stdout).toContain('order_lines_sku_fkey');
    // Incoming: shipments refers back to order_lines.
    expect(result.stdout).toContain('shipments_line_fk');
    expect(result.stdout).not.toContain('orders_customer_id_fkey');
  });

  it('restricts the listing to one schema', async () => {
    const result = await run(['relations', '--schema', 'inventory']);
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('customers_referred_by_fkey');
  });

  it('writes a Mermaid diagram to a file', async () => {
    const path = join(workspace.dir, 'diagram.mmd');
    const result = await run(['relations', '--mermaid', path]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(path);
    const diagram = await readFile(path, 'utf8');
    expect(diagram.startsWith('erDiagram')).toBe(true);
    expect(diagram).toContain('public_order_lines');
    for (const line of diagram.split('\n').slice(1)) {
      if (line.trim() === '') continue;
      expect(line).toMatch(/^ {2}\w+ (\|\||\|o)--(\|\||o\{) \w+ : ".*"$/);
    }
  });
});
