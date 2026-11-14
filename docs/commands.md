# Command reference

Every command opens one connection, runs inside a single read-only
transaction and closes the connection when it finishes. The examples below
were run against the fixture database in `tests/fixtures/shop.sql`.

Invoke the tool as `schema` if it is on your path, or as
`node dist/bin/schema.js` from a build tree. The two are interchangeable.

## Global options

These are accepted by every command.

| Option            | Default | Effect                                                        |
| ----------------- | ------- | ------------------------------------------------------------- |
| `-h`, `--help`    | off     | Print the help for the command and exit 0.                    |
| `-v`, `--version` | off     | Print the release number and exit 0.                          |
| `--json`          | off     | Write a JSON report to stdout instead of a table.             |
| `-q`, `--quiet`   | off     | Suppress confirmation lines written by `export` and `config`. |
| `--no-color`      | off     | Never colour the output.                                      |

`--quiet` affects the confirmation lines only: the "2 row(s) written to …"
line from `export` and the acknowledgement printed by `config set` and
`config unset`. Summary lines that belong to a listing, such as
"10 relations.", are part of the result and are still printed. Use `--json`
when the output is to be consumed by a program.

`--json` is not honoured by `export`, whose format is chosen with
`--format`, and it may not be combined with `query --csv`.

## Connection options

These are accepted by every command except `config`, which never connects.

| Option                     | Default               | Effect                                                        |
| -------------------------- | --------------------- | ------------------------------------------------------------- |
| `--url <URL>`              | unset                 | Connection string, `postgresql://user@host:5432/database`.    |
| `-H`, `--host <HOST>`      | `localhost`           | Server host name or address.                                  |
| `-p`, `--port <PORT>`      | `5432`                | Server port. 1 to 65535.                                      |
| `-d`, `--dbname <NAME>`    | the user name         | Database name.                                                |
| `-U`, `--user <NAME>`      | `PGUSER`, then `USER` | Role to connect as.                                           |
| `--password-env <NAME>`    | unset                 | Read the password from this environment variable.             |
| `--ssl-mode <MODE>`        | `prefer`              | `disable`, `prefer`, `require`, `verify-ca` or `verify-full`. |
| `--ssl-root-cert <PATH>`   | `PGSSLROOTCERT`       | PEM certificate authority for `verify-ca` and `verify-full`.  |
| `--connect-timeout <MS>`   | `10000`               | Milliseconds to wait for the connection.                      |
| `--statement-timeout <MS>` | `15000`               | Milliseconds a single statement may run.                      |

There is no `--password` option. A command-line argument is visible to every
process on the machine and is kept in shell history, so a password is read
from `PGPASSWORD`, from the connection string, from a `.pgpass` file or from
the variable named by `--password-env`. The defaults for the two timeouts
and for the SSL mode come from the configuration file when it sets them; see
[configuration.md](configuration.md) for the resolution order in full.

Short options do not bundle: write `-U postgres -d shop`, not `-Ud`. A value
may be given as `--limit 10` or `--limit=10`. Everything after `--` is taken
as a positional argument.

## connect

```text
schema connect [connection options]
```

Opens a connection and reports what answered: the server version, the
database, the role, whether the connection is encrypted and that the
transaction is read only. Nothing else is read, so it works with the most
restricted role available.

```console
$ schema connect --url postgresql://postgres@127.0.0.1:55433/shop
Connection
  Server       PostgreSQL 17.9
  Connection   postgresql://postgres@127.0.0.1:55433/shop
  Database     shop
  Role         postgres
  Encryption   none (requested prefer)
  Transaction  read only
  Backend      1625824
```

The encryption line states both what was negotiated and what was asked for,
because the two can differ. A password, wherever it came from, is shown as
`[redacted]`.

Options: the connection options and the global options.

## databases

```text
schema databases [connection options]
```

Lists the databases on the server, excluding templates. The size column is
empty where the role may not connect to that database, rather than zero.

```console
$ schema databases
Name      Owner     Encoding     Size  Notes
--------  --------  --------  -------  -------
postgres  postgres  UTF8      7.6 MiB
shop      postgres  UTF8      8.1 MiB  current

2 databases.
```

