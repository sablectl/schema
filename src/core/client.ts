// The database connection.
//
// One connection, one read-only transaction, for the lifetime of a command.
// Every statement Schema runs — catalogue queries included — runs inside that
// transaction, so read-only enforcement is a property of the session rather
// than something each call site has to remember.

import pg from 'pg';
import { AppError } from './errors.js';
import {
  readRootCert,
  type ConnectionTarget,
  describeTarget,
} from './connection.js';
import { redactText } from './redact.js';

const { Client } = pg;

export interface Field {
  readonly name: string;
  readonly dataTypeId: number;
}

export interface RowSet {
  readonly fields: readonly Field[];
  readonly rows: readonly (readonly unknown[])[];
}

interface PostgresError {
  readonly code?: string;
  readonly message?: string;
  readonly severity?: string;
  readonly detail?: string;
  readonly hint?: string;
}

function asPostgresError(error: unknown): PostgresError {
  if (error === null || typeof error !== 'object') return {};
  // Read each property by name rather than spreading: `message` is a
  // non-enumerable property of `Error`, so a spread silently loses it.
  const record = error as Record<string, unknown>;
  const code = record['code'];
  const message = record['message'];
  const detail = record['detail'];
  const hint = record['hint'];
  return {
    ...(typeof code === 'string' ? { code } : {}),
    ...(typeof message === 'string' ? { message } : {}),
    ...(typeof detail === 'string' ? { detail } : {}),
    ...(typeof hint === 'string' ? { hint } : {}),
  };
}

/**
 * Translate a driver or server error into the Schema error vocabulary.
 *
 * The server's own message is kept because it is usually the most useful
 * thing available, but it is passed through redaction first: a connection
 * error can quote the connection string back.
 */
export function translateError(error: unknown, where: string): AppError {
  const { code, message, hint } = asPostgresError(error);
  const text = redactText(message ?? 'The database reported an error.');
  switch (code) {
    case '28P01':
    case '28000':
      return new AppError(
        'authentication-failed',
        text,
        'Check the user name and password.',
      );
    case '3D000':
      return new AppError('not-found', text, 'Check the database name.');
    case '42P01':
    case '42703':
      return new AppError('not-found', text);
    case '42501':
      return new AppError(
        'permission-denied',
        text,
        'The connected role is not allowed to read this object.',
      );
    case '25006':
      return new AppError(
        'read-only-violation',
        text,
        'Schema runs every statement in a read-only transaction.',
      );
    case '57014':
      return new AppError(
        'timeout',
        'The statement was cancelled before it finished.',
        'Raise --statement-timeout, or narrow the query.',
      );
    case '53300':
      return new AppError('connection-failed', text);
    default:
      break;
  }
  const errno =
    error !== null && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
  if (errno === 'ECONNREFUSED' || errno === 'EHOSTUNREACH') {
    return new AppError(
      'connection-failed',
      `${where} refused the connection.`,
      'Check the host and port, and that the server is accepting connections.',
    );
  }
  if (errno === 'ENOTFOUND' || errno === 'EAI_AGAIN') {
    return new AppError(
      'connection-failed',
      `The host in ${where} could not be resolved.`,
    );
  }
  if (errno === 'ETIMEDOUT' || /timeout/i.test(text)) {
    return new AppError('timeout', `${where} did not answer in time.`);
  }
  if (/certificate|self[- ]signed|SSL|TLS/i.test(text)) {
    return new AppError(
      'tls-failure',
      text,
      'Pass --ssl-root-cert with the certificate authority, or use --ssl-mode require if the server certificate cannot be verified.',
    );
  }
  return new AppError(
    'query-failed',
    text,
    hint === undefined ? undefined : redactText(hint),
  );
}

