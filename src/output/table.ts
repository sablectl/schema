// Aligned terminal tables.
//
// Width is measured in code points after escaping, which is right for the
// Latin alphabet and wrong for East Asian characters: a column containing
// them is a little narrower than it looks. Correcting that would need a
// width table, and the misalignment is cosmetic, so it is recorded as a
// known limitation rather than half-solved.

import type { Painter } from './colour.js';
import { printable, truncate } from './value.js';

export type Alignment = 'left' | 'right';

export interface Column {
  readonly header: string;
  readonly align?: Alignment;
}

export interface TableOptions {
  readonly maxCellChars: number;
  readonly painter: Painter;
  readonly indent?: string;
}

function width(text: string): number {
  // Code points, not UTF-16 units: an emoji or an accented letter outside
  // the basic plane must count once. Wide East Asian characters still count
  // as one, which is the known limitation described above.
  // eslint-disable-next-line @typescript-eslint/no-misused-spread
  return [...text].length;
}

function padTo(text: string, size: number, align: Alignment): string {
  const gap = Math.max(0, size - width(text));
  return align === 'right' ? ' '.repeat(gap) + text : text + ' '.repeat(gap);
}

/**
 * Render a table.
 *
 * Columns are separated by two spaces rather than drawn with rules: the
 * output stays usable with `cut`, `awk` and a terminal narrower than the
 * table.
 */
export function renderTable(
  columns: readonly Column[],
  rows: readonly (readonly string[])[],
  options: TableOptions,
): string {
  const indent = options.indent ?? '';
  // Headers can be database identifiers, so they are escaped exactly as
  // cells are, and before the widths are measured: alignment is computed
  // from the text that is actually printed.
  const headers = columns.map((column) =>
    truncate(printable(column.header), options.maxCellChars),
  );
  const cells = rows.map((row) =>
    columns.map((_, index) =>
      truncate(printable(row[index] ?? ''), options.maxCellChars),
    ),
  );
  const widths = columns.map((_column, index) => {
    let size = width(headers[index] ?? '');
    for (const row of cells) size = Math.max(size, width(row[index] ?? ''));
    return size;
  });

  const header = columns
    .map((column, index) =>
      padTo(headers[index] ?? '', widths[index] ?? 0, column.align ?? 'left'),
    )
    .join('  ')
    .trimEnd();
  const rule = widths.map((size) => '-'.repeat(size)).join('  ');

  const lines: string[] = [];
  lines.push(indent + options.painter(header, 'bold'));
  lines.push(indent + options.painter(rule, 'dim'));
  for (const row of cells) {
    lines.push(
      indent +
        columns
          .map((column, index) =>
            padTo(row[index] ?? '', widths[index] ?? 0, column.align ?? 'left'),
          )
          .join('  ')
          .trimEnd(),
    );
  }
  return lines.join('\n');
}

/** A `Key  value` block, used wherever a table would be overkill. */
export function renderFields(
  entries: readonly (readonly [string, string])[],
  painter: Painter,
  indent = '  ',
): string {
  const keyWidth = entries.reduce(
    (size, [key]) => Math.max(size, width(printable(key))),
    0,
  );
  return entries
    .map(
      ([key, value]) =>
        `${indent}${painter(padTo(printable(key), keyWidth, 'left'), 'dim')}  ${printable(value)}`,
    )
    .join('\n');
}
