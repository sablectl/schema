import { describe, expect, it } from 'vitest';
import {
  describeEdge,
  qualified,
  toEdge,
  toMermaid,
} from '../../../src/core/relations.js';
import { foreignKey } from '../helpers/fixtures.js';

describe('qualified', () => {
  it('quotes only what needs quoting', () => {
    expect(qualified('public', 'orders')).toBe('public.orders');
    expect(qualified('My Schema', 'Orders')).toBe('"My Schema"."Orders"');
  });
});

describe('describeEdge', () => {
  it('words a single-column edge as source to target', () => {
    expect(describeEdge(foreignKey())).toBe(
      'public.orders(customer_id) -> public.customers(id)',
    );
  });

  it('lists every column of a composite edge', () => {
    expect(
      describeEdge(
        foreignKey({
          columns: ['tenant_id', 'customer_id'],
          referencedColumns: ['tenant_id', 'id'],
        }),
      ),
    ).toBe(
      'public.orders(tenant_id, customer_id) -> ' +
        'public.customers(tenant_id, id)',
    );
  });

  it('quotes an awkward relation name', () => {
    expect(describeEdge(foreignKey({ table: 'My Orders' }))).toBe(
      'public."My Orders"(customer_id) -> public.customers(id)',
    );
  });
});

describe('toEdge', () => {
  it('marks a single-column key as not composite', () => {
    const edge = toEdge(foreignKey(), 'outgoing');
    expect(edge.composite).toBe(false);
    expect(edge.direction).toBe('outgoing');
    expect(edge.name).toBe('orders_customer_id_fkey');
  });

  it('marks a multi-column key as composite', () => {
    const edge = toEdge(
      foreignKey({ columns: ['tenant_id', 'customer_id'] }),
      'incoming',
    );
    expect(edge.composite).toBe(true);
    expect(edge.direction).toBe('incoming');
  });
});

describe('toMermaid', () => {
  const key = foreignKey();
  const signature = `${key.schema}.${key.table}.${key.name}`;

  it('writes one parent to many children by default', () => {
    expect(toMermaid([key], new Set<string>(), new Set<string>())).toBe(
      'erDiagram\n' +
        '  public_customers ||--o{ public_orders : "customer_id"\n',
    );
  });

  it('makes the parent side optional for a nullable column', () => {
    expect(toMermaid([key], new Set<string>(), new Set([signature]))).toContain(
      '|o--o{',
    );
  });

  it('makes it one to one when the referencing side is unique', () => {
    expect(toMermaid([key], new Set([signature]), new Set<string>())).toContain(
      '||--||',
    );
  });

  it('combines an optional parent with a unique child', () => {
    expect(
      toMermaid([key], new Set([signature]), new Set([signature])),
    ).toContain('|o--||');
  });

  it('substitutes a name Mermaid cannot carry', () => {
    const awkward = foreignKey({ table: 'my orders', schema: 'my schema' });
    const diagram = toMermaid([awkward], new Set<string>(), new Set<string>());
    expect(diagram).toContain('my_schema_my_orders');
    expect(diagram).not.toContain('my orders');
  });

  it('prefixes a name that would start with a digit', () => {
    const awkward = foreignKey({ referencedSchema: '1st', table: 'orders' });
    expect(
      toMermaid([awkward], new Set<string>(), new Set<string>()),
    ).toContain('r_1st_customers');
  });

  it('writes a comment line when there is nothing to draw', () => {
    expect(toMermaid([], new Set<string>(), new Set<string>())).toBe(
      'erDiagram\n  %% no foreign keys found\n',
    );
  });

  it('writes one line per key', () => {
    const diagram = toMermaid(
      [key, foreignKey({ name: 'other', table: 'invoices' })],
      new Set<string>(),
      new Set<string>(),
    );
    expect(diagram.trimEnd().split('\n')).toHaveLength(3);
  });
});
