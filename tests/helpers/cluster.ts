// A disposable PostgreSQL server for the integration tests.
//
// Two ways to get one. If `SCHEMA_TEST_URL` is already set — which is how
// continuous integration runs, against a service container — it is used as
// it stands. Otherwise a throwaway cluster is created with `initdb` in a
// temporary directory, started on a free loopback port and removed
// afterwards. No existing cluster is ever touched, and no test database is
// ever created inside one.

import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface Cluster {
  /** Connection string for the fixture database. */
  readonly url: string;
  /** Connection string for the maintenance database. */
  readonly adminUrl: string;
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  stop(): Promise<void>;
}

export const FIXTURE_DATABASE = 'schema_fixture';
const SUPERUSER = 'schema_test';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port =
        typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

async function waitForServer(
  host: string,
  port: number,
  user: string,
): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await run('pg_isready', [
        '-h',
        host,
        '-p',
        String(port),
        '-U',
        user,
        '-q',
      ]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('The temporary PostgreSQL server did not become ready.');
}

/** True when `initdb` and `pg_ctl` are on the path. */
export async function canCreateCluster(): Promise<boolean> {
  try {
    await run('initdb', ['--version']);
    await run('pg_ctl', ['--version']);
    return true;
  } catch {
    return false;
  }
}

export async function startCluster(fixtureSql: string): Promise<Cluster> {
  const existing = process.env['SCHEMA_TEST_URL'];
  if (existing !== undefined && existing !== '') {
    const url = new URL(existing);
    const admin = new URL(existing);
    admin.pathname = '/postgres';
    const database = url.pathname.replace(/^\//, '') || 'postgres';
    await psql(admin.toString(), `DROP DATABASE IF EXISTS ${database}`);
    await psql(admin.toString(), `CREATE DATABASE ${database}`);
    await psqlFile(url.toString(), fixtureSql);
    return {
      url: url.toString(),
      adminUrl: admin.toString(),
      host: url.hostname,
      port: Number(url.port || '5432'),
      database,
      user: url.username,
      stop: async () => {
        await Promise.resolve();
      },
    };
  }

  const root = await mkdtemp(join(tmpdir(), 'schema-pg-'));
  const data = join(root, 'data');
  const port = await freePort();
  await run('initdb', [
    '-D',
    data,
    '-U',
    SUPERUSER,
    '--auth=trust',
    '-E',
    'UTF8',
    '--no-sync',
  ]);
  await run('pg_ctl', [
    '-D',
    data,
    '-o',
    `-p ${port} -k ${root} -c listen_addresses=127.0.0.1 -c fsync=off`,
    '-l',
    join(root, 'server.log'),
    'start',
  ]);
  await waitForServer('127.0.0.1', port, SUPERUSER);

  const adminUrl = `postgresql://${SUPERUSER}@127.0.0.1:${port}/postgres`;
  const url = `postgresql://${SUPERUSER}@127.0.0.1:${port}/${FIXTURE_DATABASE}`;
  await psql(adminUrl, `CREATE DATABASE ${FIXTURE_DATABASE}`);
  await psqlFile(url, fixtureSql);

  return {
    url,
    adminUrl,
    host: '127.0.0.1',
    port,
    database: FIXTURE_DATABASE,
    user: SUPERUSER,
    stop: async () => {
      await run('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']).catch(
        () => undefined,
      );
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function psql(url: string, sql: string): Promise<string> {
  const { stdout } = await run('psql', [
    url,
    '-v',
    'ON_ERROR_STOP=1',
    '-q',
    '-A',
    '-t',
    '-c',
    sql,
  ]);
  return stdout;
}

async function psqlFile(url: string, path: string): Promise<void> {
  await run('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', '-f', path]);
}
