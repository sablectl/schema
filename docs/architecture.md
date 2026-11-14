# Architecture

Schema is a TypeScript command-line tool compiled to ECMAScript modules and
run on Node.js. It has one runtime dependency. The design is deliberately
small: one connection, one read-only transaction, one statement at a time.

## Module map

```text
src/
  bin/schema.ts      process entry: signals, exit codes, top-level errors
  cli/               argument parsing, option tables, command dispatch
  core/              connection, client, catalogue, query, statement, config
  output/            tables, human text, JSON, CSV, values, colour
  index.ts           the library surface
```

The dependency direction is one way:

```text
bin  ->  cli  ->  core
          |
          +---->  output
```

`cli` is the only layer that knows about both sides. `core` imports neither
`cli` nor `output`: it returns data structures and throws typed errors, and
has no opinion about how either is rendered. That is what makes the core
usable as a library through `src/index.ts`, and what keeps the rendering code
free of database concerns.

`output` imports nothing from `core` either; it is given plain values.

## One runtime dependency

The only runtime dependency is `pg`. The PostgreSQL wire protocol, including
the startup handshake, SCRAM authentication and TLS negotiation, is not
something to reimplement, and `pg` is the mature implementation. Everything
else — argument parsing, table layout, CSV writing, colour, byte and size
formatting — is a small amount of code in this repository rather than a
dependency, because each one of those is less code than the risk of carrying
a transitive tree into a tool that handles credentials.

## One connection, one transaction

Every command opens a single connection, runs

```sql
SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;
BEGIN TRANSACTION READ ONLY;
```

and does all of its work inside that transaction before closing. There is no
pool and no second connection on the happy path. The consequences are
deliberate: the catalogue reads a command makes are consistent with each
other, because they see one snapshot; a command cannot leave a transaction
open; and the cost of a command is one connection, which a restricted
reporting role can afford.

The catalogue reads inside one command are issued in sequence. Nothing is
read in parallel.

### The three enforcement layers

Inside the transaction, three settings bound what a statement can do:

```sql
SET LOCAL statement_timeout = <statementTimeoutMs>;
SET LOCAL lock_timeout = <max(1000, floor(statementTimeoutMs / 2))>;
SET LOCAL idle_in_transaction_session_timeout = <max(5000, statementTimeoutMs)>;
```

`statement_timeout` bounds the statement, `lock_timeout` stops a command
queueing behind someone else's lock for the whole of that budget, and
`idle_in_transaction_session_timeout` ensures that a command which stops
making progress cannot pin a snapshot and block vacuum indefinitely. The
derived values are floors, not ratios of a tunable: a half-second lock wait
would be too short to be useful whatever the statement timeout is.

These are the server-side layers. The statement allow-list in
`src/core/statement.ts` is a separate, client-side capability restriction;
see [security-model.md](security-model.md) for why it is not the boundary.

## Reading the catalogue

Catalogue queries read `pg_catalog` directly — `pg_class`, `pg_namespace`,
`pg_attribute`, `pg_constraint`, `pg_index`, `pg_sequence` — rather than
`information_schema`. Three reasons:

- `information_schema` only shows objects the role has a privilege on, which
  silently hides rows and makes "there is no such table" indistinguishable
  from "you may not see it".
- It has no representation for several things the tool reports: relation
  kind beyond the SQL standard set, `reltuples`, relation size, index method,
  partitioning and materialised views.
- Its views are themselves joins over `pg_catalog` and are measurably slower
  on a large catalogue.

The cost is that the queries are PostgreSQL-specific, which this tool already
is, and that they must be checked against each supported server version.

## Identifiers and values

The two are never confused.

A **value** is always bound as a parameter. The `query` command takes `$1`,
`$2` placeholders and `--param` values and passes them to the server
separately from the statement text; the values are never interpolated.

