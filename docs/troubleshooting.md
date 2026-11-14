# Troubleshooting

Each entry below quotes the text the tool prints, then what it means and what
to do. An error is written to stderr as `error: <message>`, followed by a
hint on its own line where one exists. Errors are never coloured.

Where an entry is marked **quoted from source**, the message was read from
the implementation rather than reproduced locally; the reason is given.

## The connection was refused

```text
error: postgres@127.0.0.1:5999/shop refused the connection.
Check that the server is running and that the host and port are right.
```

Raised for `ECONNREFUSED` and `EHOSTUNREACH`. Something answered at the
network layer, or nothing is listening. Check that the server is running,
that the port is the one it listens on, and that a firewall is not in the
way. Exit code 1.

## The host could not be resolved

```text
error: The host in postgres@db.invalid:5432/shop could not be resolved.
```

Raised for `ENOTFOUND` and `EAI_AGAIN`. The name does not resolve, or the
resolver itself is unavailable. Check the spelling, check `/etc/hosts` and
your DNS, and try an address instead of a name to separate the two
possibilities. Exit code 1.

## Authentication failed

```text
error: Authentication failed for postgres@127.0.0.1:55433/shop.
```

SQLSTATE `28P01` or `28000`. The role, the password or the `pg_hba.conf`
entry is wrong. Remember that there is no `--password` option: the password
comes from `PGPASSWORD`, from the connection string, from `.pgpass` or from
the variable named by `--password-env`. If `--password-env` names a variable
that is unset or empty the command fails earlier, with a usage error and exit
code 2. Exit code 1.

## The database does not exist

```text
error: Check the database name.
```

SQLSTATE `3D000`, reported as `not-found`. When no database is given, the
name defaults to the user name, which is a common cause of this on a server
where no such database was created. Pass `--dbname` or put the name in the
connection string, and run `schema databases` to see what exists. Exit code 1.

If the SSL mode is `prefer` and the server does not offer encryption, the
unencrypted retry is the attempt whose error is reported, so a missing
database is reported as a missing database rather than as a TLS problem.

## Permission denied

```text
error: permission denied for table customers
```

SQLSTATE `42501`, reported as `permission-denied`. The role may connect but
may not read this object. Grant `USAGE` on the schema and `SELECT` on the
relation; a `SELECT` grant without `USAGE` on the containing schema is not
enough. See [read-only-role.md](read-only-role.md).

Several commands report a value the role may not see as "not permitted"
rather than failing: the size column in `databases` and the database size in
`inspect` are empty or "not permitted" instead of zero.

## The statement was cancelled by the timeout

```text
error: The statement was cancelled before it finished.
Raise --statement-timeout, or narrow the query.
```

SQLSTATE `57014`, reported as `timeout`. The statement exceeded
`statement_timeout`, which defaults to 15000 ms. Either narrow the query —
add a `WHERE` clause, reduce `--limit`, avoid `describe --exact-count` on a
large table — or raise the budget:

```sh
schema query 'SELECT …' --statement-timeout 60000
```

The same error code covers a connection that did not answer within
`--connect-timeout`. Exit code 1.

A lock held by someone else produces a cancellation sooner: `lock_timeout` is
half the statement timeout, with a floor of 1000 ms.

## The relation is not visible

```console
$ schema describe products
error: No table, view or materialised view named products is visible.
Qualify the name with its schema, or check the search path.
$ echo $?
1
```

The name was resolved through the search path and nothing matched. An
unquoted name is lower-cased to match the server's own folding, so
`describe Products` looks for `products`. Qualify it — `schema describe
inventory.products` — or quote a name whose case matters:
`schema describe '"My Schema"."My Table"'`. `schema tables` lists what is
visible.

## The name is ambiguous

**Quoted from source.** A name visible in more than one schema is an error
rather than a guess, reported as `not-found` with exit code 1. The fixture
database contains no such name and must not be altered, so this one was not
reproduced locally.

Qualify the name with the schema you mean.

## A write statement was refused

```console
$ schema query "UPDATE customers SET email = 'x'"
error: Schema does not run UPDATE statements.
It opens a read-only transaction and reads; use psql for anything that changes the database.
$ echo $?
1
```

The statement began with a recognised write keyword: `INSERT`, `UPDATE`,
`DELETE`, `MERGE`, `TRUNCATE`, `CREATE`, `DROP`, `ALTER`, `GRANT`, `REVOKE`,
`COMMENT`, `REFRESH`, `REINDEX`, `CLUSTER`, `VACUUM`, `ANALYZE`, `IMPORT`,
`CALL` or `DO`. This is by design and there is no option to turn it off. Use
`psql`.

