# Changelog

All notable changes to Schema are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- `printable` now also escapes C1 control characters and the Unicode
  bidirectional overrides, and it is applied to table headers, field keys and
  headings as well as cell values. Database-supplied identifiers and values
  could previously rewrite lines already printed to the terminal. Column widths
  are measured on the escaped text, so alignment is unaffected. JSON and CSV
  output are unchanged.

## [1.0.0] — 2026-11-13

First release.

### Added

- `connect`, `databases`, `schemas`, `tables`, `describe`, `relations`,
  `indexes`, `sequences`, `query`, `export`, `inspect` and `config`.
- Catalogue inspection reading `pg_catalog` directly: columns with types,
  defaults, identity and generated attributes and collations; primary key,
  unique, check and foreign-key constraints; indexes with access method,
  validity and size; sequences with their owning column; table and column
  comments; sizes and planner row estimates, with "not analysed" reported
  distinctly from zero.
- Foreign-key relationship reporting, including composite keys and
  referential actions, with a Mermaid entity relationship diagram written on
  request. Relationships are read from declared constraints only.
- Read-only query execution with positional parameters, a server-side
  cursor, a row limit and an output byte budget, plus CSV and JSON export.
- Diagnostics reporting the server version, database, roles, encryption,
  database and relation sizes, extensions and the relevant settings, marking
  values the connected role may not see as "not permitted" rather than zero.
- A versioned JSON report for every command, and an optional configuration
  file holding defaults only.

### Security

- Read-only enforced by PostgreSQL in three layers: read-only session
  characteristics, a read-only transaction for the life of the command, and
  statement, lock and idle-in-transaction timeouts.
- A statement allow-list layered on top of that boundary, which refuses
  `COPY … TO` and `COPY … FROM PROGRAM` — both are read-only in the
  transactional sense and both touch the server's filesystem — and refuses
  more than one statement per invocation.
- No `--password` option: passwords come from the environment, a connection
  string or `--password-env`, and are replaced with `[redacted]` in every
  report and error message. No credential is ever written to the
  configuration file, which is created at mode `0600`.
- Values are bound as query parameters and identifiers are quoted, so an
  unusual or hostile object name is read rather than executed.
- TLS follows the libpq modes, with the weaker guarantees of `prefer` and
  `require` documented rather than glossed over.

[1.0.0]: https://github.com/sablectl/schema/releases/tag/v1.0.0
