// Human-readable reports.
//
// Every fact reported in colour is also stated in words, so monochrome
// output loses nothing. Where a value is unavailable the report says why —
// "not analysed", "not permitted" — rather than printing a zero that reads
// like a measurement.

import type { Painter } from './colour.js';
import { renderFields, renderTable } from './table.js';
import {
  formatBytes,
  formatCount,
  formatMs,
  formatValue,
  printable,
  truncate,
} from './value.js';
import type {
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
import { maybeQuote } from '../core/identifiers.js';

export interface FormatOptions {
  readonly painter: Painter;
  readonly maxCellChars: number;
}

// Headings and qualified names carry database identifiers, which are no
// more trustworthy than cell values. They are escaped here, before the
// painter adds colour, so the escaping cannot touch our own codes. Table
// cells and headers are escaped inside the table renderer instead.
function heading(title: string, painter: Painter): string {
  return painter(printable(title), 'bold');
}

function qualify(schema: string, name: string): string {
  return printable(`${maybeQuote(schema)}.${maybeQuote(name)}`);
}

function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

export function formatConnection(
  target: ConnectionTarget,
  info: ConnectionInfo,
  options: FormatOptions,
): string {
  const { painter } = options;
  const entries: (readonly [string, string])[] = [
    ['Server', `PostgreSQL ${info.serverVersion}`],
    ['Connection', redactedUrl(target)],
    ['Database', info.currentDatabase],
    ['Role', info.currentUser],
  ];
  if (info.sessionUser !== info.currentUser) {
    entries.push(['Login role', info.sessionUser]);
  }
  // The mode asked for and the mode used can differ: `prefer` falls back to
  // an unencrypted connection when the server has no TLS. Say both, so a
  // connection that is not encrypted cannot be mistaken for one that is.
  const requested = `requested ${target.sslMode}`;
  entries.push([
    'Encryption',
    info.tls === null
      ? `none (${requested})`
      : `${info.tls.version}, ${info.tls.cipher} (${requested})`,
  ]);
  entries.push(['Transaction', 'read only']);
  entries.push(['Backend', String(info.backendPid)]);
  return `${heading('Connection', painter)}\n${renderFields(entries, painter)}\n`;
}

export function formatDatabases(
  rows: readonly DatabaseSummary[],
  options: FormatOptions,
): string {
  if (rows.length === 0) return 'No databases are visible to this role.\n';
  const table = renderTable(
    [
      { header: 'Name' },
      { header: 'Owner' },
      { header: 'Encoding' },
      { header: 'Size', align: 'right' },
      { header: 'Notes' },
    ],
    rows.map((row) => [
      row.name,
      row.owner,
      row.encoding,
      row.sizeBytes === null ? 'not permitted' : formatBytes(row.sizeBytes),
      [row.isCurrent ? 'current' : '', row.connectable ? '' : 'no connections']
        .filter((note) => note !== '')
        .join(', '),
    ]),
    { maxCellChars: options.maxCellChars, painter: options.painter },
  );
  return `${table}\n\n${plural(rows.length, 'database', 'databases')}.\n`;
}

export function formatSchemas(
  rows: readonly SchemaSummary[],
  options: FormatOptions,
): string {
  if (rows.length === 0) return 'No schemas are visible to this role.\n';
  const table = renderTable(
    [
      { header: 'Name' },
      { header: 'Owner' },
      { header: 'Tables', align: 'right' },
      { header: 'Views', align: 'right' },
      { header: 'Mat. views', align: 'right' },
      { header: 'Comment' },
    ],
    rows.map((row) => [
      row.name,
      row.owner,
      formatCount(row.tables),
      formatCount(row.views),
      formatCount(row.materialisedViews),
      row.comment ?? '',
    ]),
    { maxCellChars: options.maxCellChars, painter: options.painter },
  );
  return `${table}\n\n${plural(rows.length, 'schema', 'schemas')}.\n`;
}

export function formatRelations(
  rows: readonly RelationSummary[],
  options: FormatOptions,
): string {
  if (rows.length === 0) {
    return 'No tables or views match.\n';
  }
  const table = renderTable(
    [
      { header: 'Schema' },
      { header: 'Name' },
      { header: 'Kind' },
      { header: 'Rows (est.)', align: 'right' },
      { header: 'Size', align: 'right' },
      { header: 'Comment' },
    ],
    rows.map((row) => [
      row.schema,
      row.name,
      row.kind,
      row.estimatedRows === null
        ? 'not analysed'
        : formatCount(row.estimatedRows),
      row.sizeBytes === null ? '-' : formatBytes(row.sizeBytes),
      row.comment ?? '',
    ]),
    { maxCellChars: options.maxCellChars, painter: options.painter },
  );
  return (
    `${table}\n\n${plural(rows.length, 'relation', 'relations')}. ` +
    'Row counts are planner estimates from the last ANALYZE.\n'
  );
}

export function formatSequences(
  rows: readonly SequenceInfo[],
  options: FormatOptions,
): string {
  if (rows.length === 0) return 'No sequences are visible to this role.\n';
  const table = renderTable(
    [
      { header: 'Schema' },
      { header: 'Name' },
      { header: 'Type' },
      { header: 'Start', align: 'right' },
      { header: 'Increment', align: 'right' },
      { header: 'Cycles' },
      { header: 'Owned by' },
    ],
    rows.map((row) => [
      row.schema,
      row.name,
      row.dataType,
      row.startValue ?? '',
      row.increment ?? '',
      row.cycles ? 'yes' : 'no',
      row.ownedBy ?? '',
    ]),
    { maxCellChars: options.maxCellChars, painter: options.painter },
  );
  return `${table}\n\n${plural(rows.length, 'sequence', 'sequences')}.\n`;
}

function columnFlags(
  column: TableDetail['columns'][number],
  primaryKey: ReadonlySet<string>,
): string {
  const flags: string[] = [];
  if (primaryKey.has(column.name)) flags.push('PK');
  if (!column.nullable) flags.push('not null');
  if (column.identity !== null) {
    flags.push(column.identity === 'a' ? 'identity always' : 'identity');
  }
  if (column.generated !== null) flags.push('generated');
  if (column.collation !== null) flags.push(`collate ${column.collation}`);
  return flags.join(', ');
}

export function formatTable(
  detail: TableDetail,
  exactRows: number | null,
  options: FormatOptions,
): string {
  const { painter } = options;
  const { relation } = detail;
  const primaryKey = new Set(
    detail.constraints
      .filter((constraint) => constraint.type === 'primary key')
      .flatMap((constraint) => [...constraint.columns]),
  );

  const parts: string[] = [];
  parts.push(heading(qualify(relation.schema, relation.name), painter));

  const overview: (readonly [string, string])[] = [
    ['Kind', relation.kind],
    ['Owner', relation.owner],
    [
      'Rows',
      exactRows !== null
        ? `${formatCount(exactRows)} (exact)`
        : relation.estimatedRows === null
          ? 'not analysed'
          : `${formatCount(relation.estimatedRows)} (estimated)`,
    ],
    [
      'Size',
      relation.sizeBytes === null
        ? 'not available'
        : formatBytes(relation.sizeBytes),
    ],
  ];
  if (detail.partitionOf !== null) {
    overview.push(['Partition of', detail.partitionOf]);
  }
  if (relation.comment !== null) overview.push(['Comment', relation.comment]);
  parts.push(renderFields(overview, painter));
  parts.push('');

  parts.push(heading('Columns', painter));
  parts.push(
    renderTable(
      [
        { header: '#', align: 'right' },
        { header: 'Name' },
        { header: 'Type' },
        { header: 'Attributes' },
        { header: 'Default' },
        { header: 'Comment' },
      ],
      detail.columns.map((column) => [
        String(column.position),
        column.name,
        column.type,
        columnFlags(column, primaryKey),
        column.defaultValue ?? '',
        column.comment ?? '',
      ]),
      {
        maxCellChars: options.maxCellChars,
        painter,
        indent: '  ',
      },
    ),
  );

  const constraints = detail.constraints;
  if (constraints.length > 0) {
    parts.push('');
    parts.push(heading('Constraints', painter));
    parts.push(
      renderTable(
        [{ header: 'Name' }, { header: 'Type' }, { header: 'Definition' }],
        constraints.map((constraint) => [
          constraint.name,
          constraint.type,
          constraint.definition,
        ]),
        { maxCellChars: options.maxCellChars, painter, indent: '  ' },
      ),
    );
  }

  if (detail.indexes.length > 0) {
    parts.push('');
    parts.push(heading('Indexes', painter));
    parts.push(formatIndexTable(detail.indexes, options));
  }

  if (detail.referencedBy.length > 0) {
    parts.push('');
    parts.push(heading('Referenced by', painter));
    parts.push(
      renderTable(
        [{ header: 'Constraint' }, { header: 'From' }, { header: 'Columns' }],
        detail.referencedBy.map((key) => [
          key.name,
          qualify(key.schema, key.table),
          key.columns.join(', '),
        ]),
        { maxCellChars: options.maxCellChars, painter, indent: '  ' },
      ),
    );
  }

  return `${parts.join('\n')}\n`;
}

function formatIndexTable(
  indexes: readonly IndexInfo[],
  options: FormatOptions,
): string {
  return renderTable(
    [
      { header: 'Name' },
      { header: 'Method' },
      { header: 'Unique' },
      { header: 'Size', align: 'right' },
      { header: 'Definition' },
    ],
    indexes.map((index) => [
      index.name,
      index.method,
      index.isPrimary ? 'primary key' : index.isUnique ? 'yes' : 'no',
      index.sizeBytes === null ? '-' : formatBytes(index.sizeBytes),
      index.isValid ? index.definition : `${index.definition}  [INVALID]`,
    ]),
    {
      maxCellChars: options.maxCellChars,
      painter: options.painter,
      indent: '  ',
    },
  );
}

export function formatIndexes(
  indexes: readonly IndexInfo[],
  title: string,
  options: FormatOptions,
): string {
  if (indexes.length === 0) return 'No indexes are defined.\n';
  return (
    `${heading(title, options.painter)}\n` +
    `${formatIndexTable(indexes, options)}\n\n` +
    `${plural(indexes.length, 'index', 'indexes')}.\n`
  );
}

export function formatForeignKeys(
  keys: readonly ForeignKeyInfo[],
  options: FormatOptions,
): string {
  if (keys.length === 0) {
    return 'No foreign keys are declared here.\n';
  }
  const table = renderTable(
    [
      { header: 'Constraint' },
      { header: 'From' },
      { header: 'Columns' },
      { header: 'References' },
      { header: 'Columns' },
      { header: 'On update' },
      { header: 'On delete' },
    ],
    keys.map((key) => [
      key.name,
      qualify(key.schema, key.table),
      key.columns.join(', '),
      qualify(key.referencedSchema, key.referencedTable),
      key.referencedColumns.join(', '),
      key.onUpdate,
      key.onDelete,
    ]),
    { maxCellChars: options.maxCellChars, painter: options.painter },
  );
  const composite = keys.filter((key) => key.columns.length > 1).length;
  const note =
    composite === 0
      ? ''
      : ` ${plural(composite, 'is composite', 'are composite')}.`;
  return `${table}\n\n${plural(keys.length, 'relationship', 'relationships')}.${note}\n`;
}

export function formatQuery(
  outcome: QueryOutcome,
  options: FormatOptions,
): string {
  const { painter } = options;
  if (outcome.fields.length === 0) {
    return `${painter('No columns were returned.', 'dim')}\n`;
  }
  const table = renderTable(
    outcome.fields.map((field) => ({ header: field.name })),
    outcome.rows.map((row) => row.map((value) => formatValue(value))),
    { maxCellChars: options.maxCellChars, painter },
  );
  const lines = [table, ''];
  const summary = `${plural(outcome.rowCount, 'row', 'rows')} in ${formatMs(outcome.durationMs)}.`;
  lines.push(summary);
  if (outcome.truncatedBy === 'rows') {
    lines.push('More rows were available; raise --limit to read further.');
  } else if (outcome.truncatedBy === 'bytes') {
    lines.push('The result reached the output size limit and was cut short.');
  }
  return `${lines.join('\n')}\n`;
}

export function formatDiagnostics(
  diagnostics: Diagnostics,
  options: FormatOptions,
): string {
  const { painter } = options;
  const parts: string[] = [];

  parts.push(heading('Server', painter));
  parts.push(
    renderFields(
      [
        ['Version', diagnostics.serverVersion],
        ['Database', diagnostics.database],
        ['Role', diagnostics.currentRole],
        ['Superuser', diagnostics.isSuperuser ? 'yes' : 'no'],
        ['Encoding', diagnostics.encoding],
        ['Time zone', diagnostics.timeZone],
        ['Search path', diagnostics.searchPath],
        [
          'Transaction',
          diagnostics.transactionReadOnly ? 'read only' : 'read write',
        ],
        ['Statement timeout', diagnostics.statementTimeout],
        [
          'Database size',
          diagnostics.databaseSizeBytes === null
            ? 'not permitted'
            : formatBytes(diagnostics.databaseSizeBytes),
        ],
        [
          'Contents',
          `${plural(diagnostics.schemaCount, 'schema', 'schemas')}, ` +
            plural(diagnostics.tableCount, 'table', 'tables'),
        ],
      ],
      painter,
    ),
  );

  if (diagnostics.largestRelations.length > 0) {
    parts.push('');
    parts.push(heading('Largest relations', painter));
    parts.push(
      renderTable(
        [
          { header: 'Schema' },
          { header: 'Name' },
          { header: 'Total', align: 'right' },
          { header: 'Table', align: 'right' },
          { header: 'Indexes', align: 'right' },
        ],
        diagnostics.largestRelations.map((row) => [
          row.schema,
          row.name,
          formatBytes(row.totalBytes),
          formatBytes(row.tableBytes),
          formatBytes(row.indexBytes),
        ]),
        { maxCellChars: options.maxCellChars, painter, indent: '  ' },
      ),
    );
  }

  if (diagnostics.extensions.length > 0) {
    parts.push('');
    parts.push(heading('Extensions', painter));
    parts.push(
      renderTable(
        [{ header: 'Name' }, { header: 'Version' }, { header: 'Schema' }],
        diagnostics.extensions.map((row) => [
          row.name,
          row.version,
          row.schema,
        ]),
        { maxCellChars: options.maxCellChars, painter, indent: '  ' },
      ),
    );
  }

  parts.push('');
  parts.push(heading('Settings', painter));
  parts.push(
    renderTable(
      [{ header: 'Name' }, { header: 'Value' }, { header: 'Source' }],
      diagnostics.settings.map((row) => [
        row.name,
        row.unit === null ? row.value : `${row.value} ${row.unit}`,
        row.source,
      ]),
      { maxCellChars: options.maxCellChars, painter, indent: '  ' },
    ),
  );
  parts.push('');
  parts.push(
    'Values above are what this role is permitted to see; a restricted role',
  );
  parts.push('sees fewer settings and no database size.');

  return `${parts.join('\n')}\n`;
}

/** A one-line preview, used where a full table would be too much. */
export function preview(text: string, limit: number): string {
  return truncate(printable(text), limit);
}