function sslOptionsFor(
  target: ConnectionTarget,
  ca: string | undefined,
): pg.ClientConfig['ssl'] {
  switch (target.sslMode) {
    case 'disable':
      return false;
    case 'require':
    case 'prefer':
      // libpq's semantics: encrypted, but the certificate is not checked.
      // Documented as such; it protects against passive observation only.
      return { rejectUnauthorized: false };
    case 'verify-ca':
      return {
        rejectUnauthorized: true,
        ...(ca === undefined ? {} : { ca }),
        checkServerIdentity: (): undefined => undefined,
      };
    case 'verify-full':
      return { rejectUnauthorized: true, ...(ca === undefined ? {} : { ca }) };
  }
}

export interface ConnectionInfo {
  readonly serverVersion: string;
  readonly serverVersionNum: number;
  readonly backendPid: number;
  readonly currentDatabase: string;
  readonly currentUser: string;
  readonly sessionUser: string;
  /** `null` when the connection is not encrypted. */
  readonly tls: { version: string; cipher: string } | null;
  readonly sslModeUsed: string;
}

export class Database {
  private readonly client: pg.Client;
  private readonly target: ConnectionTarget;
  private cancelled = false;
  readonly info: ConnectionInfo;

  private constructor(
    client: pg.Client,
    target: ConnectionTarget,
    info: ConnectionInfo,
  ) {
    this.client = client;
    this.target = target;
    this.info = info;
  }

  static async connect(target: ConnectionTarget): Promise<Database> {
    const ca = await readRootCert(target);
    const attempt = async (mode: ConnectionTarget): Promise<pg.Client> => {
      const client = new Client({
        host: mode.host,
        port: mode.port,
        database: mode.database,
        user: mode.user,
        ...(mode.password === undefined ? {} : { password: mode.password }),
        ssl: sslOptionsFor(mode, ca),
        application_name: mode.applicationName,
        connectionTimeoutMillis: mode.connectTimeoutMs,
        // The driver would otherwise keep a failed connection's error
        // handler attached and report it as an unhandled rejection.
        keepAlive: false,
      });
      await client.connect();
      return client;
    };

    let client: pg.Client;
    let sslModeUsed = target.sslMode;
    try {
      client = await attempt(target);
    } catch (error) {
      if (target.sslMode !== 'prefer') {
        throw translateError(error, describeTarget(target));
      }
      // `prefer` means encrypt when the server allows it. A server built
      // without TLS refuses the handshake, so fall back once, exactly as
      // libpq does, and report which of the two was used.
      try {
        client = await attempt({ ...target, sslMode: 'disable' });
        sslModeUsed = 'disable';
      } catch (fallbackError) {
        // The second error is the useful one. The first says only that the
        // server declined TLS, which is why the fallback happened at all,
        // and reporting it would hide the real cause — a missing database
        // or a rejected password — behind a certificate hint.
        throw translateError(fallbackError, describeTarget(target));
      }
    }

    // Everything after the handshake — cancellation included — must use the
    // mode that actually connected, not the one that was asked for.
    const effective: ConnectionTarget = { ...target, sslMode: sslModeUsed };
    try {
      const info = await Database.begin(client, target, sslModeUsed);
      return new Database(client, effective, info);
    } catch (error) {
      await client.end().catch(() => undefined);
      throw error instanceof AppError
        ? error
        : translateError(error, describeTarget(target));
    }
  }

