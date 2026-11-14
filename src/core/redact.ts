// Credential redaction.
//
// Redaction is applied on the way out of the core, so a value that never
// reaches an output or an error message is never at risk. The placeholder is
// a constant so output remains byte-identical whatever the secret was.

export const REDACTED = '[redacted]';

/**
 * Environment variable names whose values are treated as secret.
 *
 * `PGPASSWORD` is the one PostgreSQL defines; the others appear in
 * deployment conventions often enough to be worth covering when the
 * environment is reported.
 */
const SECRET_ENV_PATTERN =
  /(password|passwd|secret|token|api[_-]?key|private[_-]?key|credential)/i;

export function isSecretEnvName(name: string): boolean {
  return SECRET_ENV_PATTERN.test(name) || name === 'PGPASSFILE';
}

/**
 * Remove the password from a PostgreSQL connection string.
 *
 * The string is not assumed to parse: a malformed value is still redacted by
 * the fallback pattern, because a value that cannot be parsed is exactly the
 * value most likely to be printed in an error.
 */
export function redactConnectionString(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.password !== '') url.password = REDACTED;
    const text = url.toString();
    // `URL` percent-encodes the brackets of the placeholder.
    return text.replace('%5Bredacted%5D', REDACTED);
  } catch {
    // Not URL-shaped. It may still be a keyword/value connection string
    // (`host=db user=a password=secret`), which `redactText` covers, so the
    // fallback goes through both patterns rather than only the URL one.
    return redactText(
      raw.replace(
        /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:/?#@]*):[^@/]*@/,
        `$1:${REDACTED}@`,
      ),
    );
  }
}

/**
 * Best-effort redaction of secrets in free text.
 *
 * Used for messages produced by the PostgreSQL driver, which can quote a
 * connection string back at the caller. It is a safety net, not a guarantee:
 * a password that looks like nothing in particular cannot be recognised.
 */
export function redactText(text: string): string {
  return (
    text
      // `\b` would be wrong here: there is no word boundary inside
      // `PGPASSWORD`, which is precisely the spelling libpq quotes back in an
      // error message. The alternative start-of-string or non-word-character
      // anchor matches the bare word and the prefixed one alike.
      .replace(
        /(^|[^A-Za-z])((?:[A-Za-z_]*)(?:password|passwd|pwd))\s*=\s*('(?:[^']|'')*'|"(?:[^"]|"")*"|[^\s;]+)/gi,
        `$1$2=${REDACTED}`,
      )
      .replace(
        /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:/?#@\s]*):[^@/\s]*@/g,
        `$1:${REDACTED}@`,
      )
  );
}
