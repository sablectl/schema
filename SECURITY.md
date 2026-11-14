# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |

## Reporting a vulnerability

Report privately through a
[GitHub security advisory](https://github.com/sablectl/schema/security/advisories/new).
Do not open a public issue.

Please include what you did, what happened, what you expected, and the
smallest reproduction you can manage. A `CREATE TABLE` that demonstrates the
problem is worth more than a description of a real database. Remove any
credential before sending.

You will get an acknowledgement within seven days. A fix, or an explanation
of why the behaviour is intended, follows as quickly as the problem warrants.

## What is in scope

- Executing anything that modifies a database, bypassing the read-only
  transaction, or bypassing the statement allow-list.
- Reaching the server's filesystem or running a program on the server
  through Schema.
- SQL injection through a value, an identifier, a connection parameter or
  any other input.
- A password, connection string or other credential appearing in output, in
  an error message, in a file Schema writes, or in a file written with
  permissions that let another local user read it.
- Reading or writing a file outside the configuration file and files named
  on the command line.
- Unbounded memory use or a hang that the documented limits should have
  prevented.
- A dependency vulnerability that is reachable from Schema's own code paths.

## What is not in scope

- **What a privileged role can do.** Schema is designed to be run with a
  dedicated read-only role. If it is given a superuser and that superuser
  can read `pg_authid` or call a function with side effects, that is the
  role's privileges, not a defect in Schema. See
  [docs/read-only-role.md](docs/read-only-role.md).
- **Side effects inside functions.** A read-only transaction prevents writes
  to tables. It does not prevent a function from sending a notification,
  writing to a log or consuming resources. This is documented in
  [docs/security-model.md](docs/security-model.md) and is a property of
  PostgreSQL.
- **Information disclosure from the catalogue.** Schema reports what the
  connected role is permitted to read. Restricting that is the database's
  job.
- `require` and `prefer` not verifying the server certificate. That is
  libpq's documented meaning for those modes, Schema matches it, and
  `verify-full` is available and recommended.
- Secrets exposed by your own shell history or process listing after you
  chose to pass them insecurely. Schema provides no `--password` option
  precisely to avoid this.
- Denial of service against a database you are authorised to query.

## Design notes

The guarantees Schema does and does not make, the three enforcement layers,
and the reasoning behind the statement allow-list are set out in
[docs/security-model.md](docs/security-model.md). Read it before reporting:
several behaviours that look like weaknesses are deliberate, documented
limits of what a client can enforce.