Options: the connection options and the global options.

## schemas

```text
schema schemas [connection options]
```

Lists the schemas the role may use, with the number of tables, views and
materialised views in each.

```console
$ schema schemas
Name       Owner              Tables  Views  Mat. views  Comment
---------  -----------------  ------  -----  ----------  -------------------------
Reporting  postgres                1      0           0
inventory  postgres                1      0           0  Stock and catalogue data.
public     pg_database_owner       6      1           1  standard public schema

3 schemas.
```

| Option     | Default | Effect                                             |
| ---------- | ------- | -------------------------------------------------- |
| `--system` | off     | Include `pg_catalog` and the other system schemas. |

## tables

```text
schema tables [PATTERN] [connection options]
```

Lists tables, views, materialised views, partitioned tables and foreign
tables. `PATTERN` is matched with SQL `LIKE` against the relation name, so
`%` and `_` are wildcards.

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

Row counts come from `pg_class.reltuples`. A relation that has never been
analysed is reported as "not analysed", which is a different statement from
zero. Use `describe --exact-count` for a counted figure.

| Option                  | Default | Effect                                                                          |
| ----------------------- | ------- | ------------------------------------------------------------------------------- |
| `-s`, `--schema <NAME>` | unset   | Restrict the listing to one schema.                                             |
| `--kind <KIND>`         | all     | Restrict to `table`, `view`, `matview`, `partitioned` or `foreign`. Repeatable. |
| `--system`              | off     | Include the system schemas.                                                     |
| `-n`, `--limit <N>`     | `500`   | Maximum relations to list.                                                      |

`materialised view` is accepted as a spelling of `matview`. When exactly
`--limit` rows are returned the JSON report has status `truncated`.

```console
$ schema tables 'order%' --schema public
Schema  Name         Kind   Rows (est.)      Size  Comment
------  -----------  -----  -----------  --------  -------
public  order_lines  table            3  32.0 KiB
public  orders       table            2  24.0 KiB

2 relations. Row counts are planner estimates from the last ANALYZE.
```

## describe

```text
schema describe TABLE [connection options]
```

Shows one relation in full: columns with types, attributes, defaults and
comments; constraints; indexes; outgoing foreign keys; and the constraints
that point back at it.

`TABLE` may be qualified, quoted, or both: `users`, `public.users` and
`"My Schema"."My Table"` are all accepted. An unquoted part is lower-cased
to match the server's own folding. An unqualified name is resolved through
the search path, and a name visible in two schemas is an error rather than a
guess.

```console
$ schema describe customers
public.customers
  Kind     table
  Owner    postgres
  Rows     3 (estimated)
  Size     48.0 KiB
  Comment  People who have placed an order.

Columns
  #  Name          Type                      Attributes                     Default  Comment
  -  ------------  ------------------------  -----------------------------  -------  -------------------
  1  id            bigint                    PK, not null, identity always
  2  email         text                      not null                                Lower case, unique.
  3  display_name  text
  4  referred_by   bigint
  5  created_at    timestamp with time zone  not null                       now()

Constraints
  Name                        Type         Definition
  --------------------------  -----------  ---------------------------------------------------------------------
  customers_pkey              primary key  PRIMARY KEY (id)
  customers_email_key         unique       UNIQUE (email)
  customers_referred_by_fkey  foreign key  FOREIGN KEY (referred_by) REFERENCES customers(id) ON DELETE SET NULL
  customers_email_lowercase   check        CHECK ((email = lower(email)))

Indexes
  Name                 Method  Unique           Size  Definition
  -------------------  ------  -----------  --------  -------------------------------------------------------------------------------
  customers_pkey       btree   primary key  16.0 KiB  CREATE UNIQUE INDEX customers_pkey ON public.customers USING btree (id)
  customers_email_key  btree   yes          16.0 KiB  CREATE UNIQUE INDEX customers_email_key ON public.customers USING btree (email)

Referenced by
  Constraint                  From              Columns
  --------------------------  ----------------  -----------
  customers_referred_by_fkey  public.customers  referred_by
  orders_customer_id_fkey     public.orders     customer_id
```

