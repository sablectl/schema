// PostgreSQL identifier handling.
//
// Identifiers cannot be supplied as query parameters, so anywhere one has to
// appear in SQL text it is quoted here first. Everything else — every value a
// user supplies — is passed as a parameter and never reaches this file.

import { usageError } from './errors.js';

/**
 * Quote an identifier for inclusion in SQL text.
 *
 * Always quotes, never conditionally: an unquoted identifier is folded to
 * lower case by the server, so `"MyTable"` and `MyTable` are different
 * objects and guessing between them silently reads the wrong one. An embedded
 * double quote is doubled, which is the only escape the syntax has. A NUL
 * byte cannot be represented in an identifier at all and is refused.
 */
export function quoteIdentifier(name: string): string {
  if (name.includes('\0')) {
    throw usageError('An identifier may not contain a NUL byte.');
  }
  return `"${name.replaceAll('"', '""')}"`;
}

export interface QualifiedName {
  /** `undefined` when the argument named no schema. */
  readonly schema: string | undefined;
  readonly name: string;
}

/**
 * Split a possibly schema-qualified, possibly quoted name.
 *
 * Accepts `table`, `public.table`, `"My Schema"."My Table"` and the mixed
 * forms. An unquoted part is lower-cased to match the server's own folding,
 * so `schema describe Users` finds `users` exactly as `psql` would. A quoted
 * part is taken literally.
 */
export function parseQualifiedName(raw: string): QualifiedName {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let sawQuotes = false;
  let index = 0;

  const push = (): void => {
    parts.push(sawQuotes ? current : current.toLowerCase());
    current = '';
    sawQuotes = false;
  };

  while (index < raw.length) {
    const character = raw[index] ?? '';
    if (quoted) {
      if (character === '"') {
        if (raw[index + 1] === '"') {
          current += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      current += character;
      index += 1;
      continue;
    }
    if (character === '"') {
      quoted = true;
      sawQuotes = true;
      index += 1;
      continue;
    }
    if (character === '.') {
      push();
      index += 1;
      continue;
    }
    current += character;
    index += 1;
  }

  if (quoted) {
    throw usageError(
      `"${raw}" has an unterminated quoted identifier.`,
      'Double quotes in a name must be paired.',
    );
  }
  push();

  if (parts.length > 2) {
    throw usageError(
      `"${raw}" has too many parts.`,
      'Write a name as table or schema.table.',
    );
  }
  const [first, second] = parts;
  const name = second ?? first ?? '';
  const schema = second === undefined ? undefined : first;
  if (name === '') {
    throw usageError(`"${raw}" is not a table name.`);
  }
  if (schema !== undefined && schema === '') {
    throw usageError(`"${raw}" has an empty schema name.`);
  }
  return { schema, name };
}

/** Render a qualified name the way PostgreSQL would print it. */
export function formatQualifiedName(schema: string, name: string): string {
  return `${maybeQuote(schema)}.${maybeQuote(name)}`;
}

/**
 * Quote only when the identifier needs it.
 *
 * Used for display, never for SQL text. A name that is already lower case,
 * free of punctuation and not a leading digit reads better unquoted.
 */
export function maybeQuote(name: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(name) ? name : quoteIdentifier(name);
}
