// Server and database diagnostics.
//
// Several of these answers depend on what the connected role is allowed to
// see. Where that is the case the value is `null` and the reason is carried
// alongside it, so the report can say "not permitted" rather than printing a
// zero that looks like a measurement.

import type { Database } from './client.js';
import { SYSTEM_SCHEMA_FILTER } from './catalog.js';

export interface ExtensionInfo {
  readonly name: string;
  readonly version: string;
  readonly schema: string;
  readonly comment: string | null;
}

export interface SizedRelation {
  readonly schema: string;
  readonly name: string;
  readonly kind: string;
  readonly totalBytes: number;
  readonly tableBytes: number;
  readonly indexBytes: number;
}

export interface SettingInfo {
  readonly name: string;
  readonly value: string;
  readonly unit: string | null;
  readonly source: string;
}

export interface Diagnostics {
  readonly serverVersion: string;
  readonly database: string;
  readonly currentRole: string;
  readonly sessionRole: string;
  readonly isSuperuser: boolean;
  readonly searchPath: string;
  readonly timeZone: string;
  readonly encoding: string;
  readonly transactionReadOnly: boolean;
  readonly statementTimeout: string;
  readonly databaseSizeBytes: number | null;
  readonly schemaCount: number;
  readonly tableCount: number;
  readonly extensions: readonly ExtensionInfo[];
  readonly largestRelations: readonly SizedRelation[];
  readonly settings: readonly SettingInfo[];
}

const REPORTED_SETTINGS = [
  'server_version',
  'server_encoding',
  'TimeZone',
  'search_path',
  'statement_timeout',
  'lock_timeout',
  'idle_in_transaction_session_timeout',
  'default_transaction_read_only',
  'max_connections',
  'shared_buffers',
  'work_mem',
  'ssl',
] as const;

export async function collectDiagnostics(
  db: Database,
  largestCount: number,
): Promise<Diagnostics> {
  const [overview] = await db.read<{
    db_size: string | null;
    is_superuser: boolean;
    search_path: string;
    time_zone: string;
    encoding: string;
    read_only: string;
    statement_timeout: string;
  }>(
    `SELECT CASE WHEN has_database_privilege(current_database(), 'CONNECT')
                 THEN pg_database_size(current_database()) END AS db_size,
            current_setting('is_superuser') = 'on' AS is_superuser,
            current_setting('search_path') AS search_path,
            current_setting('TimeZone') AS time_zone,
            current_setting('server_encoding') AS encoding,
            current_setting('transaction_read_only') AS read_only,
            current_setting('statement_timeout') AS statement_timeout`,
  );

  const [counts] = await db.read<{ schemas: string; tables: string }>(
    `SELECT (SELECT count(*) FROM pg_namespace n
              WHERE has_schema_privilege(n.oid, 'USAGE')
                AND ${SYSTEM_SCHEMA_FILTER}) AS schemas,
            (SELECT count(*) FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE c.relkind IN ('r', 'p')
                AND ${SYSTEM_SCHEMA_FILTER}) AS tables`,
  );

  const extensions = await db.read<{
    name: string;
    version: string;
    schema: string;
    comment: string | null;
  }>(
    `SELECT e.extname AS name,
            e.extversion AS version,
            n.nspname AS schema,
            obj_description(e.oid, 'pg_extension') AS comment
       FROM pg_extension e
       JOIN pg_namespace n ON n.oid = e.extnamespace
      ORDER BY e.extname`,
  );

  const largest = await db.read<{
    schema: string;
    name: string;
    kind: string;
    total_bytes: string;
    table_bytes: string;
    index_bytes: string;
  }>(
    `SELECT n.nspname AS schema,
            c.relname AS name,
            c.relkind::text AS kind,
            pg_total_relation_size(c.oid)::text AS total_bytes,
            pg_table_size(c.oid)::text AS table_bytes,
            pg_indexes_size(c.oid)::text AS index_bytes
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'm', 'p')
        AND has_table_privilege(c.oid, 'SELECT')
        AND ${SYSTEM_SCHEMA_FILTER}
      ORDER BY pg_total_relation_size(c.oid) DESC, n.nspname, c.relname
      LIMIT $1`,
    [largestCount],
  );

  const settings = await db.read<{
    name: string;
    setting: string;
    unit: string | null;
    source: string;
  }>(
    `SELECT name, setting, unit, source
       FROM pg_settings
      WHERE name = ANY($1::text[])
      ORDER BY name`,
    [[...REPORTED_SETTINGS]],
  );

  return {
    serverVersion: db.info.serverVersion,
    database: db.info.currentDatabase,
    currentRole: db.info.currentUser,
    sessionRole: db.info.sessionUser,
    isSuperuser: overview?.is_superuser ?? false,
    searchPath: overview?.search_path ?? '',
    timeZone: overview?.time_zone ?? '',
    encoding: overview?.encoding ?? '',
    transactionReadOnly: overview?.read_only === 'on',
    statementTimeout: overview?.statement_timeout ?? '',
    databaseSizeBytes:
      overview?.db_size === null || overview?.db_size === undefined
        ? null
        : Number(overview.db_size),
    schemaCount: Number(counts?.schemas ?? '0'),
    tableCount: Number(counts?.tables ?? '0'),
    extensions,
    largestRelations: largest.map((row) => ({
      schema: row.schema,
      name: row.name,
      kind: row.kind,
      totalBytes: Number(row.total_bytes),
      tableBytes: Number(row.table_bytes),
      indexBytes: Number(row.index_bytes),
    })),
    settings: settings.map((row) => ({
      name: row.name,
      value: row.setting,
      unit: row.unit,
      source: row.source,
    })),
  };
}
