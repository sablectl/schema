// Catalogue inspection.
//
// Every query here reads `pg_catalog` directly rather than
// `information_schema`: the catalogue is faster, exposes details the standard
// views omit (index methods, referential actions, estimated row counts) and
// does not change shape between minor releases. Object names are never
// interpolated into SQL text; they are bound as parameters.

import { AppError } from './errors.js';
import { quoteIdentifier } from './identifiers.js';
import type { Database } from './client.js';

export const SYSTEM_SCHEMA_FILTER = `(n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND n.nspname NOT LIKE 'pg\\_toast%'
     AND n.nspname NOT LIKE 'pg\\_temp%')`;

export type RelationKind =
  | 'table'
  | 'view'
  | 'materialised view'
  | 'partitioned table'
  | 'foreign table'
  | 'sequence'
  | 'index'
  | 'other';

const KIND_BY_RELKIND: Record<string, RelationKind> = {
  r: 'table',
  v: 'view',
  m: 'materialised view',
  p: 'partitioned table',
  f: 'foreign table',
  S: 'sequence',
  i: 'index',
};

export function relationKind(relkind: string): RelationKind {
  return KIND_BY_RELKIND[relkind] ?? 'other';
}

/** Relation kinds that `tables`, `describe` and `export` operate on. */
export const INSPECTABLE_RELKINDS = ['r', 'v', 'm', 'p', 'f'] as const;

export interface DatabaseSummary {
  readonly name: string;
  readonly owner: string;
  readonly encoding: string;
  readonly collate: string;
  readonly connectable: boolean;
  readonly isCurrent: boolean;
  /** `null` when the role may not read the size. */
  readonly sizeBytes: number | null;
}

export interface SchemaSummary {
  readonly name: string;
  readonly owner: string;
  readonly comment: string | null;
  readonly tables: number;
  readonly views: number;
  readonly materialisedViews: number;
  readonly isSystem: boolean;
}

export interface RelationSummary {
  readonly schema: string;
  readonly name: string;
  readonly kind: RelationKind;
  readonly owner: string;
  /**
   * The planner's estimate, from `pg_class.reltuples`. `null` when the
   * relation has never been analysed, which is a different statement from
   * "zero rows" and is reported as such.
   */
  readonly estimatedRows: number | null;
  readonly sizeBytes: number | null;
  readonly comment: string | null;
}

export interface ColumnInfo {
  readonly position: number;
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly defaultValue: string | null;
  /** `a` for always, `d` for by default, `null` when not an identity. */
  readonly identity: string | null;
  /** `s` for stored, `null` when not generated. */
  readonly generated: string | null;
  readonly collation: string | null;
  readonly comment: string | null;
}

export interface ConstraintInfo {
  readonly name: string;
  readonly type: 'primary key' | 'foreign key' | 'unique' | 'check' | 'other';
  readonly definition: string;
  readonly columns: readonly string[];
}

export interface IndexInfo {
  readonly name: string;
  readonly definition: string;
  readonly method: string;
  readonly isUnique: boolean;
  readonly isPrimary: boolean;
  readonly isValid: boolean;
  readonly sizeBytes: number | null;
}

export interface ForeignKeyInfo {
  readonly name: string;
  readonly schema: string;
  readonly table: string;
  readonly columns: readonly string[];
  readonly referencedSchema: string;
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  readonly onUpdate: string;
  readonly onDelete: string;
  readonly matchType: string;
}

export interface SequenceInfo {
  readonly schema: string;
  readonly name: string;
  readonly dataType: string;
  readonly startValue: string | null;
  readonly increment: string | null;
  readonly minimumValue: string | null;
  readonly maximumValue: string | null;
  readonly cycles: boolean;
  readonly ownedBy: string | null;
}

export interface RelationRef {
  readonly oid: number;
  readonly schema: string;
  readonly name: string;
  readonly kind: RelationKind;
}