| Option          | Default | Effect                                              |
| --------------- | ------- | --------------------------------------------------- |
| `--exact-count` | off     | Count the rows exactly. This reads the whole table. |

`--exact-count` runs `SELECT count(*)`, which is a sequential scan on most
relations, and is ignored for a foreign table. The heading then reads
"(exact)" instead of "(estimated)":

```console
$ schema describe inventory.products --exact-count
inventory.products
  Kind   table
  Owner  postgres
  Rows   2 (exact)
  Size   48.0 KiB
```

## relations

```text
schema relations [TABLE] [connection options]
```

Reports declared foreign-key relationships. With no table, every foreign key
in the database is listed; with a table, its outgoing and incoming keys are
listed. Relationships come from `pg_constraint` only: a column named
`user_id` with no constraint behind it is a naming convention, not a
reference, and none is reported.

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

| Option                  | Default | Effect                                                 |
| ----------------------- | ------- | ------------------------------------------------------ |
| `-s`, `--schema <NAME>` | unset   | Restrict the listing to one schema.                    |
| `--system`              | off     | Include the system schemas.                            |
| `--mermaid <PATH>`      | unset   | Also write a Mermaid entity relationship diagram here. |

Cardinality in the diagram is read from the catalogue, not guessed: a
referencing side covered by a unique or primary key constraint is one,
otherwise many, and a nullable referencing column makes the parent side
optional. A name Mermaid cannot carry is replaced by a deterministic
substitute rather than written out and left to break the diagram.

```console
$ schema relations --mermaid shop.mmd
```

```text
erDiagram
  public_customers |o--o{ public_customers : "referred_by"
  public_orders ||--o{ public_order_lines : "order_id"
  inventory_products ||--o{ public_order_lines : "sku"
  public_customers ||--o{ public_orders : "customer_id"
  public_order_lines ||--o{ public_shipments : "order_id, line_no"
```

The diagram file is written with mode `0644`.

## indexes

```text
schema indexes TABLE [connection options]
```

Lists the indexes on one relation with their access method, uniqueness,
validity and size.

```console
$ schema indexes orders
Indexes on public.orders
  Name         Method  Unique           Size  Definition
  -----------  ------  -----------  --------  -----------------------------------------------------------------
  orders_pkey  btree   primary key  16.0 KiB  CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id)

1 index.
```

Options: the connection options and the global options.

## sequences

```text
schema sequences [connection options]
```

Lists sequences with their data type, start value, increment, whether they
cycle and the column that owns them.

```console
$ schema sequences
Schema     Name              Type    Start  Increment  Cycles  Owned by
---------  ----------------  ------  -----  ---------  ------  -------------------
inventory  restock_seq       bigint    100          5  no
public     customers_id_seq  bigint      1          1  no      public.customers.id
public     events_id_seq     bigint      1          1  no      public.events.id
public     orders_id_seq     bigint      1          1  no      public.orders.id

4 sequences.
```

| Option                  | Default | Effect                              |
| ----------------------- | ------- | ----------------------------------- |
| `-s`, `--schema <NAME>` | unset   | Restrict the listing to one schema. |
| `--system`              | off     | Include the system schemas.         |

The current value of a sequence is not read; the listing describes the
sequence's definition only.

## query

```text
schema query SQL [--param VALUE]... [connection options]
```

Runs one statement in the read-only transaction and prints the rows. Values
are bound as parameters: write `$1`, `$2` in the SQL and pass each value
with `--param`, in order. Never build SQL by concatenating untrusted text.

```console
$ schema query 'SELECT email, display_name FROM customers WHERE id > $1' --param 1
email               display_name
------------------  ------------------
grace@example.test  NULL
alan@example.test   Alan, "the" tester

2 rows in 1 ms.
```

`NULL` is printed as `NULL` and is distinct from an empty string. Control
characters in data are escaped before they reach the terminal, timestamps
are printed in UTC as ISO 8601, and `bytea` is printed as `\x` followed by
hex.

