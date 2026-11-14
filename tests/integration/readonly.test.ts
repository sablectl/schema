// Read-only enforcement.
//
// Two boundaries are checked here. The statement guard refuses anything that
// is not a read before a connection is even used, and the server refuses a
// write inside the read-only transaction. The second is the one that matters
// if the first is ever bypassed, so it is exercised through the library
// exports rather than through the command line.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database, isAppError, resolveTarget } from '../../src/index.js';
import { invoke, makeWorkspace, testUrl } from '../helpers/harness.js';

type Workspace = Awaited<ReturnType<typeof makeWorkspace>>;

describe('read-only enforcement', () => {
  let workspace: Workspace;

  const run = async (
    argv: readonly string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> =>
    invoke([...argv, '--url', testUrl()], { env: workspace.env });

  const customerCount = async (): Promise<number> => {
    const result = await run([
      'query',
      'SELECT count(*)::int AS n FROM customers',
      '--json',
    ]);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as {
      result: { rows: readonly (readonly number[])[] };
    };
    return report.result.rows[0]?.[0] ?? -1;
  };

  beforeAll(async () => {
    workspace = await makeWorkspace();
  });

  afterAll(async () => {
    await workspace.cleanup();
  });

  const writes: readonly (readonly [string, string])[] = [
    ['INSERT', "INSERT INTO customers (email) VALUES ('mallory@example.test')"],
    ['UPDATE', "UPDATE customers SET display_name = 'changed'"],
    ['DELETE', 'DELETE FROM customers'],
    ['CREATE TABLE', 'CREATE TABLE intruder (id int)'],
    ['DROP TABLE', 'DROP TABLE customers'],
    ['ALTER TABLE', 'ALTER TABLE customers ADD COLUMN sneaky int'],
    ['TRUNCATE', 'TRUNCATE customers'],
  ];

  for (const [label, statement] of writes) {
    it(`refuses ${label} and leaves the data alone`, async () => {
      const before = await customerCount();
      const result = await run(['query', statement]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('does not run');
      expect(await customerCount()).toBe(before);
      const names = await run([
        'query',
        'SELECT email, display_name FROM customers ORDER BY id',
      ]);
      expect(names.code).toBe(0);
      expect(names.stdout).toContain('ada@example.test');
      expect(names.stdout).not.toContain('changed');
    });
  }

  it('refuses COPY TO a file and does not create it', async () => {
    const path = join(tmpdir(), `schema-copy-${process.pid}-${Date.now()}.csv`);
    const result = await run(['query', `COPY customers TO '${path}'`]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('COPY');
    expect(existsSync(path)).toBe(false);
  });

  it('refuses COPY FROM PROGRAM', async () => {
    const result = await run(['query', "COPY customers FROM PROGRAM 'id'"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('COPY');
  });

  it('refuses two statements in one argument', async () => {
    const result = await run(['query', 'SELECT 1; SELECT 2']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('one statement');
  });

  it('is not fooled by a leading comment', async () => {
    const before = await customerCount();
    const result = await run([
      'query',
      "/* read */ INSERT INTO customers (email) VALUES ('comment@example.test')",
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('INSERT');
    expect(await customerCount()).toBe(before);
  });

  it('is refused by the server itself, not only by the guard', async () => {
    const target = resolveTarget({ url: testUrl() }, {});
    const db = await Database.connect(target);
    let failure: unknown;
    try {
      await db.read(
        "INSERT INTO customers (email) VALUES ('blocked@example.test')",
      );
    } catch (error) {
      failure = error;
    } finally {
      await db.close();
    }
    expect(failure).toBeDefined();
    expect(isAppError(failure)).toBe(true);
    if (isAppError(failure)) {
      expect(failure.code).toBe('read-only-violation');
      expect(failure.message).toMatch(/read-only transaction/i);
    }

    const check = await run([
      'query',
      "SELECT count(*)::int AS n FROM customers WHERE email = 'blocked@example.test'",
      '--json',
    ]);
    const report = JSON.parse(check.stdout) as {
      result: { rows: readonly (readonly number[])[] };
    };
    expect(report.result.rows[0]?.[0]).toBe(0);
  });
});
