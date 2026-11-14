// Fixture builders for the unit tests.
//
// Every report input is built by hand here rather than read from a server,
// so the output tests stay pure and describe exactly the shape they assert
// on. Each builder takes a partial override so a test can name only the
// fields it cares about.

import type {
  ColumnInfo,
  ConstraintInfo,
  DatabaseSummary,
  ForeignKeyInfo,
  IndexInfo,
  RelationSummary,
  SchemaSummary,
  SequenceInfo,
  TableDetail,
} from '../../../src/core/catalog.js';
import type { ConnectionInfo } from '../../../src/core/client.js';
import type { ConnectionTarget } from '../../../src/core/connection.js';
import type { Diagnostics } from '../../../src/core/diagnostics.js';
import type { QueryOutcome } from '../../../src/core/query.js';
import { createPainter, type Painter } from '../../../src/output/colour.js';

/** A painter that returns its text unchanged, so assertions stay readable. */
export const plain: Painter = createPainter(false);

export const formatOptions = { painter: plain, maxCellChars: 120 };

export function target(
  overrides: Partial<ConnectionTarget> = {},
): ConnectionTarget {
  return {
    host: 'db.example',
    port: 5432,
    database: 'shop',
    user: 'alice',
    password: 'hunter2',
    sslMode: 'prefer',
    sslRootCert: undefined,
    applicationName: 'schema',
    connectTimeoutMs: 10_000,
    statementTimeoutMs: 15_000,
    ...overrides,
  };
}

export function connectionInfo(
  overrides: Partial<ConnectionInfo> = {},
): ConnectionInfo {
  return {
    serverVersion: '16.2',
    serverVersionNum: 160_002,
    backendPid: 4242,
    currentDatabase: 'shop',
    currentUser: 'alice',
    sessionUser: 'alice',
    tls: null,
    sslModeUsed: 'prefer',
    ...overrides,
  };
}

export function databaseSummary(
  overrides: Partial<DatabaseSummary> = {},
): DatabaseSummary {
  return {
    name: 'shop',
    owner: 'alice',
    encoding: 'UTF8',
    collate: 'en_GB.UTF-8',
    connectable: true,
    isCurrent: true,
    sizeBytes: 2048,
    ...overrides,
  };
}

export function schemaSummary(
  overrides: Partial<SchemaSummary> = {},
): SchemaSummary {
  return {
    name: 'public',
    owner: 'alice',
    comment: null,
    tables: 3,
    views: 1,
    materialisedViews: 0,
    isSystem: false,
    ...overrides,
  };
}

export function relationSummary(
  overrides: Partial<RelationSummary> = {},
): RelationSummary {
  return {
    schema: 'public',
    name: 'customers',
    kind: 'table',
    owner: 'alice',
    estimatedRows: 1234,
    sizeBytes: 8192,
    comment: null,
    ...overrides,
  };
}

export function column(overrides: Partial<ColumnInfo> = {}): ColumnInfo {
  return {
    position: 1,
    name: 'id',
    type: 'integer',
    nullable: false,
    defaultValue: null,
    identity: null,
    generated: null,
    collation: null,
    comment: null,
    ...overrides,
  };
}

export function constraint(
  overrides: Partial<ConstraintInfo> = {},
): ConstraintInfo {
  return {
    name: 'customers_pkey',
    type: 'primary key',
    definition: 'PRIMARY KEY (id)',
    columns: ['id'],
    ...overrides,
  };
}

export function index(overrides: Partial<IndexInfo> = {}): IndexInfo {
  return {
    name: 'customers_pkey',
    definition: 'CREATE UNIQUE INDEX customers_pkey ON customers (id)',
    method: 'btree',
    isUnique: true,
    isPrimary: true,
    isValid: true,
    sizeBytes: 16_384,
    ...overrides,
  };
}

export function foreignKey(
  overrides: Partial<ForeignKeyInfo> = {},
): ForeignKeyInfo {
  return {
    name: 'orders_customer_id_fkey',
    schema: 'public',
    table: 'orders',
    columns: ['customer_id'],
    referencedSchema: 'public',
    referencedTable: 'customers',
    referencedColumns: ['id'],
    onUpdate: 'no action',
    onDelete: 'cascade',
    matchType: 'simple',
    ...overrides,
  };
}

export function sequence(overrides: Partial<SequenceInfo> = {}): SequenceInfo {
  return {
    schema: 'public',
    name: 'customers_id_seq',
    dataType: 'integer',
    startValue: '1',
    increment: '1',
    minimumValue: '1',
    maximumValue: '2147483647',
    cycles: false,
    ownedBy: 'public.customers.id',
    ...overrides,
  };
}

export function tableDetail(overrides: Partial<TableDetail> = {}): TableDetail {
  return {
    relation: relationSummary(),
    columns: [column()],
    constraints: [constraint()],
    indexes: [index()],
    foreignKeys: [],
    referencedBy: [],
    partitionOf: null,
    ...overrides,
  };
}

export function queryOutcome(
  overrides: Partial<QueryOutcome> = {},
): QueryOutcome {
  return {
    fields: [{ name: 'id', dataTypeId: 23 }],
    rows: [[1], [2]],
    rowCount: 2,
    truncatedBy: null,
    durationMs: 12.5,
    buffered: false,
    approximateBytes: 16,
    ...overrides,
  };
}

export function diagnostics(overrides: Partial<Diagnostics> = {}): Diagnostics {
  return {
    serverVersion: '16.2',
    database: 'shop',
    currentRole: 'alice',
    sessionRole: 'alice',
    isSuperuser: false,
    searchPath: '"$user", public',
    timeZone: 'UTC',
    encoding: 'UTF8',
    transactionReadOnly: true,
    statementTimeout: '15s',
    databaseSizeBytes: 1_048_576,
    schemaCount: 2,
    tableCount: 7,
    extensions: [
      { name: 'plpgsql', version: '1.0', schema: 'pg_catalog', comment: null },
    ],
    largestRelations: [
      {
        schema: 'public',
        name: 'orders',
        kind: 'table',
        totalBytes: 65_536,
        tableBytes: 49_152,
        indexBytes: 16_384,
      },
    ],
    settings: [
      {
        name: 'work_mem',
        value: '4096',
        unit: 'kB',
        source: 'configuration file',
      },
      { name: 'ssl', value: 'off', unit: null, source: 'default' },
    ],
    ...overrides,
  };
}
