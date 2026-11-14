// One disposable PostgreSQL server for the whole integration run.
//
// Starting a cluster costs a second or two, so it is done once here rather
// than once per file. The connection string is published through
// `SCHEMA_TEST_URL`, which is also the variable continuous integration sets
// when it supplies a service container instead.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { canCreateCluster, startCluster, type Cluster } from './cluster.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, '..', 'fixtures', 'shop.sql');

let cluster: Cluster | undefined;

export async function setup(): Promise<void> {
  const supplied = process.env['SCHEMA_TEST_URL'];
  if (
    (supplied === undefined || supplied === '') &&
    !(await canCreateCluster())
  ) {
    throw new Error(
      'The integration tests need PostgreSQL. Either install the server ' +
        'binaries (initdb, pg_ctl, psql) or set SCHEMA_TEST_URL to a ' +
        'disposable database. See docs/testing.md.',
    );
  }
  cluster = await startCluster(FIXTURE);
  process.env['SCHEMA_TEST_URL'] = cluster.url;
  process.env['SCHEMA_TEST_ADMIN_URL'] = cluster.adminUrl;
}

export async function teardown(): Promise<void> {
  await cluster?.stop();
}
