// Running one read-only statement.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invoke, makeWorkspace, testUrl } from '../helpers/harness.js';

type Workspace = Awaited<ReturnType<typeof makeWorkspace>>;

interface QueryReport {
  readonly status: string;
  readonly result: {
    readonly statement: string;
    readonly parameterCount: number;
    readonly rows: readonly (readonly unknown[])[];
    readonly rowCount: number;
    readonly truncatedBy: string | null;
  };
}

describe('query', () => {
  let workspace: Workspace;

  const run = async (
    argv: readonly string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> =>
    invoke([...argv, '--url', testUrl()], { env: workspace.env });

  const report = async (argv: readonly string[]): Promise<QueryReport> => {
    const result = await run([...argv, '--json']);
    expect(result.code).toBe(0);
    return JSON.parse(result.stdout) as QueryReport;
  };

  beforeAll(async () => {
    workspace = await makeWorkspace();
  });

  afterAll(async () => {
    await workspace.cleanup();
  });

  it('runs a plain SELECT', async () => {
    const result = await run([
      'query',
      'SELECT email FROM customers ORDER BY id',
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('ada@example.test');
    expect(result.stdout).toContain('3 rows');
  });

  it('distinguishes NULL from an empty string', async () => {
    const result = await run([
      'query',
      "SELECT NULL::text AS nothing, ''::text AS empty",
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('NULL');
    const data = await report([
      'query',
      "SELECT NULL::text AS nothing, ''::text AS empty",
    ]);
    expect(data.result.rows[0]).toEqual([null, '']);
  });

  it('binds --param positionally', async () => {
    const data = await report([
      'query',
      'SELECT email FROM customers WHERE email = $1',
      '--param',
      'grace@example.test',
    ]);
    expect(data.result.parameterCount).toBe(1);
    expect(data.result.rows).toEqual([['grace@example.test']]);
  });

  it('treats an injection attempt as data', async () => {
    const data = await report([
      'query',
      'SELECT id FROM customers WHERE email = $1',
      '--param',
      "' OR 1=1 --",
    ]);
    expect(data.result.rowCount).toBe(0);
    expect(data.result.rows).toEqual([]);
  });

  it('truncates at --limit and says so', async () => {
    const result = await run([
      'query',
      'SELECT * FROM customers',
      '--limit',
      '2',
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('More rows were available');
    const data = await report([
      'query',
      'SELECT * FROM customers',
      '--limit',
      '2',
    ]);
    expect(data.status).toBe('truncated');
    expect(data.result.truncatedBy).toBe('rows');
    expect(data.result.rowCount).toBe(2);
  });

  it('does not report a limit equal to the row count as truncated', async () => {
    const data = await report([
      'query',
      'SELECT * FROM customers',
      '--limit',
      '3',
    ]);
    expect(data.status).toBe('ok');
    expect(data.result.truncatedBy).toBeNull();
    expect(data.result.rowCount).toBe(3);
  });

  it('truncates on the byte budget', async () => {
    const data = await report([
      'query',
      'SELECT * FROM customers',
      '--max-bytes',
      '1',
    ]);
    expect(data.result.truncatedBy).toBe('bytes');
    expect(data.result.rowCount).toBe(1);
  });

  it('writes CSV with CRLF, quoting and empty fields for NULL', async () => {
    const result = await run([
      'query',
      'SELECT id, display_name FROM customers ORDER BY id',
      '--csv',
    ]);
    expect(result.code).toBe(0);
    const lines = result.stdout.split('\r\n');
    expect(lines[0]).toBe('id,display_name');
    expect(lines[1]).toBe('1,Ada');
    // A NULL is an empty, unquoted field.
    expect(lines[2]).toBe('2,');
    expect(lines[3]).toBe('3,"Alan, ""the"" tester"');
  });

  it('refuses --csv together with --json', async () => {
    const result = await run(['query', 'SELECT 1', '--csv', '--json']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('not both');
  });

  it('gives up when the statement timeout expires', async () => {
    const result = await run([
      'query',
      'SELECT pg_sleep(5)',
      '--statement-timeout',
      '300',
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('cancelled before it finished');
  });

  it('reports a syntax error', async () => {
    const result = await run(['query', 'SELECT * FROM customers WHERE']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('syntax error');
  });

  it('reports a missing relation', async () => {
    const result = await run(['query', 'SELECT * FROM no_such_relation']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no_such_relation');
  });

  it('runs EXPLAIN', async () => {
    const result = await run(['query', 'EXPLAIN SELECT 1']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('QUERY PLAN');
  });

  it('runs SHOW', async () => {
    const result = await run(['query', 'SHOW search_path']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('search_path');
  });

  it('runs TABLE', async () => {
    const result = await run(['query', 'TABLE customers']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('ada@example.test');
  });

  it('runs VALUES', async () => {
    const result = await run(['query', 'VALUES (1), (2)']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('2 rows');
  });

  it('echoes the statement and the parameter count but no values', async () => {
    const secret = 'grace@example.test';
    const result = await run([
      'query',
      'SELECT id FROM customers WHERE email = $1',
      '--param',
      secret,
      '--json',
    ]);
    expect(result.code).toBe(0);
    const data = JSON.parse(result.stdout) as QueryReport;
    expect(data.result.statement).toBe(
      'SELECT id FROM customers WHERE email = $1',
    );
    expect(data.result.parameterCount).toBe(1);
    const withoutRows = { ...data.result, rows: [] };
    expect(JSON.stringify(withoutRows)).not.toContain(secret);
  });
});
