import { describe, expect, it } from 'vitest';
import {
  formatConnection,
  formatDatabases,
  formatDiagnostics,
  formatForeignKeys,
  formatIndexes,
  formatQuery,
  formatRelations,
  formatSchemas,
  formatSequences,
  formatTable,
  preview,
} from '../../../src/output/human.js';
import {
  column,
  connectionInfo,
  databaseSummary,
  diagnostics,
  foreignKey,
  formatOptions,
  index,
  queryOutcome,
  relationSummary,
  schemaSummary,
  sequence,
  tableDetail,
  target,
} from '../helpers/fixtures.js';

describe('formatConnection', () => {
  it('reports the server, the redacted URL and the read-only state', () => {
    const text = formatConnection(target(), connectionInfo(), formatOptions);
    expect(text).toContain('Connection');
    expect(text).toContain('Server');
    expect(text).toContain('PostgreSQL 16.2');
    expect(text).toContain(
      'postgresql://alice:[redacted]@db.example:5432/shop',
    );
    expect(text).not.toContain('hunter2');
    expect(text).toContain('Transaction  read only');
    expect(text).toContain('Backend');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('says the connection is not encrypted, and what was asked for', () => {
    expect(
      formatConnection(target(), connectionInfo(), formatOptions),
    ).toContain('none (requested prefer)');
  });

  it('reports the negotiated cipher when there is one', () => {
    const text = formatConnection(
      target({ sslMode: 'require' }),
      connectionInfo({ tls: { version: 'TLSv1.3', cipher: 'AES' } }),
      formatOptions,
    );
    expect(text).toContain('TLSv1.3, AES (requested require)');
  });

  it('names the login role only when it differs', () => {
    expect(
      formatConnection(target(), connectionInfo(), formatOptions),
    ).not.toContain('Login role');
    expect(
      formatConnection(
        target(),
        connectionInfo({ sessionUser: 'bob' }),
        formatOptions,
      ),
    ).toContain('Login role');
  });
});

describe('formatDatabases', () => {
  it('says so when there is nothing to list', () => {
    expect(formatDatabases([], formatOptions)).toBe(
      'No databases are visible to this role.\n',
    );
  });

  it('tabulates the databases and counts them', () => {
    const text = formatDatabases(
      [
        databaseSummary(),
        databaseSummary({
          name: 'other',
          isCurrent: false,
          connectable: false,
          sizeBytes: null,
        }),
      ],
      formatOptions,
    );
    expect(text).toContain('Name');
    expect(text).toContain('2.0 KiB');
    expect(text).toContain('current');
    expect(text).toContain('not permitted');
    expect(text).toContain('no connections');
    expect(text).toContain('2 databases.');
  });

  it('uses the singular for one row', () => {
    expect(formatDatabases([databaseSummary()], formatOptions)).toContain(
      '1 database.',
    );
  });
});

describe('formatSchemas', () => {
  it('says so when there is nothing to list', () => {
    expect(formatSchemas([], formatOptions)).toBe(
      'No schemas are visible to this role.\n',
    );
  });

  it('tabulates the counts and the comment', () => {
    const text = formatSchemas(
      [schemaSummary({ comment: 'the usual place' })],
      formatOptions,
    );
    expect(text).toContain('Mat. views');
    expect(text).toContain('the usual place');
    expect(text).toContain('1 schema.');
  });
});

describe('formatRelations', () => {
  it('says so when nothing matches', () => {
    expect(formatRelations([], formatOptions)).toBe(
      'No tables or views match.\n',
    );
  });

  it('says "not analysed" rather than zero for an unknown estimate', () => {
    const text = formatRelations(
      [relationSummary({ estimatedRows: null, sizeBytes: null })],
      formatOptions,
    );
    expect(text).toContain('not analysed');
  });

  it('counts the relations and explains the estimate', () => {
    const text = formatRelations(
      [relationSummary(), relationSummary({ name: 'orders' })],
      formatOptions,
    );
    expect(text).toContain('1,234');
    expect(text).toContain('8.0 KiB');
    expect(text).toContain('2 relations.');
    expect(text).toContain('planner estimates from the last ANALYZE');
  });
});

describe('formatSequences', () => {
  it('says so when there is nothing to list', () => {
    expect(formatSequences([], formatOptions)).toBe(
      'No sequences are visible to this role.\n',
    );
  });

  it('tabulates the sequence and whether it cycles', () => {
    const text = formatSequences(
      [
        sequence(),
        sequence({ name: 'other_seq', cycles: true, ownedBy: null }),
      ],
      formatOptions,
    );
    expect(text).toContain('Owned by');
    expect(text).toContain('public.customers.id');
    expect(text).toContain('no');
    expect(text).toContain('yes');
    expect(text).toContain('2 sequences.');
  });
});

describe('formatTable', () => {
  const detail = tableDetail({
    columns: [
      column(),
      column({
        position: 2,
        name: 'created_at',
        type: 'timestamptz',
        nullable: true,
        defaultValue: 'now()',
        comment: 'when the row appeared',
      }),
      column({ position: 3, name: 'serial_id', identity: 'a' }),
      column({ position: 4, name: 'by_default', identity: 'd' }),
      column({ position: 5, name: 'total', generated: 's' }),
    ],
    referencedBy: [foreignKey()],
  });

  it('flags the primary key, nullability, identity and generation', () => {
    const text = formatTable(detail, null, formatOptions);
    expect(text).toContain('PK, not null');
    expect(text).toContain('identity always');
    expect(text).toMatch(/by_default.*identity$/m);
    expect(text).toContain('generated');
  });

  it('prefers an exact row count when one was taken', () => {
    expect(formatTable(detail, 42, formatOptions)).toContain('42 (exact)');
    expect(formatTable(detail, null, formatOptions)).toContain(
      '1,234 (estimated)',
    );
  });

  it('says "not analysed" when there is no estimate either', () => {
    const unanalysed = tableDetail({
      relation: relationSummary({ estimatedRows: null, sizeBytes: null }),
    });
    const text = formatTable(unanalysed, null, formatOptions);
    expect(text).toContain('not analysed');
    expect(text).toContain('not available');
  });

  it('lists the sections it has content for', () => {
    const text = formatTable(detail, null, formatOptions);
    expect(text).toContain('public.customers');
    expect(text).toContain('Columns');
    expect(text).toContain('Constraints');
    expect(text).toContain('Indexes');
    expect(text).toContain('Referenced by');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('omits the sections it has nothing for', () => {
    const bare = tableDetail({
      constraints: [],
      indexes: [],
      referencedBy: [],
    });
    const text = formatTable(bare, null, formatOptions);
    expect(text).not.toContain('Constraints');
    expect(text).not.toContain('Referenced by');
  });

  it('names the parent of a partition and the comment', () => {
    const text = formatTable(
      tableDetail({
        relation: relationSummary({ comment: 'the customers' }),
        partitionOf: 'public.all_customers',
      }),
      null,
      formatOptions,
    );
    expect(text).toContain('Partition of');
    expect(text).toContain('public.all_customers');
    expect(text).toContain('the customers');
  });

  it('notes a collation on a column', () => {
    const text = formatTable(
      tableDetail({
        columns: [column({ name: 'name', collation: 'en_GB' })],
        constraints: [],
      }),
      null,
      formatOptions,
    );
    expect(text).toContain('collate en_GB');
  });
});

describe('formatIndexes', () => {
  it('says so when there are none', () => {
    expect(formatIndexes([], 'Indexes', formatOptions)).toBe(
      'No indexes are defined.\n',
    );
  });

  it('marks the primary key, a unique index and an invalid one', () => {
    const text = formatIndexes(
      [
        index(),
        index({ name: 'customers_email_key', isPrimary: false }),
        index({
          name: 'customers_name_idx',
          isPrimary: false,
          isUnique: false,
          isValid: false,
          sizeBytes: null,
        }),
      ],
      'Indexes on public.customers',
      formatOptions,
    );
    expect(text).toContain('Indexes on public.customers');
    expect(text).toContain('primary key');
    expect(text).toContain('[INVALID]');
    expect(text).toContain('16.0 KiB');
    expect(text).toContain('3 indexes.');
  });

  it('uses the singular for one index', () => {
    expect(formatIndexes([index()], 'Indexes', formatOptions)).toContain(
      '1 index.',
    );
  });
});

describe('formatForeignKeys', () => {
  it('says so when none are declared', () => {
    expect(formatForeignKeys([], formatOptions)).toBe(
      'No foreign keys are declared here.\n',
    );
  });

  it('tabulates the keys and the referential actions', () => {
    const text = formatForeignKeys([foreignKey()], formatOptions);
    expect(text).toContain('public.orders');
    expect(text).toContain('public.customers');
    expect(text).toContain('cascade');
    expect(text).toContain('1 relationship.');
  });

  it('notes how many are composite', () => {
    const text = formatForeignKeys(
      [foreignKey(), foreignKey({ name: 'two', columns: ['a', 'b'] })],
      formatOptions,
    );
    expect(text).toContain('2 relationships.');
    expect(text).toContain('1 is composite.');
  });

  it('leaves the note out when none are composite', () => {
    expect(formatForeignKeys([foreignKey()], formatOptions)).not.toContain(
      'composite',
    );
  });
});

describe('formatQuery', () => {
  it('reports the row count and the duration', () => {
    const text = formatQuery(queryOutcome(), formatOptions);
    expect(text).toContain('id');
    expect(text).toContain('2 rows in 13 ms.');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('uses the singular for one row', () => {
    expect(
      formatQuery(queryOutcome({ rows: [[1]], rowCount: 1 }), formatOptions),
    ).toContain('1 row in');
  });

  it('says when the row limit cut the result short', () => {
    expect(
      formatQuery(queryOutcome({ truncatedBy: 'rows' }), formatOptions),
    ).toContain('raise --limit to read further');
  });

  it('says when the byte budget cut the result short', () => {
    expect(
      formatQuery(queryOutcome({ truncatedBy: 'bytes' }), formatOptions),
    ).toContain('reached the output size limit');
  });

  it('says so when there are no columns at all', () => {
    expect(
      formatQuery(
        queryOutcome({ fields: [], rows: [], rowCount: 0 }),
        formatOptions,
      ),
    ).toBe('No columns were returned.\n');
  });
});

describe('formatDiagnostics', () => {
  it('reports the server, the contents and the settings', () => {
    const text = formatDiagnostics(diagnostics(), formatOptions);
    expect(text).toContain('Server');
    expect(text).toContain('Version');
    expect(text).toContain('read only');
    expect(text).toContain('1.0 MiB');
    expect(text).toContain('2 schemas, 7 tables');
    expect(text).toContain('Largest relations');
    expect(text).toContain('Extensions');
    expect(text).toContain('Settings');
    expect(text).toContain('4096 kB');
    expect(text).toContain('off');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('says "not permitted" when the size cannot be read', () => {
    expect(
      formatDiagnostics(
        diagnostics({ databaseSizeBytes: null }),
        formatOptions,
      ),
    ).toContain('not permitted');
  });

  it('omits the optional sections when they are empty', () => {
    const text = formatDiagnostics(
      diagnostics({ largestRelations: [], extensions: [] }),
      formatOptions,
    );
    expect(text).not.toContain('Largest relations');
    expect(text).not.toContain('Extensions');
    expect(text).toContain('Settings');
  });
});

describe('preview', () => {
  it('escapes and shortens in one step', () => {
    expect(preview('one\ntwo three', 8)).toBe('one\\ntw…');
  });
});