An **identifier** cannot be a parameter in PostgreSQL, so a relation name
that reaches SQL text — in `export`, in `describe --exact-count` — is first
resolved through the catalogue by parameterised lookup, and the resolved
schema and relation names are then quoted with the standard rule: wrap in
double quotes and double any embedded double quote. The name that is quoted
is one the catalogue returned, not one the user typed.

Name resolution itself follows the server's own folding: an unquoted part is
lower-cased, a quoted part is taken literally, an unqualified name is
resolved through the search path, and a name visible in two schemas is an
error rather than a guess.

## Reading a result set

`query` and `export` read through a server-side cursor named `schema_result`,
in batches, so that a large result never arrives in memory in one piece.

```sql
SAVEPOINT schema_declare;
DECLARE schema_result NO SCROLL CURSOR FOR <statement>;
```

The savepoint exists because not every statement can be declared as a cursor.
If `DECLARE` fails, the transaction is rolled back to `schema_declare` — which
leaves the transaction usable rather than aborted — and the statement is run
buffered instead.

Rows are fetched in batches of 100 and accumulated against two budgets:

| Budget | Default         | Option        |
| ------ | --------------- | ------------- |
| rows   | 200             | `--limit`     |
| bytes  | 8388608 (8 MiB) | `--max-bytes` |

One extra row beyond the row limit is requested. That probe row is never
printed; it exists only to distinguish "the result happens to be exactly
`--limit` rows" from "the result was cut off". Without it the two are
indistinguishable, and a report that says `truncated` when the data was
complete is a report that cannot be trusted. `truncatedBy` in the JSON report
is `"rows"`, `"bytes"` or `null`.

The byte budget is approximated from the parsed JavaScript values, not from
the wire size; see [technical-debt.md](technical-debt.md).

### The buffered fallback

`EXPLAIN` and `SHOW` cannot be wrapped in a cursor. They are run directly and
the whole result is held in memory, with the byte budget applied after the
read rather than during it. The JSON report sets `buffered` to `true` so that
a consumer knows the budget was retrospective.

## Cancellation

Ctrl-C does not kill the process while a statement is running on the server;
that would leave the backend working on a result nobody will read. Instead
the tool opens a **second** connection, with application name
`schema (cancel)` and a 5000 ms connect timeout, and runs

```sql
SELECT pg_cancel_backend($1)
```

with the backend process identifier of the first connection. The second
connection is made with the SSL mode that the first connection actually
negotiated, not the one that was requested: after a `prefer` fallback to an
unencrypted connection, asking for encryption again would simply fail and the
cancellation would not be delivered.

The process then exits 130.

## Redaction

Redaction lives in `src/core/redact.ts` and is applied on the way **out** of
the core: to the connection string the core reports, and to the message of
every error the core raises. Doing it at the boundary rather than at each
print site means a new output format, or a library consumer, cannot forget
it. A URL's password field is replaced structurally; free text is matched on
the `name=value` form for names ending in `password`, `passwd` or `pwd`,
which covers `PGPASSWORD=…` and keyword and value DSNs.

## Tests

Two Vitest projects:

- **unit** — argument parsing, option validation, configuration loading and
  writing, statement classification, redaction, error mapping, table layout,
  value formatting, CSV and JSON output. No database.
- **integration** — the commands end to end against a real server.

The integration project creates its own disposable cluster: `initdb` into a
temporary directory, `pg_ctl` on a free loopback port with trust
authentication, the fixture in `tests/fixtures/shop.sql` loaded into it, and
the whole directory removed afterwards. It never touches an existing server.
See [testing.md](testing.md).

## Build and release

`tsc` compiles `src/` to `dist/`, preserving the layout, so the entry point
is `dist/bin/schema.js`. `npm run verify` runs the type check, the linter,
the formatter check and both test projects.

A release tarball contains `dist`, `package.json`, `package-lock.json`,
`README.md`, `LICENSE` and `CHANGELOG.md`, and nothing else. It is built as a
reproducible tar with fixed metadata and published with its SHA-256 digest,
and the release job smoke-tests the extracted `dist/bin/schema.js` before
publishing.
