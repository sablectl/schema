# Security model

Schema is a read-only explorer. This document states what that means
precisely: which boundaries are real, which are conveniences and what is not
protected against at all.

## Trust model

The tool trusts:

- the person running it, who already holds the credentials they give it;
- the PostgreSQL server it connects to, and the data that server returns;
- the local machine, its file system and its environment variables.

The tool does not trust:

- the SQL text given to `query`, which is classified before it is sent;
- relation names given on the command line, which are resolved through the
  catalogue and quoted rather than interpolated;
- values given with `--param`, which are always bound as parameters;
- the network between the client and the server, to the degree the chosen
  SSL mode provides.

The threat it is designed against is an operator mistake on a production
database — a stray `UPDATE`, an unbounded `SELECT` that exhausts memory, a
statement that holds a lock — not a malicious operator. An operator with
write privileges and a `psql` binary can write to the database regardless of
what this tool does.

## The read-only layers

Every command runs inside a transaction opened like this:

```sql
SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = <statementTimeoutMs>;
SET LOCAL lock_timeout = <max(1000, floor(statementTimeoutMs / 2))>;
SET LOCAL idle_in_transaction_session_timeout = <max(5000, statementTimeoutMs)>;
```

With the defaults, that is a 15000 ms statement timeout, a 7500 ms lock
timeout and a 15000 ms idle-in-transaction timeout. The session
characteristic is set as well as the transaction, so that a statement which
somehow runs outside the explicit transaction is still read only.

This is enforced by the server, which is what makes it meaningful. An attempt
to write raises SQLSTATE `25006` and the tool reports it as
`read-only-violation`.

**A read-only transaction stops writes. It does not stop anything else.**
Specifically it does not prevent:

- **side effects inside functions.** A `SELECT` that calls a function may
  cause that function to write through `dblink`, a foreign data wrapper, an
  untrusted procedural language or a `SECURITY DEFINER` body. PostgreSQL does
  not forbid a read-only transaction from doing so by these routes.
- **information disclosure.** Everything the role may read, it may read. A
  read-only transaction is not a data-masking layer.
- **resource exhaustion.** A `SELECT` can still consume CPU, memory,
  temporary disk space and I/O on the server, up to the statement timeout.
- **server-side file access.** Functions such as `pg_read_file` and
  `pg_ls_dir` are reads, and are available to a role that has been granted
  them. A superuser role connecting through this tool can read server files.

The remedy for all four is the same: connect with a role that has only the
privileges it needs. See [read-only-role.md](read-only-role.md).

## The statement allow-list

`src/core/statement.ts` classifies the statement given to `query` by its
leading keyword and sends it only if it is one of:

```text
SELECT  WITH  TABLE  VALUES  EXPLAIN  SHOW
```

**This is a capability restriction, not the security boundary.** The boundary
is the read-only transaction and the role's privileges, both enforced by the
server. The allow-list is a client-side filter on top of them, and it is
keyword-based, so it should not be relied on to stop a determined caller.

It exists because the server boundary does not catch everything that matters
to the person running the command. The concrete reasons are:

- `COPY ... TO '/path'` writes a file on the **server**, as the server's
  operating-system user. That is not a database write, so a read-only
  transaction permits it for a role that may use it.
- `COPY ... FROM PROGRAM` executes a command on the server. Likewise not a
  database write.

Neither belongs in a tool whose contract is "it only reads", so neither is
sent.

The refusal distinguishes two cases, and they exit differently:

