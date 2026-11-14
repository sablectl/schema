# Contributing

## Scope

Schema reads PostgreSQL databases. It does not write to them, and no change
that gives it the ability to will be accepted, however convenient. That
includes "just one" data-modifying command behind a flag.

Useful contributions are new read-only inspections, better output, accuracy
fixes, and support for catalogue features Schema does not yet report.

## Getting set up

```sh
git clone https://github.com/sablectl/schema.git
cd schema
npm ci
npm run build
```

The integration tests need the PostgreSQL server binaries (`initdb`,
`pg_ctl`, `psql`) on the path. They create a throwaway cluster in a
temporary directory on a free loopback port and remove it afterwards; no
existing server is touched. See [docs/testing.md](docs/testing.md) for how
to install them and for the `SCHEMA_TEST_URL` alternative.

## Before opening a pull request

```sh
npm run verify
```

That runs, in order: type check, lint, formatting check, unit tests,
integration tests and the production build. All of it must pass.

New behaviour needs a test that fails without the change. A bug fix needs a
test that reproduces the bug first. Tests must assert what the code actually
does; if a test and the implementation disagree, work out which one is
wrong rather than adjusting the assertion until it passes.

## House rules

- **No new runtime dependency** without a reason in the pull request. `pg`
  is the only one, and it is there because implementing the PostgreSQL wire
  protocol is not this project's job.
- **Values are parameters, identifiers are quoted.** Never interpolate a
  value into SQL text. An identifier that must appear in SQL text goes
  through `quoteIdentifier` first.
- **Say what is not known.** A value the connected role cannot see is
  reported as "not permitted"; a relation that has never been analysed is
  "not analysed". Printing a zero that looks like a measurement is a bug.
- **No credential in output.** Anything derived from a connection target
  goes through `core/redact.ts` before it reaches a report or an error.
- **British English in prose**, including "licence" as a noun. Identifiers
  keep their own spelling: `NO_COLOR`, `--no-color`, `sslmode`, `ANALYZE`.
- Comments explain why, not what. The code already says what it does.

## Code style

Prettier and ESLint decide formatting and lint; `npm run format` applies
them. Strict TypeScript, no `any`, ESM with `.js` extensions on relative
imports.

The dependency direction is `bin` → `cli` → `core` and `output`. `core`
never imports from `cli` or `output`, so the database logic can be used
without the command line and tested without it.

## Reporting a vulnerability

Do not open a public issue. See [SECURITY.md](SECURITY.md).
