// Read-only query execution.
//
// The read-only guarantee comes from the server: the session and the
// transaction are both read-only, so `INSERT` fails with error 25006 before
// Schema has to form an opinion about what the statement says. Nothing here
// inspects the SQL text to decide whether it is safe, because a keyword test
// is not a security boundary — a write can hide inside a function call, a
// rule or a data-modifying CTE.
//
// What this file does add is bounds: a server-side cursor so a large result
// is fetched in pieces rather than buffered whole, a row limit and a byte
// budget.

import { AppError } from './errors.js';
import { assertRunnable } from './statement.js';
import type { Database, Field, RowSet } from './client.js';

export interface QueryLimits {
  readonly maxRows: number;
  readonly maxBytes: number;
  /** Rows fetched from the cursor per round trip. */
  readonly batchSize: number;
}

export const DEFAULT_LIMITS: QueryLimits = {
  maxRows: 200,
  maxBytes: 8 * 1024 * 1024,
  batchSize: 100,
};

export interface QueryOutcome {
  readonly fields: readonly Field[];
  readonly rows: readonly (readonly unknown[])[];
  /** Rows returned, which is at most `maxRows`. */
  readonly rowCount: number;
  /** A limit stopped the read before the result was exhausted. */
  readonly truncatedBy: 'rows' | 'bytes' | null;
  readonly durationMs: number;
  /** The cursor could not be used, so the whole result was buffered. */
  readonly buffered: boolean;
  readonly approximateBytes: number;
}

const CURSOR_NAME = 'schema_result';

/** A rough size for the byte budget: enough to stop runaway memory use. */
function sizeOf(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (value instanceof Uint8Array) return value.byteLength;
  if (typeof value === 'number' || typeof value === 'boolean') return 8;
  if (value instanceof Date) return 24;
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '');
  } catch {
    return 64;
  }
}

function rowSize(row: readonly unknown[]): number {
  let total = 0;
  for (const value of row) total += sizeOf(value);
  return total;
}

/**
 * Run one statement and collect a bounded result.
 *
 * A cursor is tried first. Statements that cannot be declared as a cursor —
 * `EXPLAIN`, `SHOW` and the other utility commands — fall back to a direct
 * execution, which is reported in the outcome so the caller can say that the
 * byte budget was applied after the fact rather than during the read.
 */
export async function runQuery(
  db: Database,
  sql: string,
  params: readonly unknown[],
  limits: QueryLimits,
): Promise<QueryOutcome> {
  // A trailing semicolon is how people write SQL; it is also the one thing
  // that would stop the statement from being wrapped in a cursor.
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (trimmed === '') {
    throw new AppError('query-failed', 'The query is empty.');
  }
  assertRunnable(trimmed);
  const started = process.hrtime.bigint();
  const elapsed = (): number =>
    Number(process.hrtime.bigint() - started) / 1_000_000;

  // A failed DECLARE aborts the surrounding transaction, so the attempt is
  // made inside a savepoint and rolled back to it before the fallback.
  let declared = false;
  await db.read('SAVEPOINT schema_declare');
  try {
    await db.read(`DECLARE ${CURSOR_NAME} NO SCROLL CURSOR FOR ${trimmed}`, [
      ...params,
    ]);
    declared = true;
  } catch (error) {
    await db.read('ROLLBACK TO SAVEPOINT schema_declare');
    if (!(error instanceof AppError) || error.code !== 'query-failed') {
      throw error;
    }
    // Not a cursor-able statement. Fall through to direct execution.
  }

  if (!declared) {
    const result = await db.readRaw(trimmed, params);
    return bound(result, limits, elapsed(), true);
  }

  try {
    const fields: Field[] = [];
    const rows: unknown[][] = [];
    let bytes = 0;
    let truncatedBy: QueryOutcome['truncatedBy'] = null;

    while (rows.length < limits.maxRows) {
      const want = Math.min(limits.batchSize, limits.maxRows - rows.length);
      const batch = await db.readRaw(
        `FETCH FORWARD ${want} FROM ${CURSOR_NAME}`,
      );
      if (fields.length === 0) fields.push(...batch.fields);
      if (batch.rows.length === 0) break;
      for (const row of batch.rows) {
        const size = rowSize(row);
        if (bytes + size > limits.maxBytes && rows.length > 0) {
          truncatedBy = 'bytes';
          break;
        }
        bytes += size;
        rows.push([...row]);
      }
      if (truncatedBy !== null) break;
      if (batch.rows.length < want) break;
    }

    if (truncatedBy === null && rows.length === limits.maxRows) {
      // One more row, fetched only to tell "exactly the limit" apart from
      // "cut off at the limit". It is counted, not kept.
      const probe = await db.readRaw(`FETCH FORWARD 1 FROM ${CURSOR_NAME}`);
      if (probe.rows.length > 0) truncatedBy = 'rows';
    }

    return {
      fields,
      rows,
      rowCount: rows.length,
      truncatedBy,
      durationMs: elapsed(),
      buffered: false,
      approximateBytes: bytes,
    };
  } finally {
    await db.read(`CLOSE ${CURSOR_NAME}`).catch(() => undefined);
  }
}

function bound(
  result: RowSet,
  limits: QueryLimits,
  durationMs: number,
  buffered: boolean,
): QueryOutcome {
  const rows: unknown[][] = [];
  let bytes = 0;
  let truncatedBy: QueryOutcome['truncatedBy'] = null;
  for (const row of result.rows) {
    if (rows.length >= limits.maxRows) {
      truncatedBy = 'rows';
      break;
    }
    const size = rowSize(row);
    if (bytes + size > limits.maxBytes && rows.length > 0) {
      truncatedBy = 'bytes';
      break;
    }
    bytes += size;
    rows.push([...row]);
  }
  return {
    fields: result.fields,
    rows,
    rowCount: rows.length,
    truncatedBy,
    durationMs,
    buffered,
    approximateBytes: bytes,
  };
}

/**
 * Read a bounded sample of one relation.
 *
 * The relation name is quoted, never parameterised, because an identifier
 * cannot be a parameter. `LIMIT` is a parameter.
 */
export async function sampleRelation(
  db: Database,
  qualified: string,
  limit: number,
  limits: QueryLimits,
): Promise<QueryOutcome> {
  return runQuery(db, `SELECT * FROM ${qualified} LIMIT $1`, [limit], limits);
}
