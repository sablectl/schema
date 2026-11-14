# Configuration

Schema takes its connection target from the command line, from a connection
string or from the usual PostgreSQL environment variables, and takes a small
number of defaults from a configuration file. Nothing else is read. The file
holds defaults only; no credential is ever written to it.

## How a connection target is resolved

Three sources are consulted, in this order. The first one that supplies a
given field wins, so an explicit option always beats a connection string, and
a connection string always beats the environment.

1. The command-line options: `--host`, `--port`, `--dbname`, `--user`,
   `--ssl-mode`, `--ssl-root-cert`, `--connect-timeout`,
   `--statement-timeout` and `--password-env`.
2. The connection string: `--url` if given, otherwise `SCHEMA_URL`,
   otherwise `DATABASE_URL`.
3. The environment: `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`,
   `PGSSLMODE` and `PGSSLROOTCERT`.

Whatever is still unset after those three falls back to a default:

| Field             | Default                                           |
| ----------------- | ------------------------------------------------- |
| host              | `localhost`                                       |
| port              | `5432`                                            |
| user              | `PGUSER`, then `USER`                             |
| database          | the user name                                     |
| application name  | `schema`                                          |
| SSL mode          | the `sslMode` setting, which defaults to `prefer` |
| connect timeout   | the `connectTimeoutMs` setting, 10000 ms          |
| statement timeout | the `statementTimeoutMs` setting, 15000 ms        |

If no user name can be found in any source and `USER` is unset, the command
fails with "No database user was given." and exit code 2.

A library caller that constructs a target directly receives the same two
timeout defaults, 10000 ms and 15000 ms, when it omits them.

### The connection string

A `postgresql://` or `postgres://` URL is parsed for user, password, host,
port and database. Only these query parameters are accepted: `sslmode`,
`application_name`, `dbname`, `host`, `port` and `user`. Any other parameter
is rejected with `invalid-connection` and exit code 2, rather than being
ignored, so that a mistyped option is never silently dropped.

A value that is not a URL is treated as a keyword and value DSN of the
`host=… dbname=…` form.

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

An unsupported `PGSSLMODE` is only an error when nothing overrides it; an
explicit `--ssl-mode` or an `sslmode` parameter in the URL takes precedence
and the environment value is never consulted.

## Passwords

There is no `--password` option, and there will not be one. A command-line
argument is visible in `/proc` to every process on the machine, is recorded in
shell history and is copied into any process listing. A password therefore
comes from one of:

- `PGPASSWORD`;
- the password field of the connection string;
- a `.pgpass` file, read by `libpq` conventions through the driver;
- the environment variable named by `--password-env`.

`--password-env NAME` reads the variable called `NAME`. If it is unset or
empty the command fails with a usage error and exit code 2, so a typo in the
variable name cannot quietly become a passwordless connection attempt.

```sh
read -rs -p 'password: ' SCHEMA_PW && export SCHEMA_PW
schema connect --host db.internal --user reporting --password-env SCHEMA_PW
```

Wherever a password came from, it is replaced by `[redacted]` in every
printed connection string, in the JSON report and in error messages. The
redaction of free text also covers `PGPASSWORD=…` and other names ending in
`password`, `passwd` or `pwd`; see
[security-model.md](security-model.md) for its limits.

## The configuration file

The path is the first of these that is set:

1. `SCHEMA_CONFIG`;
2. `$XDG_CONFIG_HOME/schema/config.json`;
3. `~/.config/schema/config.json`.

`schema config path` prints the path that would be used, whether or not the
file exists.

The file is JSON, one object of settings. It is written by writing a
temporary file in the same directory and renaming it over the target, so a
reader never sees a half-written file. The file is created at mode `0600` and
the directory at mode `0700`.