| Statement                                                                                                                                                                                                            | Error                 | Exit |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---- |
| A recognised write keyword: `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `TRUNCATE`, `CREATE`, `DROP`, `ALTER`, `GRANT`, `REVOKE`, `COMMENT`, `REFRESH`, `REINDEX`, `CLUSTER`, `VACUUM`, `ANALYZE`, `IMPORT`, `CALL`, `DO` | `read-only-violation` | 1    |
| Anything else that is not on the allow-list, including `COPY`                                                                                                                                                        | `usage`               | 2    |

The split is deliberate. A recognised write is a refusal of something the
tool understands and will never do, which is a runtime failure; an
unrecognised keyword is the caller asking for a capability the tool does not
have, which is a usage error.

```console
$ schema query "UPDATE customers SET email = 'x'"
error: Schema does not run UPDATE statements.
It opens a read-only transaction and reads; use psql for anything that changes the database.
$ echo $?
1
```

More than one statement in a single argument is refused with "Give one
statement at a time." and exit code 2, so that a second statement cannot be
smuggled past the classification of the first.

## SQL injection

- Values are never interpolated. `query` binds `--param` values to `$1`,
  `$2` placeholders and the server receives them separately from the
  statement text.
- Identifiers cannot be parameters in PostgreSQL. A relation name is first
  resolved through the catalogue by a parameterised lookup, and the names the
  catalogue returns are then quoted by doubling any embedded double quote.
  The string placed into SQL text is one the server gave us.
- Pattern arguments, such as the `LIKE` pattern for `tables`, are bound as
  parameters.

No part of the tool builds SQL by concatenating text the user supplied.

## Credentials

- There is no `--password` option, because an argument is visible to every
  process on the machine and is kept in shell history. A password comes from
  `PGPASSWORD`, from the connection string, from `.pgpass` or from the
  variable named by `--password-env`.
- `--password-env` fails with exit code 2 when the named variable is unset or
  empty, rather than connecting without a password.
- No credential is written to the configuration file. The file holds six
  defaults and nothing else, is written atomically at mode `0600` in a
  directory created at mode `0700`, and `config set` rejects any key that is
  not one of the six.
- A password is replaced by `[redacted]` in printed connection strings, in
  the JSON report and in error messages.
- A file written by `export --output` is created at mode `0600`. A Mermaid
  diagram from `relations --mermaid` is created at mode `0644`, because it is
  a diagram of structure, not data.

Redaction of free text is **best effort**. It replaces the value in a
`name=value` pair where the name ends in `password`, `passwd` or `pwd`,
which covers `PGPASSWORD=secret` and keyword and value DSNs, and it replaces
the password field of a URL structurally. It cannot recognise a credential
that does not take one of those forms — a bare token in an error message from
the driver, for example. Do not rely on it to make a log safe to publish.

## Resource limits

| Limit                 | Default  | Effect                                    |
| --------------------- | -------- | ----------------------------------------- |
| `--limit`             | 200      | Rows read from a result set.              |
| `--max-bytes`         | 8 MiB    | Approximate byte budget for a result set. |
| `--connect-timeout`   | 10000 ms | Wait for the connection.                  |
| `--statement-timeout` | 15000 ms | Server-side `statement_timeout`.          |
| `--largest`           | 10       | Relations listed by `inspect`.            |
| `--limit` on `tables` | 500      | Relations listed.                         |

Results are read through a server-side cursor in batches, so the row and byte
budgets stop the read rather than trimming a result that has already arrived.
`EXPLAIN` and `SHOW` are the exception: they are buffered, and the byte
budget is applied after the read.

The byte budget is an approximation computed from parsed JavaScript values,
not the number of bytes on the wire. Treat it as a guard against an
accidental enormous result, not as an exact cap.

## Transport security

The SSL mode is chosen by `--ssl-mode`, the `sslmode` URL parameter,
`PGSSLMODE` or the `sslMode` setting, in that order of precedence, and
defaults to `prefer`.

| Mode          | Guarantee                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `disable`     | None. Traffic, including the authentication exchange, is in the clear.                                     |
| `prefer`      | Encrypted if the server offers it, silently unencrypted if not. No certificate verification.               |
| `require`     | Encrypted. No certificate verification, so no protection against an active attacker.                       |
| `verify-ca`   | Encrypted, and the certificate chains to the authority in `--ssl-root-cert`. The host name is not checked. |
| `verify-full` | Encrypted, the chain is verified and the host name is checked.                                             |

Use `verify-full` for anything crossing a network you do not control.
`prefer` and `require` protect against passive observation only.

`prefer` makes one unencrypted retry if the encrypted attempt is rejected. If
that retry also fails, the second error is the one reported, so a missing
database is not misreported as a missing TLS capability. The mode that was
actually negotiated is shown by `connect` and used for the cancellation
connection.

## What is not protected against

Stated plainly, so that nothing here is mistaken for a guarantee:

- A role with write privileges. The tool will not write, but the role can,
  through any other client.
- A role with excessive read privileges. Everything it may read is readable.
- Functions with side effects reached from a `SELECT`.
- Server-side file reads by a role that has been granted them.
- Resource consumption on the server within the statement timeout.
- A compromised local machine. Environment variables, `.pgpass` and the
  terminal are all readable by anything running as the same user.
- A malicious or compromised server. Results are rendered, with control
  characters escaped, but the data itself is trusted.
- Anything the `pg` driver or Node.js itself gets wrong.
- Credentials in forms the free-text redaction does not recognise.

The single most effective control is the role the tool connects as. See
[read-only-role.md](read-only-role.md).