| Option              | Default   | Effect                                             |
| ------------------- | --------- | -------------------------------------------------- |
| `-n`, `--limit <N>` | `200`     | Maximum rows to read.                              |
| `--max-bytes <N>`   | `8388608` | Approximate byte budget for the result.            |
| `--param <VALUE>`   | none      | A value for the next `$n` placeholder. Repeatable. |
| `--csv`             | off       | Write the rows as CSV.                             |

`--limit` defaults to the `maxRows` setting. When a limit stops the read
before the result is exhausted, a line says so:

```console
$ schema query 'SELECT id FROM customers ORDER BY id' --limit 1
id
--
1

1 row in 2 ms.
More rows were available; raise --limit to read further.
```

`--csv` writes RFC 4180 with CRLF line endings. A SQL NULL is an empty
unquoted field, as PostgreSQL's own `COPY ... TO ... CSV` writes it, so an
empty string and a NULL remain distinguishable. `--csv` and `--json` may not
be given together.

```console
$ schema query 'SELECT sku, title, price_pence FROM inventory.products ORDER BY sku' --csv
sku,title,price_pence
SKU-1,Desk lamp,2599
SKU-2,Notebook,450
```

Only `SELECT`, `WITH`, `TABLE`, `VALUES`, `EXPLAIN` and `SHOW` are sent to
the server; see [security-model.md](security-model.md) for why. `EXPLAIN`
and `SHOW` cannot be wrapped in a cursor, so their results are buffered and
the byte budget is applied after the read rather than during it; the JSON
report says so in `buffered`.

## export

```text
schema export TABLE [connection options]
```

Reads up to `--limit` rows from one relation and writes them as CSV or JSON.
The relation name is resolved exactly as `describe` resolves it, and is
quoted into the SQL text rather than interpolated raw.

| Option                  | Default   | Effect                                  |
| ----------------------- | --------- | --------------------------------------- |
| `-n`, `--limit <N>`     | `200`     | Maximum rows to read.                   |
| `--max-bytes <N>`       | `8388608` | Approximate byte budget for the result. |
| `--format <FORMAT>`     | `csv`     | `csv` or `json`.                        |
| `-o`, `--output <PATH>` | stdout    | Write to this file instead of stdout.   |

```console
$ schema export inventory.products --format json -n 2
[
  {
    "sku": "SKU-1",
    "title": "Desk lamp",
    "price_pence": 2599,
    "price_pounds": "25.9900000000000000",
    "tags": [
      "lighting",
      "home"
    ]
  },
  {
    "sku": "SKU-2",
    "title": "Notebook",
    "price_pence": 450,
    "price_pounds": "4.5000000000000000",
    "tags": [
      "stationery"
    ]
  }
]
```

`numeric` is carried as a string so that precision is not lost. A file named
with `--output` is written at mode `0600` and the row count is reported on
stderr unless `--quiet` is given:

```console
$ schema export inventory.products -o products.csv
2 row(s) written to products.csv.
```

`--json` has no effect on `export`; use `--format json`.

## inspect

```text
schema inspect [connection options]
```

Reports server, database and permission diagnostics: version, role,
superuser status, encoding, time zone, search path, the read-only state of
the transaction, the statement timeout, database size, the largest
relations, installed extensions and a fixed set of server settings. A value
the role may not see is reported as "not permitted" rather than as zero.

```console
$ schema inspect
Server
  Version            17.9
  Database           shop
  Role               postgres
  Superuser          yes
  Encoding           UTF8
  Time zone          America/New_York
  Search path        "$user", public
  Transaction        read only
  Statement timeout  15s
  Database size      8.1 MiB
  Contents           3 schemas, 8 tables

Largest relations
  Schema     Name                 Total     Table   Indexes
  ---------  ----------------  --------  --------  --------
  inventory  products          48.0 KiB  16.0 KiB  32.0 KiB
  public     customers         48.0 KiB  16.0 KiB  32.0 KiB
  ...
```

| Option          | Default | Effect                                     |
| --------------- | ------- | ------------------------------------------ |
| `--largest <N>` | `10`    | How many of the largest relations to list. |

