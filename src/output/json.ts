// JSON reports.
//
// The envelope is versioned independently of the tool, so a consumer can
// detect a breaking change without matching on the release number. Shapes
// here are part of the published interface and change only with
// `schemaVersion`.

import { VERSION } from '../version.js';
import type {
  ColumnInfo,
  ConstraintInfo,
  DatabaseSummary,
  ForeignKeyInfo,
  IndexInfo,
  RelationSummary,
  SchemaSummary,
  SequenceInfo,
  TableDetail,
} from '../core/catalog.js';
import type { Diagnostics } from '../core/diagnostics.js';
import type { QueryOutcome } from '../core/query.js';
import type { ConnectionInfo } from '../core/client.js';
import type { ConnectionTarget } from '../core/connection.js';
import { redactedUrl } from '../core/connection.js';
import { jsonValue } from './value.js';

export const SCHEMA_VERSION = 1;

export type ReportStatus = 'ok' | 'empty' | 'truncated';

export interface Envelope<T> {
  readonly schemaVersion: number;
  readonly tool: 'schema';
  readonly version: string;
  readonly command: string;
  readonly generatedAt: string;
  readonly status: ReportStatus;
  readonly result: T;
}

export function envelope<T>(
  command: string,
  status: ReportStatus,
  result: T,
  now: Date = new Date(),
): Envelope<T> {
  return {
    schemaVersion: SCHEMA_VERSION,
    tool: 'schema',
    version: VERSION,
    command,
    generatedAt: now.toISOString(),
    status,
    result,
  };
}

export function connectionToJson(
  target: ConnectionTarget,
  info: ConnectionInfo,
): Record<string, unknown> {
  return {
    url: redactedUrl(target),
    host: target.host,
    port: target.port,
    database: info.currentDatabase,
    user: info.currentUser,
    sessionUser: info.sessionUser,
    serverVersion: info.serverVersion,
    serverVersionNum: info.serverVersionNum,
    backendPid: info.backendPid,
    sslMode: target.sslMode,
    sslModeUsed: info.sslModeUsed,
    tls: info.tls,
  };
}

export function databasesToJson(
  rows: readonly DatabaseSummary[],
): Record<string, unknown> {
  return { databases: rows };
}

export function schemasToJson(
  rows: readonly SchemaSummary[],
): Record<string, unknown> {
  return { schemas: rows };
}

export function relationsToJson(
  rows: readonly RelationSummary[],
): Record<string, unknown> {
  return { relations: rows };
}

export function sequencesToJson(
  rows: readonly SequenceInfo[],
): Record<string, unknown> {
  return { sequences: rows };
}

export function columnsToJson(
  rows: readonly ColumnInfo[],
): readonly Record<string, unknown>[] {
  return rows.map((column) => ({ ...column }));
}

export function constraintsToJson(
  rows: readonly ConstraintInfo[],
): readonly Record<string, unknown>[] {
  return rows.map((constraint) => ({ ...constraint }));
}

export function indexesToJson(
  rows: readonly IndexInfo[],
): readonly Record<string, unknown>[] {
  return rows.map((index) => ({ ...index }));
}

export function foreignKeysToJson(
  rows: readonly ForeignKeyInfo[],
): readonly Record<string, unknown>[] {
  return rows.map((key) => ({ ...key, composite: key.columns.length > 1 }));
}

export function tableToJson(
  detail: TableDetail,
  exactRows: number | null,
): Record<string, unknown> {
  return {
    relation: detail.relation,
    exactRows,
    partitionOf: detail.partitionOf,
    columns: columnsToJson(detail.columns),
    constraints: constraintsToJson(detail.constraints),
    indexes: indexesToJson(detail.indexes),
    foreignKeys: foreignKeysToJson(detail.foreignKeys),
    referencedBy: foreignKeysToJson(detail.referencedBy),
  };
}

export function queryToJson(
  outcome: QueryOutcome,
  sql: string,
  parameters: readonly string[],
): Record<string, unknown> {
  return {
    // The statement is echoed, the parameter values are not: a parameter is
    // where a credential or a personal detail is most likely to be.
    statement: sql,
    parameterCount: parameters.length,
    columns: outcome.fields.map((field) => ({
      name: field.name,
      dataTypeId: field.dataTypeId,
    })),
    rows: outcome.rows.map((row) => row.map((value) => jsonValue(value))),
    rowCount: outcome.rowCount,
    truncatedBy: outcome.truncatedBy,
    buffered: outcome.buffered,
    approximateBytes: outcome.approximateBytes,
    durationMs: Math.round(outcome.durationMs * 100) / 100,
  };
}

export function diagnosticsToJson(
  diagnostics: Diagnostics,
): Record<string, unknown> {
  return { ...diagnostics };
}

/** One JSON document per line is never written; reports are whole documents. */
export function render(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