export interface TableDetail {
  readonly relation: RelationSummary;
  readonly columns: readonly ColumnInfo[];
  readonly constraints: readonly ConstraintInfo[];
  readonly indexes: readonly IndexInfo[];
  readonly foreignKeys: readonly ForeignKeyInfo[];
  readonly referencedBy: readonly ForeignKeyInfo[];
  readonly partitionOf: string | null;
}

const ACTION_NAMES: Record<string, string> = {
  a: 'no action',
  r: 'restrict',
  c: 'cascade',
  n: 'set null',
  d: 'set default',
};

const MATCH_NAMES: Record<string, string> = {
  f: 'full',
  p: 'partial',
  s: 'simple',
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

export async function listDatabases(
  db: Database,
): Promise<readonly DatabaseSummary[]> {
  const rows = await db.read<{
    name: string;
    owner: string;
    encoding: string;
    collate: string;
    connectable: boolean;
    is_current: boolean;
    size_bytes: string | null;
  }>(
    `SELECT d.datname AS name,
            pg_get_userbyid(d.datdba) AS owner,
            pg_encoding_to_char(d.encoding) AS encoding,
            d.datcollate AS collate,
            d.datallowconn AS connectable,
            d.datname = current_database() AS is_current,
            CASE WHEN has_database_privilege(d.oid, 'CONNECT')
                 THEN pg_database_size(d.oid) END AS size_bytes
       FROM pg_database d
      WHERE NOT d.datistemplate
      ORDER BY d.datname`,
  );
  return rows.map((row) => ({
    name: row.name,
    owner: row.owner,
    encoding: row.encoding,
    collate: row.collate,
    connectable: row.connectable,
    isCurrent: row.is_current,
    sizeBytes: toNumber(row.size_bytes),
  }));
}

export async function listSchemas(
  db: Database,
  includeSystem: boolean,
): Promise<readonly SchemaSummary[]> {
  const rows = await db.read<{
    name: string;
    owner: string;
    comment: string | null;
    tables: string;
    views: string;
    matviews: string;
    is_system: boolean;
  }>(
    `SELECT n.nspname AS name,
            pg_get_userbyid(n.nspowner) AS owner,
            obj_description(n.oid, 'pg_namespace') AS comment,
            count(c.oid) FILTER (WHERE c.relkind IN ('r', 'p')) AS tables,
            count(c.oid) FILTER (WHERE c.relkind = 'v') AS views,
            count(c.oid) FILTER (WHERE c.relkind = 'm') AS matviews,
            NOT ${SYSTEM_SCHEMA_FILTER} AS is_system
       FROM pg_namespace n
       LEFT JOIN pg_class c ON c.relnamespace = n.oid
      WHERE has_schema_privilege(n.oid, 'USAGE')
        AND ($1 OR ${SYSTEM_SCHEMA_FILTER})
      GROUP BY n.oid, n.nspname, n.nspowner
      ORDER BY n.nspname`,
    [includeSystem],
  );
  return rows.map((row) => ({
    name: row.name,
    owner: row.owner,
    comment: row.comment,
    tables: Number(row.tables),
    views: Number(row.views),
    materialisedViews: Number(row.matviews),
    isSystem: row.is_system,
  }));
}

export interface RelationFilter {
  readonly schema?: string | undefined;
  /** Matched against the relation name with `LIKE`. */
  readonly pattern?: string | undefined;
  readonly kinds?: readonly string[] | undefined;
  readonly includeSystem: boolean;
  readonly limit: number;
}

export async function listRelations(
  db: Database,
  filter: RelationFilter,
): Promise<readonly RelationSummary[]> {
  const rows = await db.read<{
    schema: string;
    name: string;
    relkind: string;
    owner: string;
    estimated_rows: string | null;
    size_bytes: string | null;
    comment: string | null;
  }>(
    `SELECT n.nspname AS schema,
            c.relname AS name,
            c.relkind::text AS relkind,
            pg_get_userbyid(c.relowner) AS owner,
            CASE WHEN c.reltuples < 0 THEN NULL
                 ELSE c.reltuples::bigint END AS estimated_rows,
            CASE WHEN c.relkind IN ('r', 'm', 'p', 'S')
                  AND has_table_privilege(c.oid, 'SELECT')
                 THEN pg_total_relation_size(c.oid) END AS size_bytes,
            obj_description(c.oid, 'pg_class') AS comment
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind::text = ANY($1::text[])
        AND has_schema_privilege(n.oid, 'USAGE')
        AND ($2 OR ${SYSTEM_SCHEMA_FILTER})
        AND ($3::text IS NULL OR n.nspname = $3)
        AND ($4::text IS NULL OR c.relname LIKE $4)
      ORDER BY n.nspname, c.relname
      LIMIT $5`,
    [
      filter.kinds ?? [...INSPECTABLE_RELKINDS],
      filter.includeSystem,
      filter.schema ?? null,
      filter.pattern ?? null,
      filter.limit,
    ],
  );
  return rows.map((row) => ({
    schema: row.schema,
    name: row.name,
    kind: relationKind(row.relkind),
    owner: row.owner,
    estimatedRows: toNumber(row.estimated_rows),
    sizeBytes: toNumber(row.size_bytes),
    comment: row.comment,
  }));
}

/**
 * Find one relation by name.
 *
 * With no schema given the search path decides, exactly as it would for a
 * query, so `describe users` resolves the same table the user would read.
 * An unqualified name visible in two schemas is an error rather than a
 * guess.
 */
export async function resolveRelation(
  db: Database,
  schema: string | undefined,
  name: string,
): Promise<RelationRef> {
  const rows = await db.read<{
    oid: number;
    schema: string;
    name: string;
    relkind: string;
  }>(
    `SELECT c.oid AS oid, n.nspname AS schema, c.relname AS name,
            c.relkind::text AS relkind
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = $1
        AND c.relkind::text = ANY($3::text[])
        AND has_schema_privilege(n.oid, 'USAGE')
        AND ($2::text IS NULL OR n.nspname = $2)
        AND ($2::text IS NOT NULL OR pg_table_is_visible(c.oid))
      ORDER BY n.nspname`,
    [name, schema ?? null, [...INSPECTABLE_RELKINDS]],
  );
  const qualified = schema === undefined ? name : `${schema}.${name}`;
  const first = rows[0];
  if (first === undefined) {
    throw new AppError(
      'not-found',
      `No table, view or materialised view named ${qualified} is visible.`,
      schema === undefined
        ? 'Qualify the name with its schema, or run schema tables to list what is there.'
        : 'Run schema tables to list what is there.',
    );
  }
  if (rows.length > 1) {
    throw new AppError(
      'not-found',
      `${name} is ambiguous: it exists in ${rows.map((row) => row.schema).join(', ')}.`,
      'Qualify the name with its schema.',
    );
  }
  return {
    oid: first.oid,
    schema: first.schema,
    name: first.name,
    kind: relationKind(first.relkind),
  };
}

export async function listColumns(
  db: Database,
  oid: number,
): Promise<readonly ColumnInfo[]> {
  const rows = await db.read<{
    position: number;
    name: string;
    type: string;
    nullable: boolean;
    default_value: string | null;
    identity: string;
    generated: string;
    collation: string | null;
    comment: string | null;
  }>(
    `SELECT a.attnum AS position,
            a.attname AS name,
            format_type(a.atttypid, a.atttypmod) AS type,
            NOT a.attnotnull AS nullable,
            pg_get_expr(d.adbin, d.adrelid) AS default_value,
            a.attidentity::text AS identity,
            a.attgenerated::text AS generated,
            CASE WHEN a.attcollation <> 0 AND a.attcollation <> t.typcollation
                 THEN co.collname END AS collation,
            col_description(a.attrelid, a.attnum) AS comment
       FROM pg_attribute a
       JOIN pg_type t ON t.oid = a.atttypid
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       LEFT JOIN pg_collation co ON co.oid = a.attcollation
      WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`,
    [oid],
  );
  return rows.map((row) => ({
    position: row.position,
    name: row.name,
    type: row.type,
    nullable: row.nullable,
    defaultValue: row.default_value,
    identity: row.identity === '' ? null : row.identity,
    generated: row.generated === '' ? null : row.generated,
    collation: row.collation,
    comment: row.comment,
  }));
}

export async function listConstraints(
  db: Database,
  oid: number,
): Promise<readonly ConstraintInfo[]> {
  const rows = await db.read<{
    name: string;
    contype: string;
    definition: string;
    columns: string[] | null;
  }>(
    `SELECT con.conname AS name,
            con.contype::text AS contype,
            pg_get_constraintdef(con.oid) AS definition,
            (SELECT array_agg(a.attname::text ORDER BY u.ord)
               FROM unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
               JOIN pg_attribute a
                 ON a.attrelid = con.conrelid AND a.attnum = u.attnum)
              AS columns
       FROM pg_constraint con
      WHERE con.conrelid = $1
      ORDER BY CASE con.contype
                 WHEN 'p' THEN 1 WHEN 'u' THEN 2
                 WHEN 'f' THEN 3 WHEN 'c' THEN 4 ELSE 5 END,
               con.conname`,
    [oid],
  );
  const types: Record<string, ConstraintInfo['type']> = {
    p: 'primary key',
    f: 'foreign key',
    u: 'unique',
    c: 'check',
  };
  return rows.map((row) => ({
    name: row.name,
    type: types[row.contype] ?? 'other',
    definition: row.definition,
    columns: toStringArray(row.columns),
  }));
}

export async function listIndexes(
  db: Database,
  oid: number,
): Promise<readonly IndexInfo[]> {
  const rows = await db.read<{
    name: string;
    definition: string;
    method: string;
    is_unique: boolean;
    is_primary: boolean;
    is_valid: boolean;
    size_bytes: string | null;
  }>(
    `SELECT i.relname AS name,
            pg_get_indexdef(x.indexrelid) AS definition,
            am.amname AS method,
            x.indisunique AS is_unique,
            x.indisprimary AS is_primary,
            x.indisvalid AS is_valid,
            pg_relation_size(x.indexrelid) AS size_bytes
       FROM pg_index x
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_am am ON am.oid = i.relam
      WHERE x.indrelid = $1
      ORDER BY x.indisprimary DESC, i.relname`,
    [oid],
  );
  return rows.map((row) => ({
    name: row.name,
    definition: row.definition,
    method: row.method,
    isUnique: row.is_unique,
    isPrimary: row.is_primary,
    isValid: row.is_valid,
    sizeBytes: toNumber(row.size_bytes),
  }));
}

interface ForeignKeyRow {
  name: string;
  schema: string;
  table_name: string;
  ref_schema: string;
  ref_table: string;
  columns: string[] | null;
  ref_columns: string[] | null;
  on_update: string;
  on_delete: string;
  match_type: string;
}

const FOREIGN_KEY_SELECT = `
  SELECT con.conname AS name,
         sn.nspname AS schema,
         st.relname AS table_name,
         tn.nspname AS ref_schema,
         tt.relname AS ref_table,
         (SELECT array_agg(a.attname::text ORDER BY u.ord)
            FROM unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
            JOIN pg_attribute a
              ON a.attrelid = con.conrelid AND a.attnum = u.attnum) AS columns,
         (SELECT array_agg(a.attname::text ORDER BY u.ord)
            FROM unnest(con.confkey) WITH ORDINALITY AS u(attnum, ord)
            JOIN pg_attribute a
              ON a.attrelid = con.confrelid AND a.attnum = u.attnum)
           AS ref_columns,
         con.confupdtype::text AS on_update,
         con.confdeltype::text AS on_delete,
         con.confmatchtype::text AS match_type
    FROM pg_constraint con
    JOIN pg_class st ON st.oid = con.conrelid
    JOIN pg_namespace sn ON sn.oid = st.relnamespace
    JOIN pg_class tt ON tt.oid = con.confrelid
    JOIN pg_namespace tn ON tn.oid = tt.relnamespace
   WHERE con.contype = 'f'`;

function toForeignKey(row: ForeignKeyRow): ForeignKeyInfo {
  return {
    name: row.name,
    schema: row.schema,
    table: row.table_name,
    columns: toStringArray(row.columns),
    referencedSchema: row.ref_schema,
    referencedTable: row.ref_table,
    referencedColumns: toStringArray(row.ref_columns),
    onUpdate: ACTION_NAMES[row.on_update] ?? row.on_update,
    onDelete: ACTION_NAMES[row.on_delete] ?? row.on_delete,
    matchType: MATCH_NAMES[row.match_type] ?? row.match_type,
  };
}

export async function listForeignKeys(
  db: Database,
  oid: number,
): Promise<readonly ForeignKeyInfo[]> {
  const rows = await db.read<ForeignKeyRow>(
    `${FOREIGN_KEY_SELECT} AND con.conrelid = $1 ORDER BY con.conname`,
    [oid],
  );
  return rows.map(toForeignKey);
}

export async function listReferencingKeys(
  db: Database,
  oid: number,
): Promise<readonly ForeignKeyInfo[]> {
  const rows = await db.read<ForeignKeyRow>(
    `${FOREIGN_KEY_SELECT} AND con.confrelid = $1
       ORDER BY sn.nspname, st.relname, con.conname`,
    [oid],
  );
  return rows.map(toForeignKey);
}

/**
 * Every foreign key in the database, optionally limited to one schema.
 *
 * Relationships are read from `pg_constraint` only. A column called
 * `user_id` with no constraint behind it is not a relationship, and Schema
 * does not report one.
 */
export async function listAllForeignKeys(
  db: Database,
  schema: string | undefined,
  includeSystem: boolean,
): Promise<readonly ForeignKeyInfo[]> {
  const rows = await db.read<ForeignKeyRow>(
    `${FOREIGN_KEY_SELECT}
       AND ($1::text IS NULL OR sn.nspname = $1 OR tn.nspname = $1)
       AND ($2 OR (sn.nspname NOT IN ('pg_catalog', 'information_schema')
                   AND sn.nspname NOT LIKE 'pg\\_toast%'
                   AND sn.nspname NOT LIKE 'pg\\_temp%'))
     ORDER BY sn.nspname, st.relname, con.conname`,
    [schema ?? null, includeSystem],
  );
  return rows.map(toForeignKey);
}

export async function listSequences(
  db: Database,
  schema: string | undefined,
  includeSystem: boolean,
): Promise<readonly SequenceInfo[]> {
  const rows = await db.read<{
    schema: string;
    name: string;
    data_type: string;
    start_value: string | null;
    increment: string | null;
    min_value: string | null;
    max_value: string | null;
    cycles: boolean;
    owned_by: string | null;
  }>(
    `SELECT n.nspname AS schema,
            c.relname AS name,
            format_type(s.seqtypid, NULL) AS data_type,
            s.seqstart::text AS start_value,
            s.seqincrement::text AS increment,
            s.seqmin::text AS min_value,
            s.seqmax::text AS max_value,
            s.seqcycle AS cycles,
            (SELECT quote_ident(dn.nspname) || '.' || quote_ident(dc.relname)
                    || '.' || quote_ident(da.attname)
               FROM pg_depend dep
               JOIN pg_class dc ON dc.oid = dep.refobjid
               JOIN pg_namespace dn ON dn.oid = dc.relnamespace
               JOIN pg_attribute da
                 ON da.attrelid = dep.refobjid AND da.attnum = dep.refobjsubid
              WHERE dep.objid = c.oid AND dep.deptype IN ('a', 'i')
                AND dep.classid = 'pg_class'::regclass
              LIMIT 1) AS owned_by
       FROM pg_sequence s
       JOIN pg_class c ON c.oid = s.seqrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE has_schema_privilege(n.oid, 'USAGE')
        AND ($1::text IS NULL OR n.nspname = $1)
        AND ($2 OR ${SYSTEM_SCHEMA_FILTER})
      ORDER BY n.nspname, c.relname`,
    [schema ?? null, includeSystem],
  );
  return rows.map((row) => ({
    schema: row.schema,
    name: row.name,
    dataType: row.data_type,
    startValue: row.start_value,
    increment: row.increment,
    minimumValue: row.min_value,
    maximumValue: row.max_value,
    cycles: row.cycles,
    ownedBy: row.owned_by,
  }));
}

async function relationSummary(
  db: Database,
  ref: RelationRef,
): Promise<RelationSummary> {
  const rows = await db.read<{
    owner: string;
    estimated_rows: string | null;
    size_bytes: string | null;
    comment: string | null;
  }>(
    `SELECT pg_get_userbyid(c.relowner) AS owner,
            CASE WHEN c.reltuples < 0 THEN NULL
                 ELSE c.reltuples::bigint END AS estimated_rows,
            CASE WHEN c.relkind IN ('r', 'm', 'p')
                  AND has_table_privilege(c.oid, 'SELECT')
                 THEN pg_total_relation_size(c.oid) END AS size_bytes,
            obj_description(c.oid, 'pg_class') AS comment
       FROM pg_class c WHERE c.oid = $1`,
    [ref.oid],
  );
  const row = rows[0];
  return {
    schema: ref.schema,
    name: ref.name,
    kind: ref.kind,
    owner: row?.owner ?? 'unknown',
    estimatedRows: toNumber(row?.estimated_rows),
    sizeBytes: toNumber(row?.size_bytes),
    comment: row?.comment ?? null,
  };
}

export async function describeRelation(
  db: Database,
  ref: RelationRef,
): Promise<TableDetail> {
  // One connection, so these run one after another. Issuing them together
  // would queue them in the driver anyway and makes the ordering harder to
  // reason about.
  const relation = await relationSummary(db, ref);
  const columns = await listColumns(db, ref.oid);
  const constraints = await listConstraints(db, ref.oid);
  const indexes = await listIndexes(db, ref.oid);
  const foreignKeys = await listForeignKeys(db, ref.oid);
  const referencedBy = await listReferencingKeys(db, ref.oid);
  const parent = await db.read<{ parent: string | null }>(
    `SELECT (SELECT quote_ident(pn.nspname) || '.' || quote_ident(pc.relname)
               FROM pg_inherits i
               JOIN pg_class pc ON pc.oid = i.inhparent
               JOIN pg_namespace pn ON pn.oid = pc.relnamespace
              WHERE i.inhrelid = $1 LIMIT 1) AS parent`,
    [ref.oid],
  );
  return {
    relation,
    columns,
    constraints,
    indexes,
    foreignKeys,
    referencedBy,
    partitionOf: parent[0]?.parent ?? null,
  };
}

/**
 * An exact row count.
 *
 * Separated from the summary because it is a sequential scan: on a large
 * table it is slow enough that it has to be asked for explicitly.
 */
export async function countRows(
  db: Database,
  ref: RelationRef,
): Promise<number> {
  const relation = `${quoteIdentifier(ref.schema)}.${quoteIdentifier(ref.name)}`;
  const rows = await db.read<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${relation}`,
  );
  return Number(rows[0]?.count ?? '0');
}
