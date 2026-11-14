// Relationship views over the foreign keys read from the catalogue.
//
// Nothing here infers a relationship. A column named `user_id` with no
// constraint behind it is a naming convention, not a reference, and guessing
// would produce a diagram that disagrees with the database.

import type { ForeignKeyInfo } from './catalog.js';
import { maybeQuote } from './identifiers.js';

export type Direction = 'outgoing' | 'incoming';

export interface RelationEdge extends ForeignKeyInfo {
  readonly direction: Direction;
  readonly composite: boolean;
}

export function toEdge(
  key: ForeignKeyInfo,
  direction: Direction,
): RelationEdge {
  return { ...key, direction, composite: key.columns.length > 1 };
}

export function qualified(schema: string, name: string): string {
  return `${maybeQuote(schema)}.${maybeQuote(name)}`;
}

/** `orders.customer_id -> customers.id` */
export function describeEdge(key: ForeignKeyInfo): string {
  const source = `${qualified(key.schema, key.table)}(${key.columns.join(', ')})`;
  const target = `${qualified(key.referencedSchema, key.referencedTable)}(${key.referencedColumns.join(', ')})`;
  return `${source} -> ${target}`;
}

const MERMAID_SAFE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A Mermaid identifier for a relation.
 *
 * Mermaid has no escaping syntax for node names, so a name it cannot carry
 * is replaced by a deterministic, readable substitute rather than written
 * out and left to break the diagram.
 */
function mermaidName(schema: string, name: string): string {
  const joined = `${schema}_${name}`;
  if (MERMAID_SAFE.test(joined)) return joined;
  return joined.replaceAll(/[^A-Za-z0-9_]/g, '_').replace(/^(?=\d)/, 'r_');
}

/**
 * Render foreign keys as a Mermaid entity relationship diagram.
 *
 * Cardinality is read from the constraint: a foreign key whose columns are
 * also covered by a unique constraint is one-to-one, otherwise many-to-one.
 * Optionality follows the nullability of the referencing columns.
 */
export function toMermaid(
  keys: readonly ForeignKeyInfo[],
  uniqueSides: ReadonlySet<string>,
  optionalSides: ReadonlySet<string>,
): string {
  const lines = ['erDiagram'];
  for (const key of keys) {
    const parent = mermaidName(key.referencedSchema, key.referencedTable);
    const child = mermaidName(key.schema, key.table);
    const signature = `${key.schema}.${key.table}.${key.name}`;
    // Mermaid writes the left marker reversed: `||--o{` is one parent to
    // many children. A nullable referencing column makes the parent side
    // optional, and a unique referencing side makes the child side one.
    const parentSide = optionalSides.has(signature) ? '|o' : '||';
    const childSide = uniqueSides.has(signature) ? '||' : 'o{';
    lines.push(
      `  ${parent} ${parentSide}--${childSide} ${child} : "${key.columns.join(', ')}"`,
    );
  }
  if (keys.length === 0) lines.push('  %% no foreign keys found');
  return `${lines.join('\n')}\n`;
}