No connection string, host, user name or password is ever written to the
file. `config set` accepts the six settings below and nothing else.

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
```

`config` never connects to a database.

## Settings

| Setting                | Type    | Default  | Valid values               | Effect                                                                      |
| ---------------------- | ------- | -------- | -------------------------- | --------------------------------------------------------------------------- |
| `connectTimeoutMs`     | number  | `10000`  | whole number, 0 or greater | Milliseconds to wait for a connection. Default for `--connect-timeout`.     |
| `statementTimeoutMs`   | number  | `15000`  | whole number, 0 or greater | Milliseconds a single statement may run. Default for `--statement-timeout`. |
| `maxRows`              | number  | `200`    | whole number, 0 or greater | Default for `--limit` in `query` and `export`.                              |
| `maxCellChars`         | number  | `120`    | whole number, 0 or greater | Longest cell printed in a table before truncation.                          |
| `sslMode`              | string  | `prefer` | the five modes below       | Default for `--ssl-mode`.                                                   |
| `includeSystemSchemas` | boolean | `false`  | `true` or `false`          | Default for `--system` on the listing commands.                             |

A numeric setting must be a finite whole number that is zero or greater. A
fractional value, a negative value, a non-numeric string and an empty string
are all rejected with `config-invalid` and exit code 2:

```console
$ schema config show
error: /tmp/config.json: "maxRows" must be a non-negative whole number.
$ echo $?
2
```

The same check applies to the equivalent command-line options, so `--limit=`
with no value is an error rather than zero.

`maxCellChars: 0` disables truncation; it does not hide every value. A long
cell is then printed in full.

An unknown key is an error, and the known keys are listed in the hint:

```console
$ schema config show
error: /tmp/config.json: "maxrows" is not a known setting.
Known settings: connectTimeoutMs, includeSystemSchemas, maxCellChars, maxRows, sslMode, statementTimeoutMs.
```

A file that is not valid JSON is reported as such, with the same exit code.

## SSL modes

Five modes are accepted, by `--ssl-mode`, by the `sslmode` URL parameter, by
`PGSSLMODE` and by the `sslMode` setting. What each one actually does here:

| Mode          | Encrypted  | Certificate checked        | Host name checked |
| ------------- | ---------- | -------------------------- | ----------------- |
| `disable`     | no         | no                         | no                |
| `prefer`      | if offered | no                         | no                |
| `require`     | yes        | no                         | no                |
| `verify-ca`   | yes        | yes, against the authority | no                |
| `verify-full` | yes        | yes, against the authority | yes               |

`prefer` and `require` encrypt the connection but do **not** verify the
server's certificate, so they protect against passive observation and not
against an active attacker who can redirect the connection. `verify-ca`
checks that the certificate chains to the authority given by
`--ssl-root-cert` or `PGSSLROOTCERT`, but does not check that the host name
matches. Only `verify-full` does both; use it for anything that crosses a
network you do not control.

`prefer` retries once: if the server rejects the encrypted connection, one
unencrypted attempt is made. If that attempt also fails, the error from the
second attempt is the one reported, so a missing database or a refused
connection is not hidden behind "The server does not support SSL
connections".

The negotiated mode, which may differ from the requested one after a
fallback, is shown by `connect` as `Encryption … (requested …)` and appears in
the JSON report as `sslModeUsed`.

## Colour

Colour is used for headings and for dim labels and notes only; table bodies
and error messages are never coloured. The decision is made once, in this
order, and the first rule that applies wins:

| Rule                                        | Result    |
| ------------------------------------------- | --------- |
| `--no-color` was given                      | no colour |
| `NO_COLOR` is set and not empty             | no colour |
| `TERM` is `dumb`                            | no colour |
| `FORCE_COLOR` is set, not empty and not `0` | colour    |
| stdout is a terminal                        | colour    |
| otherwise                                   | no colour |

Because `FORCE_COLOR` is consulted before the terminal test, it is the way to
keep colour when the output is piped; because `NO_COLOR` is consulted before
it, `NO_COLOR` wins over `FORCE_COLOR`.

```console
$ FORCE_COLOR=1 schema connect | cat -v | head -1
^[[1mConnection^[[0m
$ FORCE_COLOR=1 NO_COLOR=1 schema connect | cat -v | head -1
Connection
```

## Quiet output

`--quiet` suppresses the confirmation lines only: the "N row(s) written to
…" line from `export --output`, and the acknowledgements printed by
`config set` and `config unset`. It does not suppress the summary lines that
belong to a result, such as "10 relations.", and it does not suppress errors.

```console
$ schema export inventory.products -o products.csv --quiet
$ echo $?
0
```

Use `--json` when the output is to be read by a program.
