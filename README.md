# Schema

**PostgreSQL Explorer and Read-Only Query Toolkit** — structure inspection,
relationship exploration and controlled queries for the command line.

[![CI](https://github.com/sablectl/schema/actions/workflows/ci.yml/badge.svg)](https://github.com/sablectl/schema/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

Schema answers questions about a PostgreSQL database — what is in it, how the
tables relate, how large they are, what a query returns — without being able
to change it. Every statement runs inside a read-only transaction under a
statement timeout, and the result is read through a server-side cursor with a
row limit and a byte budget.

## What it does

- Lists databases, schemas, tables, views, materialised views, partitioned
  tables and sequences, with owners, comments, sizes and row estimates.
- Describes one relation in full: columns, types, defaults, identity and
  generated columns, collations, primary keys, unique and check constraints,
  indexes with their access method and size, outgoing foreign keys and the
  constraints that point back at it.
- Reports foreign-key relationships, including composite keys and their
  referential actions, and writes a Mermaid entity relationship diagram.
  Relationships come from `pg_constraint` only — a column named `user_id`
  with no constraint behind it is a naming convention, not a reference, and
  Schema does not report one.
- Runs read-only queries with positional parameters, and exports rows as CSV
  or JSON.
- Reports server, database, permission and size diagnostics, saying "not
  permitted" where a restricted role cannot see a value rather than printing
  a zero.
- Produces a versioned JSON report for every command, so the output can be
  consumed rather than parsed.

Schema is not a migration tool, an administration console or a general SQL
client. It has no command that changes a database, and will not grow one.

## Requirements

- Node.js 20.19 or later. CI runs 20.19, 22 and 24 on Linux.
- PostgreSQL 12 or later. The catalogue queries read `pg_sequence`, identity
  columns and generated columns, which is where that floor comes from.
  Developed and tested against **17 only**; earlier releases are expected to
  work and are not verified.
- One runtime dependency, [`pg`](https://github.com/brianc/node-postgres).

macOS and Windows are expected to work and are **not** tested.

## Install

Schema is distributed through GitHub only. **It is not published to npm.** If
you find a package by this name on a registry, it is not this project.

### From a release tarball

```sh
base=https://github.com/sablectl/schema/releases/download/v1.0.0
curl -fsSLO "$base/schema-v1.0.0.tar.gz"
curl -fsSLO "$base/schema-v1.0.0.tar.gz.sha256"
sha256sum -c schema-v1.0.0.tar.gz.sha256   # verify before extracting
tar -xzf schema-v1.0.0.tar.gz
cd schema-v1.0.0
npm ci --omit=dev
node dist/bin/schema.js --version
```

Verify the checksum before you run anything. A tarball downloaded over the
network is untrusted input until it has been checked against the SHA-256
published beside it. A checksum proves integrity, not provenance: it defends
against a corrupted or substituted download, not against a compromised
release.

### From source

```sh
git clone https://github.com/sablectl/schema.git
cd schema
npm ci
npm run build
node dist/bin/schema.js --help
```

To put it on `PATH`, link the binary:

```sh
npm link
schema --help
```

## Quick start

Where to connect is resolved in three steps: the individual options first,
then the connection string from `--url` (else `SCHEMA_URL`, else
`DATABASE_URL`), then the standard `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`
and `PGPASSWORD` variables. So `--url … --dbname other` connects to `other`.

There is deliberately no `--password` option: a command-line argument is
visible to every process on the machine and is kept in shell history. Use
`PGPASSWORD`, a connection string, or `--password-env` naming a variable of
your own.

Check what answered:

```console
$ schema connect --url postgresql://postgres@127.0.0.1:5432/shop
Connection
  Server       PostgreSQL 17.9
  Connection   postgresql://postgres@127.0.0.1:5432/shop
  Database     shop
  Role         postgres
  Encryption   none (requested prefer)
  Transaction  read only
  Backend      1620901
```

The encryption line states what was negotiated and what was asked for,
because the two can differ: `prefer` falls back to an unencrypted
connection when the server offers no TLS, and that is worth seeing. A
password, wherever it came from, is shown as `[redacted]`.

See what is there:

```console
$ schema tables
Schema     Name              Kind                Rows (est.)      Size  Comment
---------  ----------------  -----------------  ------------  --------  --------------------------------
Reporting  Daily Totals      table                         0   8.0 KiB
inventory  products          table                         2  48.0 KiB
public     customer_orders   view               not analysed         -
public     customers         table                         3  48.0 KiB  People who have placed an order.
public     events            partitioned table             0       0 B
public     events_2026       table                         0   8.0 KiB
public     order_lines       table                         3  32.0 KiB
public     orders            table                         2  24.0 KiB
public     popular_products  materialised view             2  24.0 KiB
public     shipments         table                         0       0 B

10 relations. Row counts are planner estimates from the last ANALYZE.
```

Look at one table:

```console
$ schema describe orders
public.orders
  Kind   table
  Owner  postgres
  Rows   2 (estimated)
  Size   24.0 KiB

Columns
  #  Name         Type                      Attributes    Default                             Comment
  -  -----------  ------------------------  ------------  ----------------------------------  -------
  1  id           bigint                    PK, not null  nextval('orders_id_seq'::regclass)
  2  customer_id  bigint                    not null
  3  placed_at    timestamp with time zone  not null      now()
  4  total_pence  integer                   not null      0

Constraints
  Name                     Type         Definition
  -----------------------  -----------  -----------------------------------------------------------
  orders_pkey              primary key  PRIMARY KEY (id)
  orders_customer_id_fkey  foreign key  FOREIGN KEY (customer_id) REFERENCES customers(id) …

Indexes
  Name         Method  Unique           Size  Definition
  -----------  ------  -----------  --------  -----------------------------------------------------
  orders_pkey  btree   primary key  16.0 KiB  CREATE UNIQUE INDEX orders_pkey ON public.orders …

Referenced by
  Constraint                 From                Columns
  -------------------------  ------------------  --------
  order_lines_order_id_fkey  public.order_lines  order_id
```

Follow the relationships, including composite keys:

```console
$ schema relations
Constraint                  From                Columns            References          Columns            On update  On delete
--------------------------  ------------------  -----------------  ------------------  -----------------  ---------  ---------
customers_referred_by_fkey  public.customers    referred_by        public.customers    id                 no action  set null
order_lines_order_id_fkey   public.order_lines  order_id           public.orders       id                 no action  cascade
order_lines_sku_fkey        public.order_lines  sku                inventory.products  sku                no action  no action
orders_customer_id_fkey     public.orders       customer_id        public.customers    id                 cascade    restrict
shipments_line_fk           public.shipments    order_id, line_no  public.order_lines  order_id, line_no  no action  cascade

5 relationships. 1 is composite.
```

Ask a question, with values bound as parameters:

```console
$ schema query 'SELECT email, display_name FROM customers WHERE id > $1' --param 1
email               display_name
------------------  ------------------
grace@example.test  NULL
alan@example.test   Alan, "the" tester

2 rows in 1 ms.
```

`NULL` is printed as `NULL` and is distinct from an empty string. Control
characters in data are escaped before they reach the terminal.

## Commands

| Command     | Purpose                                             |
| ----------- | --------------------------------------------------- |
| `connect`   | Open a connection and report what answered.         |
| `databases` | List the databases on this server.                  |
| `schemas`   | List the schemas in the current database.           |
| `tables`    | List tables, views and materialised views.          |
| `describe`  | Show the structure of one table or view.            |
| `relations` | Show declared foreign-key relationships.            |
| `indexes`   | List the indexes on one table.                      |
| `sequences` | List sequences and the columns that own them.       |
| `query`     | Run one read-only statement.                        |
| `export`    | Export rows from one table as CSV or JSON.          |
| `inspect`   | Report server, database and permission diagnostics. |
| `config`    | Show or change the stored settings.                 |

Global options: `-h, --help`, `-v, --version`, `--json`, `-q, --quiet`,
`--no-color`. The full reference is in [docs/commands.md](docs/commands.md).

## Exit codes

| Code | Meaning                                                       |
| ---- | ------------------------------------------------------------- |
| 0    | Success.                                                      |
| 1    | Failure: connection, permission, timeout or query error.      |
| 2    | Usage error: unknown command, unknown flag, invalid argument. |
| 3    | Unexpected internal error (a defect — please report it).      |
| 130  | Interrupted.                                                  |

## Read-only enforcement

Read-only is enforced by PostgreSQL, in three layers:

1. `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` on connect.
2. `BEGIN TRANSACTION READ ONLY` for the life of the command.
3. `statement_timeout`, `lock_timeout` and
   `idle_in_transaction_session_timeout`, so a query cannot run away.

A write therefore fails with SQL state `25006` whatever Schema believes about
the statement. On top of that, Schema will only send `SELECT`, `WITH`,
`TABLE`, `VALUES`, `EXPLAIN` and `SHOW`:

```console
$ schema query "UPDATE customers SET email = 'x'"
error: Schema does not run UPDATE statements.
It opens a read-only transaction and reads; use psql for anything that changes the database.
$ echo $?
1
```

That allow-list is a capability restriction, **not** the security boundary.
It exists because some statements are read-only in the transactional sense
and still unwelcome: `COPY … TO '/path'` writes a file on the server and
`COPY … FROM PROGRAM` runs a command there, and neither is stopped by a
read-only transaction.

A read-only transaction prevents writes. It does not prevent side effects
inside a function, information disclosure, resource exhaustion or
server-side file access by a privileged role. **Connect with a dedicated
read-only role as well**; [docs/read-only-role.md](docs/read-only-role.md)
has the SQL. Never give Schema a superuser.

## Security

- Passwords are never accepted as command-line arguments, never written to
  the configuration file, and replaced with `[redacted]` in every report and
  error message.
- Values are always bound as query parameters. Identifiers, which cannot be
  parameters, are quoted on the way into SQL text, so a table named
  `"; DROP TABLE x; --` is read correctly rather than executed.
- Results are bounded: a statement timeout, a row limit, an output byte
  budget and a server-side cursor instead of buffering an entire result.
- TLS follows the libpq modes. Note that `require` encrypts without verifying
  the certificate and `prefer` falls back to an unencrypted connection; use
  `verify-full` when the identity of the server matters.
- No telemetry, no background network activity, nothing written outside the
  configuration file and files you name.

The threat model, the guarantees and the explicit non-guarantees are in
[docs/security-model.md](docs/security-model.md). To report a vulnerability,
see [SECURITY.md](SECURITY.md).

## Configuration

Settings are optional and hold defaults only — never a credential. The file
is `~/.config/schema/config.json` by default, written atomically at mode
`0600`, and is overridden by `SCHEMA_CONFIG` or `XDG_CONFIG_HOME`.

```sh
schema config show
schema config set maxRows 500
schema config unset maxRows
```

See [docs/configuration.md](docs/configuration.md).

## Documentation

- [Command reference](docs/commands.md)
- [Configuration](docs/configuration.md)
- [Architecture](docs/architecture.md)
- [Security model](docs/security-model.md)
- [Read-only role setup](docs/read-only-role.md)
- [Testing](docs/testing.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Technical debt](docs/technical-debt.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)

## Limitations

- Row counts in listings are planner estimates from the last `ANALYZE`. A
  relation that has never been analysed is reported as "not analysed" rather
  than as zero. `describe --exact-count` counts exactly, at the cost of a
  sequential scan.
- One connection per command, with statements run in sequence. There is no
  pooling and no parallel catalogue reading, so a very large database takes
  proportionally longer to list.
- `EXPLAIN` and `SHOW` cannot be wrapped in a cursor, so their results are
  buffered and the byte budget is applied after the read rather than during
  it.
- Table column widths are measured in code points, so East Asian text is
  under-measured and those columns align imperfectly.
- No interactive shell, no pager, no query history.
- No performance claims are made, because nothing has been benchmarked.

The full list, with what would resolve each item, is in
[docs/technical-debt.md](docs/technical-debt.md).

## Licence and author

Released under the [MIT licence](LICENSE).

Written by Sable (<https://github.com/sablectl>) — <https://sablectl.dev>.
