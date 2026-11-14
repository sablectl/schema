# Testing

The suite is Vitest, split into two projects: unit tests that need nothing
but Node.js, and integration tests that run the commands against a real
PostgreSQL server.

## Running the tests

```sh
npm test              # the unit project
npm run test:integration   # the integration project
npm run verify        # type check, lint, format check and both projects
```

`npm run verify` is what the continuous integration job runs; run it before
opening a pull request.

The integration project needs a build, because it exercises the compiled
entry point. Run `npm run build` first if the tree is stale.

## The two projects

**unit** covers everything that does not need a server: argument parsing and
the option tables, configuration loading, validation and atomic writing,
statement classification and the allow-list, redaction, the error code to
exit code mapping, table layout and column widths, value formatting, CSV
writing and the shape of the JSON envelope.

**integration** covers the commands end to end: `connect`, `databases`,
`schemas`, `tables`, `describe`, `relations`, `indexes`, `sequences`,
`query`, `export` and `inspect` against the fixture database, including the
cursor path, the row and byte budgets, the buffered fallback for `EXPLAIN`
and `SHOW`, name resolution and the error paths that need a server to
produce.

## The disposable cluster

The integration project does not use a server you already have. Its global
setup creates one:

1. `initdb` into a fresh temporary directory, with trust authentication and
   UTF-8 encoding;
2. `pg_ctl` starts it on a free loopback port, listening on `127.0.0.1` only,
   with its unix socket inside the same temporary directory;
3. the database is created and `tests/fixtures/shop.sql` is loaded into it;
4. the tests run;
5. teardown stops the server and removes the directory.

Nothing outside that directory is touched, no existing cluster is contacted
and the machine's own PostgreSQL service on port 5432 is left alone.

### Getting `initdb` and `pg_ctl`

Those two binaries come with the server package, not the client package.

| Distribution   | Package                        |
| -------------- | ------------------------------ |
| Debian, Ubuntu | `postgresql`                   |
| Fedora         | `postgresql-server postgresql` |

```sh
sudo apt install postgresql          # Debian, Ubuntu
sudo dnf install postgresql-server postgresql   # Fedora
```

Neither distribution puts the binaries on the default path. They live under a
versioned directory, so add it for the session:

```sh
export PATH="/usr/lib/postgresql/17/bin:$PATH"   # Debian, Ubuntu
export PATH="/usr/pgsql-17/bin:$PATH"            # Fedora
```

Adjust the version number to the one installed. If `initdb --version` prints
a version, the setup will find it.

On macOS, Postgres.app and Homebrew's `postgresql@17` both provide the
binaries; add their `bin` directory to `PATH` in the same way.

## Pointing the suite at an existing database

If creating a cluster is impractical — in a container with no server package,
for instance — set `SCHEMA_TEST_URL` to a connection string and the global
setup will use that server instead of building one.

```sh
SCHEMA_TEST_URL=postgresql://postgres@127.0.0.1:55433/schema_test \
  npm run test:integration
```

> **Warning.** The global setup **drops and recreates** the database named in
> `SCHEMA_TEST_URL` before loading the fixture. Everything in it is
> destroyed. Never point `SCHEMA_TEST_URL` at a database that matters, at a
> shared development database or at anything on a production server. Use a
> database created for this purpose and nothing else.

The role in `SCHEMA_TEST_URL` must be able to drop and create a database, so
it cannot be the restricted read-only role from
[read-only-role.md](read-only-role.md).

## Creating a disposable server by hand

To reproduce an example from the documentation, or to poke at the fixture
without running the suite:

```sh
mkdir -p /tmp/schema-demo
initdb -D /tmp/schema-demo/data -U postgres --auth=trust -E UTF8
pg_ctl -D /tmp/schema-demo/data \
  -o "-p 55433 -k /tmp/schema-demo -c listen_addresses=127.0.0.1" \
  -l /tmp/schema-demo/log start
psql -h 127.0.0.1 -p 55433 -U postgres -c 'CREATE DATABASE shop'
psql -h 127.0.0.1 -p 55433 -U postgres -d shop -f tests/fixtures/shop.sql
```

Stop and remove it afterwards:

```sh
pg_ctl -D /tmp/schema-demo/data stop
rm -rf /tmp/schema-demo
```

The examples throughout the documentation were run against a cluster built
this way, at `postgresql://postgres@127.0.0.1:55433/shop`.

## What is not covered

The disposable cluster is built without TLS, so no encrypted connection path
is exercised by an automated test, and the `verify-ca` and `verify-full`
modes are untested. The fixture is loaded once and must not be modified, so
there is no automated scenario in which the tool connects as a restricted
role. Both are listed in [technical-debt.md](technical-debt.md).