  /**
   * Put the session into read-only mode and open the transaction.
   *
   * Three layers, deliberately: the session default, the transaction itself
   * and the statement timeout. The first two are each sufficient to make a
   * write fail; having both means a lost `BEGIN` cannot quietly re-enable
   * writing.
   */
  private static async begin(
    client: pg.Client,
    target: ConnectionTarget,
    sslModeUsed: string,
  ): Promise<ConnectionInfo> {
    await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query(
      `SET LOCAL statement_timeout = ${target.statementTimeoutMs}`,
    );
    await client.query(
      `SET LOCAL lock_timeout = ${Math.max(1000, Math.floor(target.statementTimeoutMs / 2))}`,
    );
    await client.query(
      `SET LOCAL idle_in_transaction_session_timeout = ${Math.max(5000, target.statementTimeoutMs)}`,
    );

    const result = await client.query<{
      version: string;
      version_num: string;
      pid: number;
      db: string;
      role_name: string;
      login_role: string;
    }>(
      `SELECT current_setting('server_version') AS version,
              current_setting('server_version_num') AS version_num,
              pg_backend_pid() AS pid,
              current_database() AS db,
              current_user AS role_name,
              session_user AS login_role`,
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new AppError('connection-failed', 'The server returned no reply.');
    }

    const socket: unknown = (
      client as unknown as { connection?: { stream?: unknown } }
    ).connection?.stream;
    let tls: ConnectionInfo['tls'] = null;
    if (
      socket !== null &&
      typeof socket === 'object' &&
      'getCipher' in socket &&
      typeof socket.getCipher === 'function'
    ) {
      const cipher = (
        socket as {
          getCipher: () => { name?: string; version?: string } | null;
        }
      ).getCipher();
      if (cipher !== null) {
        tls = {
          version: cipher.version ?? 'unknown',
          cipher: cipher.name ?? 'unknown',
        };
      }
    }

    return {
      serverVersion: row.version,
      serverVersionNum: Number(row.version_num),
      backendPid: row.pid,
      currentDatabase: row.db,
      currentUser: row.role_name,
      sessionUser: row.login_role,
      tls,
      sslModeUsed,
    };
  }

  /** Run a statement inside the read-only transaction. */
  async read<T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    try {
      const result = await this.client.query<T>(sql, [...params]);
      return result.rows;
    } catch (error) {
      throw this.decorate(error);
    }
  }

  /** Run a statement and keep the column metadata with the values. */
  async readRaw(sql: string, params: readonly unknown[] = []): Promise<RowSet> {
    try {
      const result = await this.client.query({
        text: sql,
        values: [...params],
        rowMode: 'array',
      });
      const rows: readonly unknown[][] = Array.isArray(result.rows)
        ? (result.rows as unknown[][])
        : [];
      return {
        fields: result.fields.map((field) => ({
          name: field.name,
          dataTypeId: field.dataTypeID,
        })),
        rows,
      };
    } catch (error) {
      throw this.decorate(error);
    }
  }

  private decorate(error: unknown): AppError {
    const translated = translateError(error, describeTarget(this.target));
    if (this.cancelled && translated.code === 'timeout') {
      return new AppError('cancelled', 'Interrupted.');
    }
    return translated;
  }

  /**
   * Ask the server to cancel whatever this connection is running.
   *
   * A cancellation request travels on its own connection, which is why this
   * opens a second one rather than writing to the busy socket.
   */
  async cancel(): Promise<void> {
    this.cancelled = true;
    const ca = await readRootCert(this.target).catch(() => undefined);
    const canceller = new Client({
      host: this.target.host,
      port: this.target.port,
      database: this.target.database,
      user: this.target.user,
      ...(this.target.password === undefined
        ? {}
        : { password: this.target.password }),
      ssl: sslOptionsFor(this.target, ca),
      application_name: `${this.target.applicationName} (cancel)`,
      connectionTimeoutMillis: 5000,
    });
    try {
      await canceller.connect();
      await canceller.query('SELECT pg_cancel_backend($1)', [
        this.info.backendPid,
      ]);
    } catch {
      // A cancellation that cannot be delivered is not worth a second
      // error on top of the interruption the user already caused.
    } finally {
      await canceller.end().catch(() => undefined);
    }
  }

  /** Commit the (read-only) transaction and close the socket. */
  async close(): Promise<void> {
    try {
      await this.client.query('COMMIT');
    } catch {
      // Nothing was written, so a failed commit changes nothing.
    }
    await this.client.end().catch(() => undefined);
  }
}
