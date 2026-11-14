# A dedicated read-only role

The read-only transaction Schema opens is enforced by the server, but it
protects only against writes issued through this tool. The durable control is
the role the tool connects as. This document gives the SQL for a role that
can read what it needs and nothing more, and shows how to verify it.

The statements below were run against a disposable PostgreSQL 17 cluster
loaded with `tests/fixtures/shop.sql`, and the verification output is the
output they produced.

## Creating the role

Replace `shop` with the database, `public, inventory` with the schemas the
role should read and `change-me` with a password from a password manager.

```sql
CREATE ROLE schema_reader LOGIN PASSWORD 'change-me';

GRANT CONNECT ON DATABASE shop TO schema_reader;
GRANT USAGE ON SCHEMA public, inventory TO schema_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public, inventory TO schema_reader;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public, inventory
  GRANT SELECT ON TABLES TO schema_reader;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

ALTER ROLE schema_reader SET default_transaction_read_only = on;
```

What each statement does:

| Statement                        | Effect                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `CREATE ROLE ... LOGIN`          | A login role with no other attribute: not a superuser, no `CREATEDB`, no `CREATEROLE`.            |
| `GRANT CONNECT`                  | Allows connection to this one database.                                                           |
| `GRANT USAGE ON SCHEMA`          | Makes objects in those schemas visible. Without it a `SELECT` grant is unusable.                  |
| `GRANT SELECT ON ALL TABLES`     | Applies to the tables, views and materialised views that exist **now**.                           |
| `ALTER DEFAULT PRIVILEGES`       | Applies to tables created **later** by `postgres`. Repeat it for every role that creates objects. |
| `REVOKE CREATE ON SCHEMA public` | Stops the role creating objects in `public`.                                                      |
| `ALTER ROLE ... SET`             | Every session this role opens starts read only, whatever client it uses.                          |

`ALTER DEFAULT PRIVILEGES` applies per creating role. A table created by a
role other than `postgres` will not be covered; add a clause for each role
that creates objects, or re-run the `GRANT SELECT ON ALL TABLES` after a
migration.

On PostgreSQL 15 and later, `REVOKE CREATE ON SCHEMA public FROM PUBLIC` is
already the default and the statement is a harmless no-op; it was a no-op on
the PostgreSQL 17 cluster used here. On PostgreSQL 14 and earlier it is
necessary.

Grant sequences only if the role needs to read them:

```sql
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO schema_reader;
```

Schema's `sequences` command reads the catalogue, not the sequence values, so
it does not need this grant.

## Verifying the role

Connect with it:

```console
$ schema connect --url postgresql://schema_reader@127.0.0.1:55433/shop
Connection
  Server       PostgreSQL 17.9
  Connection   postgresql://schema_reader@127.0.0.1:55433/shop
  Database     shop
  Role         schema_reader
  Encryption   none (requested prefer)
  Transaction  read only
```

Reading works:

```console
$ schema query 'SELECT count(*) FROM customers' --url postgresql://schema_reader@127.0.0.1:55433/shop
count
-----
3

1 row in 2 ms.
```

Writing does not. Use `psql`, not Schema, for this check: Schema refuses a
write before it reaches the server, which tells you nothing about the role.

```console
$ psql postgresql://schema_reader@127.0.0.1:55433/shop \
    -c "INSERT INTO customers (email) VALUES ('x@example.test')"
ERROR:  cannot execute INSERT in a read-only transaction
$ psql postgresql://schema_reader@127.0.0.1:55433/shop -c "CREATE TABLE t (id int)"
ERROR:  cannot execute CREATE TABLE in a read-only transaction
```

### Confirming there are two independent layers

`default_transaction_read_only` is a setting, and a session may turn it off.
That is why the privileges matter as well. Turn it off in the same session
and try again:

```console
$ psql postgresql://schema_reader@127.0.0.1:55433/shop <<'SQL'
SET default_transaction_read_only = off;
INSERT INTO customers (email) VALUES ('x@example.test');
CREATE TABLE public.t (id int);
SQL
SET
ERROR:  permission denied for table customers
ERROR:  permission denied for schema public
```

The first layer is gone and the second holds. Both failures are from the
privilege system, which the role cannot alter.

Confirm the setting is in place for new sessions:

```console
$ psql postgresql://schema_reader@127.0.0.1:55433/shop -tAc 'SHOW default_transaction_read_only'
on
```

## Host-based authentication

Role privileges say what a connected session may do; `pg_hba.conf` says who
may connect at all. Restrict the role to the hosts that need it and require a
password method rather than `trust`:

```text
# TYPE  DATABASE  USER           ADDRESS          METHOD
hostssl shop      schema_reader  10.0.0.0/24      scram-sha-256
```

`hostssl` refuses the connection unless it is encrypted, which is the
server-side counterpart to the client's SSL mode: a client that asks for
`prefer` cannot then silently fall back to an unencrypted connection, because
the server will not accept one. Reload with `SELECT pg_reload_conf();` or
`pg_ctl reload`.

For transport security, combine that with `--ssl-mode verify-full` and a
`--ssl-root-cert` pointing at the authority that issued the server's
certificate. `prefer` and `require` encrypt but do not verify the
certificate, so they do not protect against an active attacker. See
[security-model.md](security-model.md).

## Removing the role

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public, inventory
  REVOKE SELECT ON TABLES FROM schema_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA public, inventory FROM schema_reader;
REVOKE ALL ON SCHEMA public, inventory FROM schema_reader;
REVOKE ALL ON DATABASE shop FROM schema_reader;
DROP ROLE schema_reader;
```

`DROP ROLE` fails while any privilege still refers to the role, so the
revocations come first. Run them in every database the role was granted
anything in.
