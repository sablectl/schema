// What Schema is willing to send to the server.
//
// This is NOT the read-only boundary. PostgreSQL enforces that: the session
// and the transaction are both read only, so a write fails with error 25006
// whatever this file decides. What this file adds is a capability
// restriction — Schema is an explorer, so it offers the statements an
// explorer needs and refuses the rest.
//
// The restriction matters because some statements are read-only in the
// transactional sense and still unwelcome. `COPY ... TO '/path'` writes a
// file on the server, and `COPY ... FROM PROGRAM` runs a command there.
// Neither is a write to a table, so neither is stopped by a read-only
// transaction. They are stopped here.

import { AppError, usageError } from './errors.js';

/** Statements Schema will run. Everything else is refused. */
const ALLOWED = new Set([
  'select',
  'with',
  'table',
  'values',
  'explain',
  'show',
]);

/** Refused with an explanation of the read-only transaction. */
const WRITING = new Set([
  'insert',
  'update',
  'delete',
  'merge',
  'truncate',
  'create',
  'drop',
  'alter',
  'grant',
  'revoke',
  'comment',
  'refresh',
  'reindex',
  'cluster',
  'vacuum',
  'analyze',
  'import',
  'call',
  'do',
]);

/**
 * Remove comments, string literals, dollar-quoted bodies and quoted
 * identifiers, replacing each with a single space.
 *
 * Keyword and separator detection runs on the result, so a semicolon or the
 * word `copy` inside a literal cannot be mistaken for syntax.
 */
export function stripLiterals(sql: string): string {
  let out = '';
  let index = 0;
  while (index < sql.length) {
    const rest = sql.slice(index);
    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', index);
      index = end === -1 ? sql.length : end;
      out += ' ';
      continue;
    }
    if (rest.startsWith('/*')) {
      // Block comments nest in PostgreSQL.
      let depth = 1;
      let scan = index + 2;
      while (scan < sql.length && depth > 0) {
        if (sql.startsWith('/*', scan)) {
          depth += 1;
          scan += 2;
        } else if (sql.startsWith('*/', scan)) {
          depth -= 1;
          scan += 2;
        } else scan += 1;
      }
      index = scan;
      out += ' ';
      continue;
    }
    const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
    if (dollar !== null) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, index + tag.length);
      index = end === -1 ? sql.length : end + tag.length;
      out += ' ';
      continue;
    }
    const character = sql[index] ?? '';
    if (character === "'" || character === '"') {
      let scan = index + 1;
      while (scan < sql.length) {
        if (sql[scan] === character) {
          if (sql[scan + 1] === character) scan += 2;
          else {
            scan += 1;
            break;
          }
        } else scan += 1;
      }
      index = scan;
      out += ' ';
      continue;
    }
    out += character;
    index += 1;
  }
  return out;
}

/** The first word of the statement, lower-cased. */
export function leadingKeyword(sql: string): string {
  const stripped = stripLiterals(sql).trim();
  return (/^[A-Za-z]+/.exec(stripped)?.[0] ?? '').toLowerCase();
}

/** True when the text holds more than one statement. */
export function hasMultipleStatements(sql: string): boolean {
  const stripped = stripLiterals(sql);
  const semicolon = stripped.indexOf(';');
  if (semicolon === -1) return false;
  return stripped.slice(semicolon + 1).trim() !== '';
}

/**
 * Refuse anything Schema does not offer.
 *
 * Throws rather than returning a verdict: there is no caller that wants to
 * continue after a refusal.
 */
export function assertRunnable(sql: string): void {
  if (hasMultipleStatements(sql)) {
    throw usageError(
      'Give one statement at a time.',
      'Schema runs a single statement so that the result and the limits apply to one thing.',
    );
  }
  const keyword = leadingKeyword(sql);
  if (keyword === '') {
    throw usageError('The statement is empty.');
  }
  if (ALLOWED.has(keyword)) return;
  if (WRITING.has(keyword)) {
    throw new AppError(
      'read-only-violation',
      `Schema does not run ${keyword.toUpperCase()} statements.`,
      'It opens a read-only transaction and reads; use psql for anything that changes the database.',
    );
  }
  throw usageError(
    `Schema does not run ${keyword.toUpperCase()} statements.`,
    'Supported: SELECT, WITH, TABLE, VALUES, EXPLAIN and SHOW.',
  );
}