Note that `ANALYZE` the command is refused, while `EXPLAIN ANALYZE` is not:
the classification looks at the leading keyword, and `EXPLAIN` is allowed.
`EXPLAIN ANALYZE` does execute the statement, so use it with the same care
you would in any client.

## COPY was refused

`COPY` is not on the allow-list, so it is a usage error with exit code 2
rather than a read-only violation. The reason is not that `COPY` reads: it is
that `COPY ... TO '/path'` writes a file on the server and
`COPY ... FROM PROGRAM` runs a command there, neither of which is a database
write and neither of which a read-only tool should send. To export data, use
`schema export`, which writes the file on the client at mode `0600`. See
[security-model.md](security-model.md).

## More than one statement was given

```text
error: Give one statement at a time.
```

Exit code 2. The argument contained more than one statement. Run them
separately. This also prevents a second statement being appended after one
that passed classification.

## The result was truncated

```console
$ schema query 'SELECT id FROM customers ORDER BY id' --limit 1
id
--
1

1 row in 2 ms.
More rows were available; raise --limit to read further.
```

Not an error; the exit code is 0. The read stopped at `--limit` rows, which
defaults to the `maxRows` setting of 200, or at the `--max-bytes` budget,
which defaults to 8388608. With `--json` the envelope's `status` is
`truncated` and `truncatedBy` is `"rows"` or `"bytes"`.

One row beyond the limit is probed, so a result that is exactly `--limit`
rows long is reported as complete rather than as truncated.

Raise `--limit`, raise `--max-bytes`, or add a `WHERE` clause. `maxRows` can
be raised permanently:

```sh
schema config set maxRows 1000
```

## The certificate was rejected

**Quoted from source.** The disposable cluster used for these examples is
built without TLS, so this was not reproduced locally.

A TLS failure is reported as `tls-failure` with exit code 1, and the hint
points at `--ssl-root-cert`. It means the server's certificate did not
verify against the authority, or the authority file could not be read.
Check that `--ssl-root-cert` or `PGSSLROOTCERT` points at a readable PEM file
containing the issuing authority, and that the certificate has not expired.
With `verify-full` the server's host name must also match the certificate, so
connecting by address to a certificate issued for a name will fail; connect
by the name, or use `verify-ca` if you accept that the host name is not
checked.

## A configuration value is invalid

```console
$ schema config show
error: /tmp/config.json: "maxRows" must be a non-negative whole number.
$ echo $?
2
```

Every numeric setting must be a finite whole number of zero or more. An empty
string is rejected rather than read as zero, so `--limit=` and
`"maxRows": ""` both fail here.

An unknown key lists the ones that exist:

```text
error: /tmp/config.json: "maxrows" is not a known setting.
Known settings: connectTimeoutMs, includeSystemSchemas, maxCellChars, maxRows, sslMode, statementTimeoutMs.
```

The keys are case sensitive. A file that is not JSON at all is reported as
"is not valid JSON." with the same exit code. `schema config path` prints the
file being read.

`maxCellChars: 0` is valid and disables truncation; it does not hide every
value.

## There is no colour when the output is piped

That is deliberate: colour is disabled when stdout is not a terminal. The
decision is made in this order, first match winning: `--no-color`, then a
non-empty `NO_COLOR`, then `TERM=dumb`, then a `FORCE_COLOR` that is set,
non-empty and not `0`, then whether stdout is a terminal.

To keep colour through a pipe, set `FORCE_COLOR`:

```console
$ FORCE_COLOR=1 schema connect | less -R
```

If colour is still absent, check `NO_COLOR` and `TERM`: both are consulted
before `FORCE_COLOR` and both win over it.

## An internal error

```text
internal error: <message>
```

Exit code 3. This is a defect, not a usage problem. The message is followed
by the address to report it to. Include the command, the server version and
the message.

## Interrupted

Ctrl-C exits 130. If a statement is running on the server, the tool opens a
second connection and calls `pg_cancel_backend` on the first before exiting,
so the backend is not left working on a result nobody will read. The second
connection uses the SSL mode that was actually negotiated, which matters
after a `prefer` fallback.

## Exit codes at a glance

| Code | Meaning                                                       |
| ---- | ------------------------------------------------------------- |
| 0    | Success.                                                      |
| 1    | Failure: connection, permission, timeout or query error.      |
| 2    | Usage error: unknown command, unknown flag, invalid argument. |
| 3    | Unexpected internal error.                                    |
| 130  | Interrupted.                                                  |

The full mapping from error code to exit code is in
[commands.md](commands.md).