The settings reported are `server_version`, `server_encoding`, `TimeZone`,
`search_path`, `statement_timeout`, `lock_timeout`,
`idle_in_transaction_session_timeout`, `default_transaction_read_only`,
`max_connections`, `shared_buffers`, `work_mem` and `ssl`.

## config

```text
schema config show|path|set KEY VALUE|unset KEY
```

Shows or changes the stored settings. This command never connects to a
database. The file holds defaults only: no connection string, user name or
password is ever written to it.

```console
$ schema config show
No configuration file yet; /home/user/.config/schema/config.json would be used.
  connectTimeoutMs      10000  (default)
  includeSystemSchemas  false  (default)
  maxCellChars          120  (default)
  maxRows               200  (default)
  sslMode               prefer  (default)
  statementTimeoutMs    15000  (default)
$ schema config set maxRows 500
maxRows = 500  (/home/user/.config/schema/config.json)
$ schema config unset maxRows
maxRows reset to 200  (/home/user/.config/schema/config.json)
$ schema config path
/home/user/.config/schema/config.json
```

With no subcommand, `show` is assumed. The settings themselves are described
in [configuration.md](configuration.md).

## Exit codes

| Code | Meaning                                                       |
| ---- | ------------------------------------------------------------- |
| 0    | Success.                                                      |
| 1    | Failure: connection, permission, timeout or query error.      |
| 2    | Usage error: unknown command, unknown flag, invalid argument. |
| 3    | Unexpected internal error (a defect — please report it).      |
| 130  | Interrupted.                                                  |

Every failure a user can cause carries one of the error codes below, and
each maps to a fixed exit code.

| Error code              | Exit | Raised when                                                            |
| ----------------------- | ---- | ---------------------------------------------------------------------- |
| `usage`                 | 2    | Unknown command or option, missing argument, bad value.                |
| `invalid-connection`    | 2    | A connection string or `PGSSLMODE` that cannot be used.                |
| `config-invalid`        | 2    | A setting with the wrong type, or an unknown setting.                  |
| `connection-failed`     | 1    | Refused, unreachable or unresolvable host; server out of connections.  |
| `authentication-failed` | 1    | SQLSTATE `28P01` or `28000`.                                           |
| `tls-failure`           | 1    | The certificate was rejected, or the authority file could not be read. |
| `timeout`               | 1    | SQLSTATE `57014`, or the connection did not answer in time.            |
| `query-failed`          | 1    | Any other error reported by the server.                                |
| `read-only-violation`   | 1    | SQLSTATE `25006`, or a writing statement was refused.                  |
| `permission-denied`     | 1    | SQLSTATE `42501`.                                                      |
| `not-found`             | 1    | SQLSTATE `3D000`, `42P01` or `42703`; an unresolved or ambiguous name. |
| `limit-exceeded`        | 1    | A configured limit stopped the command.                                |
| `export-failed`         | 1    | The export could not be written.                                       |
| `cancelled`             | 130  | The command was interrupted.                                           |

An error is printed to stderr as `error: <message>`, followed by a hint on
its own line where one exists. Errors are never coloured. An unexpected
exception prints `internal error: <message>` with a request to report it and
exits 3.

```console
$ schema query "UPDATE customers SET email = 'x'"
error: Schema does not run UPDATE statements.
It opens a read-only transaction and reads; use psql for anything that changes the database.
$ echo $?
1
```

## The JSON report

With `--json`, the command writes one JSON document to stdout inside a
versioned envelope. `schemaVersion` is independent of the release number, so
a consumer can detect a breaking change without matching on `version`.

```json
{
  "schemaVersion": 1,
  "tool": "schema",
  "version": "1.0.0",
  "command": "schemas",
  "generatedAt": "2026-11-14T14:14:47.332Z",
  "status": "ok",
  "result": {}
}
```

