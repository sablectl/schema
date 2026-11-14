import { describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSION,
  connectionToJson,
  databasesToJson,
  diagnosticsToJson,
  foreignKeysToJson,
  envelope,
  queryToJson,
  render,
  tableToJson,
} from '../../../src/output/json.js';
import { VERSION } from '../../../src/version.js';
import {
  connectionInfo,
  databaseSummary,
  diagnostics,
  foreignKey,
  queryOutcome,
  tableDetail,
  target,
} from '../helpers/fixtures.js';

const NOW = new Date(Date.UTC(2024, 0, 2, 3, 4, 5));

describe('envelope', () => {
  it('carries the versioned header around the result', () => {
    expect(envelope('tables', 'ok', { rows: [] }, NOW)).toEqual({
      schemaVersion: SCHEMA_VERSION,
      tool: 'schema',
      version: VERSION,
      command: 'tables',
      generatedAt: '2024-01-02T03:04:05.000Z',
      status: 'ok',
      result: { rows: [] },
    });
  });

  it.each(['ok', 'empty', 'truncated'] as const)(
    'carries the %s status',
    (status) => {
      expect(envelope('query', status, null, NOW).status).toBe(status);
    },
  );

  it('stamps the current time when none is injected', () => {
    const stamped = envelope('query', 'ok', null).generatedAt;
    expect(Number.isNaN(Date.parse(stamped))).toBe(false);
  });
});

describe('render', () => {
  it('writes indented JSON ending in a newline', () => {
    const text = render({ a: 1 });
    expect(text).toBe('{\n  "a": 1\n}\n');
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('connectionToJson', () => {
  it('reports the redacted connection string, never the password', () => {
    const report = connectionToJson(target(), connectionInfo());
    expect(report['url']).toBe(
      'postgresql://alice:[redacted]@db.example:5432/shop',
    );
    expect(JSON.stringify(report)).not.toContain('hunter2');
    expect(report['backendPid']).toBe(4242);
    expect(report['tls']).toBeNull();
  });
});

describe('databasesToJson', () => {
  it('wraps the rows under a named key', () => {
    const rows = [databaseSummary()];
    expect(databasesToJson(rows)).toEqual({ databases: rows });
  });
});

describe('foreignKeysToJson', () => {
  it('adds a composite flag to each key', () => {
    const [single, composite] = foreignKeysToJson([
      foreignKey(),
      foreignKey({ columns: ['a', 'b'] }),
    ]);
    expect(single?.['composite']).toBe(false);
    expect(composite?.['composite']).toBe(true);
    expect(single?.['name']).toBe('orders_customer_id_fkey');
  });
});

describe('tableToJson', () => {
  it('reports the exact row count it was given', () => {
    const report = tableToJson(tableDetail(), 17);
    expect(report['exactRows']).toBe(17);
    expect(report['partitionOf']).toBeNull();
    expect(report['columns']).toHaveLength(1);
    expect(report['referencedBy']).toEqual([]);
  });

  it('reports a null count when none was asked for', () => {
    expect(tableToJson(tableDetail(), null)['exactRows']).toBeNull();
  });
});

describe('queryToJson', () => {
  it('echoes the statement and counts the parameters', () => {
    const report = queryToJson(
      queryOutcome(),
      'SELECT id FROM t WHERE secret = $1',
      ['hunter2'],
    );
    expect(report['statement']).toBe('SELECT id FROM t WHERE secret = $1');
    expect(report['parameterCount']).toBe(1);
    expect(report['rowCount']).toBe(2);
    expect(report['truncatedBy']).toBeNull();
  });

  it('never writes the parameter values', () => {
    const report = queryToJson(queryOutcome(), 'SELECT $1', ['hunter2']);
    expect(JSON.stringify(report)).not.toContain('hunter2');
    expect(Object.keys(report)).not.toContain('parameters');
  });

  it('normalises the values and rounds the duration', () => {
    const report = queryToJson(
      queryOutcome({
        fields: [{ name: 'at', dataTypeId: 1184 }],
        rows: [[new Date(Date.UTC(2024, 0, 2))]],
        rowCount: 1,
        durationMs: 12.3456,
      }),
      'SELECT now()',
      [],
    );
    expect(report['rows']).toEqual([['2024-01-02T00:00:00.000Z']]);
    expect(report['durationMs']).toBe(12.35);
    expect(report['columns']).toEqual([{ name: 'at', dataTypeId: 1184 }]);
  });
});

describe('diagnosticsToJson', () => {
  it('copies the diagnostics across', () => {
    const report = diagnosticsToJson(diagnostics());
    expect(report['databaseSizeBytes']).toBe(1_048_576);
    expect(report['settings']).toHaveLength(2);
  });
});
