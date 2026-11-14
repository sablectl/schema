// Resolving where to connect.
//
// Three sources, in order of precedence: explicit command-line options, a
// connection string, then the standard PostgreSQL environment variables. The
// password is deliberately not a command-line option: an argument is visible
// in `ps` output and in shell history, so it is read from `PGPASSWORD`, from
// a connection string, or from the variable named by `--password-env`.

import { readFile } from 'node:fs/promises';
import { AppError, usageError } from './errors.js';
import { isSslMode, type SslMode } from './config.js';
import { REDACTED } from './redact.js';

export interface ConnectionTarget {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string | undefined;
  readonly sslMode: SslMode;
  /** PEM certificate authority bundle for verify-ca and verify-full. */
  readonly sslRootCert: string | undefined;
  readonly applicationName: string;
  readonly connectTimeoutMs: number;
  readonly statementTimeoutMs: number;
}

export interface ConnectionOverrides {
  readonly url?: string | undefined;
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly database?: string | undefined;
  readonly user?: string | undefined;
  readonly passwordEnv?: string | undefined;
  readonly sslMode?: SslMode | undefined;
  readonly sslRootCert?: string | undefined;
  readonly connectTimeoutMs?: number | undefined;
  readonly statementTimeoutMs?: number | undefined;
}

const DEFAULT_PORT = 5432;
const DEFAULT_HOST = 'localhost';
/**
 * Fallbacks for a library caller who supplies no timeouts. The command line
 * always passes its settings, but an undefined value reaching
 * `SET LOCAL statement_timeout` produces a syntax error reported as a
 * connection problem, which is a confusing way to learn of a missing field.
 */
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;

function first(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

function parsePort(raw: string, where: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new AppError(
      'invalid-connection',
      `${where} is not a valid port number.`,
    );
  }
  return port;
}

interface UrlParts {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  sslMode?: SslMode;
  applicationName?: string;
}

/**
 * Parse a `postgres://` or `postgresql://` connection string.
 *
 * Only the parts Schema acts on are read. An unrecognised query parameter is
 * refused rather than ignored, because a silently dropped `sslmode` is a
 * security difference the user believes they asked for.
 */
