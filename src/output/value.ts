// Rendering PostgreSQL values as text.
//
// The driver returns JavaScript values: `null` for SQL NULL, `Date` for
// timestamps, `Buffer` for `bytea`, parsed objects for `json` and `jsonb`,
// and strings for `numeric` so that precision is not lost. Each needs a
// representation that is unambiguous and stable enough to compare between
// runs.

/** How a SQL NULL is written. Distinct from the empty string. */
export const NULL_TEXT = 'NULL';

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * ISO 8601 in UTC.
 *
 * `timestamptz` arrives as a `Date`, which has no time zone of its own, so
 * printing it in the local zone would make the same row read differently on
 * two machines.
 */
function formatDate(value: Date): string {
  if (Number.isNaN(value.getTime())) return 'Invalid Date';
  return (
    `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1, 2)}` +
    `-${pad(value.getUTCDate(), 2)}T${pad(value.getUTCHours(), 2)}` +
    `:${pad(value.getUTCMinutes(), 2)}:${pad(value.getUTCSeconds(), 2)}` +
    `.${pad(value.getUTCMilliseconds(), 3)}Z`
  );
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return NULL_TEXT;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return formatDate(value);
  if (value instanceof Uint8Array) {
    return `\\x${Buffer.from(value).toString('hex')}`;
  }
  if (Array.isArray(value)) {
    return `{${value.map((item: unknown) => formatValue(item)).join(',')}}`;
  }
  // Composite types, ranges, json and jsonb arrive as objects. JSON is the
  // only faithful text form available; a value with a circular reference or
  // a throwing toJSON is reported as such rather than as [object Object].
  try {
    return JSON.stringify(value) ?? 'unprintable value';
  } catch {
    return 'unprintable value';
  }
}

/** The value as it should appear in a JSON report. */
export function jsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return formatDate(value);
  if (value instanceof Uint8Array) {
    return `\\x${Buffer.from(value).toString('hex')}`;
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

/**
 * Make a value safe to print to a terminal.
 *
 * Control characters in data must not be able to move the cursor, change
 * the colour or clear the screen. Tabs and newlines are shown as escapes so
 * one row stays on one line.
 *
 * Identifiers and cell values come from the database, so a column named
 * `\u001b[2K\r0 rows` could otherwise rewrite the line above it and fake a
 * harmless result. C1 controls and the bidirectional overrides are covered
 * too: the first are control codes in several encodings, the second reorder
 * text on screen and can disguise a name as another one.
 */
export function printable(text: string): string {
  let out = '';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (character === '\n') out += '\\n';
    else if (character === '\r') out += '\\r';
    else if (character === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f) {
      out += `\\x${code.toString(16).padStart(2, '0')}`;
    } else if (
      (code >= 0x80 && code <= 0x9f) ||
      (code >= 0x202a && code <= 0x202e)
    ) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else out += character;
  }
  return out;
}

export function truncate(text: string, limit: number): string {
  if (limit <= 0 || text.length <= limit) return text;
  if (limit <= 1) return '…';
  return `${text.slice(0, limit - 1)}…`;
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const;

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'not available';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rendered = unit === 0 ? String(value) : value.toFixed(1);
  return `${rendered} ${UNITS[unit] ?? 'B'}`;
}

export function formatCount(value: number | null): string {
  if (value === null) return 'unknown';
  return value.toLocaleString('en-GB');
}

export function formatMs(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
