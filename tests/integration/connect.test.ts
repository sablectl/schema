// Opening a connection and reporting what answered.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invoke, makeWorkspace, testUrl } from '../helpers/harness.js';

type Workspace = Awaited<ReturnType<typeof makeWorkspace>>;

describe('connect', () => {
  let workspace: Workspace;

  beforeAll(async () => {
    workspace = await makeWorkspace();
  });

  afterAll(async () => {
    await workspace.cleanup();
  });

  it('reports the server, database, role and transaction mode', async () => {
    const result = await invoke(['connect', '--url', testUrl()], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('PostgreSQL');
    expect(result.stdout).toContain('schema_fixture');
    expect(result.stdout).toMatch(/Role\s+\w+/);
    expect(result.stdout).toContain('read only');
    expect(result.stdout).toMatch(/Encryption\s+\S+/);
  });

  it('writes a JSON envelope with a redacted url', async () => {
    const result = await invoke(['connect', '--url', testUrl(), '--json'], {
      env: workspace.env,
    });
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as {
      command: string;
      status: string;
      result: { url: string; database: string; port: number };
    };
    expect(report.command).toBe('connect');
    expect(report.status).toBe('ok');
    expect(report.result.database).toBe('schema_fixture');
    expect(report.result.url).toMatch(/^postgresql:\/\//);
    expect(report.result.url).not.toContain(':@');
  });

  it('accepts the individual connection options', async () => {
    const url = new URL(testUrl());
    const result = await invoke(
      [
        'connect',
        '--host',
        url.hostname,
        '--port',
        url.port,
        '--dbname',
        url.pathname.replace(/^\//, ''),
        '--user',
        url.username,
      ],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('schema_fixture');
  });

  it('never prints a password taken from the environment', async () => {
    const secret = 'correct-horse-battery-staple';
    const result = await invoke(
      ['connect', '--url', testUrl(), '--password-env', 'SCHEMA_TEST_SECRET'],
      { env: { ...workspace.env, SCHEMA_TEST_SECRET: secret } },
    );
    // Whether the password is accepted depends on the server's
    // authentication settings, which differ between a trust-authenticated
    // throwaway cluster and a password-authenticated service container.
    // What must hold either way is that the secret does not reach the
    // output — and the failure path, where it would be quoted back in a
    // driver message, is the more interesting of the two.
    expect([0, 1]).toContain(result.code);
    expect(result.stdout).not.toContain(secret);
    expect(result.stderr).not.toContain(secret);
  });

  it('refuses a --password-env naming an unset variable', async () => {
    const result = await invoke(
      ['connect', '--url', testUrl(), '--password-env', 'SCHEMA_TEST_ABSENT'],
      { env: workspace.env },
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('SCHEMA_TEST_ABSENT is not set');
  });

  it('fails when the database does not exist', async () => {
    const url = new URL(testUrl());
    url.pathname = '/no_such_database';
    const result = await invoke(['connect', '--url', url.toString()], {
      env: workspace.env,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('no_such_database');
  });

  it('names the missing database with --ssl-mode disable too', async () => {
    const url = new URL(testUrl());
    url.pathname = '/no_such_database';
    const result = await invoke(
      ['connect', '--url', url.toString(), '--ssl-mode', 'disable'],
      { env: workspace.env },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no_such_database');
  });

  it('fails when nothing listens on the port', async () => {
    const url = new URL(testUrl());
    url.port = '1';
    const result = await invoke(
      ['connect', '--url', url.toString(), '--connect-timeout', '2000'],
      { env: workspace.env },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).not.toBe('');
  });

  it('refuses a connection string it cannot parse', async () => {
    const result = await invoke(['connect', '--url', 'not a url'], {
      env: workspace.env,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('could not be parsed');
  });

  it('refuses an unsupported SSL mode', async () => {
    const result = await invoke(
      ['connect', '--url', testUrl(), '--ssl-mode', 'sometimes'],
      { env: workspace.env },
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('is not a supported SSL mode');
  });

  it('connects with --ssl-mode disable', async () => {
    const result = await invoke(
      ['connect', '--url', testUrl(), '--ssl-mode', 'disable'],
      { env: workspace.env },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('read only');
  });

  it('redacts a password spelt as PGPASSWORD in a reported error', async () => {
    const secret = 'hunter2-should-never-appear';
    const result = await invoke(
      ['connect', '--url', `postgresql://PGPASSWORD=${secret}`],
      { env: workspace.env },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout).not.toContain(secret);
    expect(result.stderr).not.toContain(secret);
  });
});
