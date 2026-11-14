// CSV export, RFC 4180 with CRLF line endings.
//
// A SQL NULL is written as an empty unquoted field, which is how PostgreSQL's
// own `COPY ... TO ... CSV` writes it, so an empty string and a NULL are
// distinguishable: the first is quoted, the second is not.

import { formatValue } from './value.js';

const NEEDS_QUOTING = /[",\r\n]/;

export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = formatValue(value);
  if (!NEEDS_QUOTING.test(text) && text !== '') return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  const lines = [headers.map((header) => csvField(header)).join(',')];
  for (const row of rows) {
    lines.push(row.map((value) => csvField(value)).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