export function parseConnectionUrl(raw: string): UrlParts {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(
      'invalid-connection',
      'The connection string could not be parsed.',
      'Write it as postgresql://user@host:5432/database.',
    );
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new AppError(
      'invalid-connection',
      `"${url.protocol.replace(':', '')}" is not a PostgreSQL connection scheme.`,
      'Use postgresql:// or postgres://.',
    );
  }

  const parts: UrlParts = {};
  const host = decodeURIComponent(url.hostname).replace(/^\[|\]$/g, '');
  if (host !== '') parts.host = host;
  if (url.port !== '') {
    parts.port = parsePort(url.port, `"${url.port}"`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (database !== '') parts.database = database;
  if (url.username !== '') parts.user = decodeURIComponent(url.username);
  if (url.password !== '') parts.password = decodeURIComponent(url.password);

  for (const [key, value] of url.searchParams) {
    switch (key) {
      case 'sslmode': {
        if (!isSslMode(value)) {
          throw new AppError(
            'invalid-connection',
            `"${value}" is not a supported sslmode.`,
          );
        }
        parts.sslMode = value;
        break;
      }
      case 'application_name': {
        parts.applicationName = value;
        break;
      }
      case 'dbname': {
        parts.database = value;
        break;
      }
      case 'host': {
        parts.host = value;
        break;
      }
      case 'port': {
        parts.port = parsePort(value, `"${value}"`);
        break;
      }
      case 'user': {
        parts.user = value;
        break;
      }
      default:
        throw new AppError(
          'invalid-connection',
          `"${key}" is not a connection parameter Schema understands.`,
          'Supported parameters: sslmode, application_name, dbname, host, port, user.',
        );
    }
  }
  return parts;
}

/**
 * Combine options, connection string and environment into one target.
 *
 * `env` is passed in rather than read from `process.env` so the resolution
 * rules can be tested without mutating the process.
 */
export function resolveTarget(
  overrides: ConnectionOverrides,
  env: NodeJS.ProcessEnv,
): ConnectionTarget {
  const rawUrl = first(overrides.url, env['SCHEMA_URL'], env['DATABASE_URL']);
  const url = rawUrl === undefined ? {} : parseConnectionUrl(rawUrl);

  let password: string | undefined;
  if (overrides.passwordEnv !== undefined && overrides.passwordEnv !== '') {
    const value = env[overrides.passwordEnv];
    if (value === undefined || value === '') {
      throw usageError(
        `The environment variable ${overrides.passwordEnv} is not set.`,
        'Set it to the password, or omit --password-env.',
      );
    }
    password = value;
  } else {
    password = first(url.password, env['PGPASSWORD']);
  }

  const host =
    first(overrides.host, url.host, env['PGHOST'], DEFAULT_HOST) ??
    DEFAULT_HOST;
  const portText = env['PGPORT'];
  const port =
    overrides.port ??
    url.port ??
    (portText === undefined || portText === ''
      ? DEFAULT_PORT
      : parsePort(portText, 'PGPORT'));
  const user = first(overrides.user, url.user, env['PGUSER'], env['USER']);
  if (user === undefined) {
    throw usageError(
      'No database user was given.',
      'Pass --user, set PGUSER, or include it in the connection string.',
    );
  }
  const database = first(
    overrides.database,
    url.database,
    env['PGDATABASE'],
    user,
  );

  const envSslMode = env['PGSSLMODE'];
  if (
    envSslMode !== undefined &&
    envSslMode !== '' &&
    !isSslMode(envSslMode) &&
    overrides.sslMode === undefined &&
    url.sslMode === undefined
  ) {
    throw new AppError(
      'invalid-connection',
      `PGSSLMODE is set to "${envSslMode}", which Schema does not support.`,
    );
  }
  const sslMode =
    overrides.sslMode ??
    url.sslMode ??
    (envSslMode !== undefined && isSslMode(envSslMode)
      ? envSslMode
      : undefined);

  return {
    host,
    port,
    database: database ?? user,
    user,
    password,
    sslMode: sslMode ?? 'prefer',
    sslRootCert: first(overrides.sslRootCert, env['PGSSLROOTCERT']),
    applicationName: url.applicationName ?? 'schema',
    connectTimeoutMs: overrides.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    statementTimeoutMs:
      overrides.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
  };
}

/** A one-line description of the target with no credential in it. */
export function describeTarget(target: ConnectionTarget): string {
  const host = target.host.startsWith('/')
    ? target.host
    : `${target.host}:${target.port}`;
  return `${target.user}@${host}/${target.database}`;
}

/**
 * The connection string form, with the password replaced.
 *
 * Built from the resolved target rather than from the string the user gave,
 * so there is no path by which the original password can survive into the
 * output. The placeholder is written whenever a password is in use at all,
 * which also makes it visible that one was found. The SSL mode is left out:
 * what was asked for and what was negotiated can differ, and the report
 * states both on a line of its own.
 */
export function redactedUrl(target: ConnectionTarget): string {
  const user = encodeURIComponent(target.user);
  const credential =
    target.password === undefined ? user : `${user}:${REDACTED}`;
  const host = target.host.includes(':') ? `[${target.host}]` : target.host;
  const database = encodeURIComponent(target.database);
  return `postgresql://${credential}@${host}:${target.port}/${database}`;
}

/** Read the certificate authority bundle, if one was configured. */
export async function readRootCert(
  target: ConnectionTarget,
): Promise<string | undefined> {
  if (target.sslRootCert === undefined) return undefined;
  try {
    return await readFile(target.sslRootCert, 'utf8');
  } catch {
    throw new AppError(
      'tls-failure',
      `The certificate authority file ${target.sslRootCert} could not be read.`,
    );
  }
}