| Field           | Type                               | Meaning                                          |
| --------------- | ---------------------------------- | ------------------------------------------------ |
| `schemaVersion` | number                             | Envelope version. `1` in this release.           |
| `tool`          | `"schema"`                         | Constant.                                        |
| `version`       | string                             | Release number of the tool.                      |
| `command`       | string                             | The command as it was named on the command line. |
| `generatedAt`   | string                             | ISO 8601 timestamp in UTC.                       |
| `status`        | `"ok"`, `"empty"` or `"truncated"` | Whether the result is complete.                  |
| `result`        | object                             | The per-command shape below.                     |

`empty` means the command found nothing; `truncated` means a limit stopped
the read before the result was exhausted.

### connect

`result` holds `url` (with the password replaced by `[redacted]` when one is
in use), `host`, `port`, `database`, `user`, `sessionUser`, `serverVersion`,
`serverVersionNum`, `backendPid`, `sslMode` (requested), `sslModeUsed`
(negotiated) and `tls`, which is `null` on an unencrypted connection and
otherwise `{ "version": …, "cipher": … }`.

### databases

`result.databases` is an array of `name`, `owner`, `encoding`, `collate`,
`connectable`, `isCurrent` and `sizeBytes`. `sizeBytes` is `null` where the
role may not connect to that database.

### schemas

`result.schemas` is an array of `name`, `owner`, `comment`, `tables`,
`views`, `materialisedViews` and `isSystem`.

### tables

`result.relations` is an array of `schema`, `name`, `kind`, `owner`,
`estimatedRows`, `sizeBytes` and `comment`. `kind` is one of `table`,
`view`, `materialised view`, `partitioned table` or `foreign table`.
`estimatedRows` is `null` when the relation has never been analysed.

### describe

`result` holds `relation` (the same shape as one entry of `tables`),
`exactRows` (`null` unless `--exact-count` was given), `partitionOf`,
`columns`, `constraints`, `indexes`, `foreignKeys` and `referencedBy`.

- A column is `position`, `name`, `type`, `nullable`, `defaultValue`,
  `identity` (`a`, `d` or `null`), `generated` (`s` or `null`), `collation`
  and `comment`.
- A constraint is `name`, `type` (`primary key`, `foreign key`, `unique`,
  `check` or `other`), `definition` and `columns`.
- An index is `name`, `definition`, `method`, `isUnique`, `isPrimary`,
  `isValid` and `sizeBytes`.
- A foreign key is `name`, `schema`, `table`, `columns`,
  `referencedSchema`, `referencedTable`, `referencedColumns`, `onUpdate`,
  `onDelete`, `matchType` and `composite`.

### relations

`result.relationships` is an array of foreign keys in the shape above, and
`result.mermaidFile` is the path written or `null`.

### indexes

`result.relation` is `{ schema, name, kind }` and `result.indexes` is an
array of indexes in the shape above.

### sequences

`result.sequences` is an array of `schema`, `name`, `dataType`,
`startValue`, `increment`, `minimumValue`, `maximumValue`, `cycles` and
`ownedBy`. The numeric fields are strings, because a sequence bound does not
fit a JavaScript number.

### query

```json
{
  "statement": "SELECT id FROM customers ORDER BY id",
  "parameterCount": 0,
  "columns": [{ "name": "id", "dataTypeId": 20 }],
  "rows": [["1"]],
  "rowCount": 1,
  "truncatedBy": "rows",
  "buffered": false,
  "approximateBytes": 1,
  "durationMs": 1.59
}
```

The statement is echoed; the parameter values are not, because a parameter
is where a credential or a personal detail is most likely to be. Only the
count is reported. `truncatedBy` is `"rows"`, `"bytes"` or `null`.
`buffered` is true when the statement could not be read through a cursor.

### inspect

`result` holds `serverVersion`, `database`, `currentRole`, `sessionRole`,
`isSuperuser`, `searchPath`, `timeZone`, `encoding`, `transactionReadOnly`,
`statementTimeout`, `databaseSizeBytes` (`null` when not permitted),
`schemaCount`, `tableCount`, `extensions`, `largestRelations` and
`settings`.

### config

`result` holds `path`, `exists`, `settings` (every setting with defaults
filled in) and `stored` (only what the file sets).

### export

`export` writes CSV or a JSON array of row objects, not an envelope. The
JSON form is an array of objects keyed by column name.
