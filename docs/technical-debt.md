# Technical debt

Known limitations of the current implementation, with their effect and what
would resolve each one. This is an honest list of what the code does today,
not a roadmap, and nothing here is a commitment.

## No connection pooling or parallel catalogue reads

Every command opens one connection, runs its catalogue queries in sequence
and closes it. `describe` issues separate queries for columns, constraints,
indexes, foreign keys and the relations that reference the table.

**Impact.** Latency is the sum of the round trips, which is noticeable
against a distant server. A script that runs several commands pays the
connection cost each time.

**Resolution.** Issue the independent catalogue reads concurrently on the one
connection where the protocol allows it, or combine them into fewer queries.
Pooling is a poorer fit: a single-shot command-line tool has nothing to pool
across, and the single connection is what keeps the transaction model simple.

## Row counts depend on the last ANALYZE

`tables` and `describe` report `pg_class.reltuples`, which the planner
maintains and which is only as fresh as the last `ANALYZE` or autovacuum
pass. A relation that has never been analysed is reported as "not analysed"
rather than as zero, which is correct but is not a count.

**Impact.** A table that has recently grown or been emptied can be reported
with a figure that is badly wrong.

**Resolution.** None within a read-only tool: `ANALYZE` is a write and will
not be run. The honest options are what already exist — label the figure as
an estimate, and offer `--exact-count` for a counted one.

## `--exact-count` is a sequential scan

`describe --exact-count` runs `SELECT count(*)`, which on most relations
reads every page.

**Impact.** On a large table it is slow and competes for I/O, and it may be
cancelled by `statement_timeout` before it finishes.

**Resolution.** There is no cheaper exact count in PostgreSQL. A visibility
map estimate would be faster but would not be exact, which defeats the point
of the option.

## Column widths are measured in code points

`src/output/table.ts` sizes a column by counting the code points in each
cell.

**Impact.** East Asian wide characters occupy two terminal cells but count as
one, so a table containing CJK text has columns that do not line up.
Combining marks and emoji sequences are miscounted in the other direction.
`maxCellChars` likewise truncates by code point, not by display width.

**Resolution.** Measure with an East Asian width table and grapheme cluster
segmentation. `Intl.Segmenter` is available in Node.js and would handle the
clustering; the width table would have to be carried, which is the reason it
has not been done in a tool with one dependency.

## The byte budget is approximate

`--max-bytes` is accumulated from the parsed JavaScript values a row
contains, not from the number of bytes the server actually sent.

**Impact.** The budget does not correspond to wire traffic or to memory used.
A result of large `bytea` or `jsonb` values can exceed the nominal budget
before the budget notices, and a result of small values may stop earlier than
the figure suggests.

**Resolution.** Measure the bytes delivered by the protocol, which means
reaching below the driver's row parsing. That is a larger change than the
guarantee is worth; the budget is a guard against an accidental enormous
result, and the documentation says so.

## No interactive shell and no pager

Each invocation runs one command and exits. Output goes to stdout with no
paging.

**Impact.** Exploring a database means repeated invocations, each paying a
connection, and long output must be piped to a pager by hand. Colour is
disabled when the output is piped unless `FORCE_COLOR` is set.

**Resolution.** An interactive mode holding one connection open, and spawning
`$PAGER` when stdout is a terminal. Both are features rather than fixes, and
both enlarge the surface of a tool whose value is partly its smallness.

## `EXPLAIN` and `SHOW` are buffered

Neither can be wrapped in a cursor, so they are run directly and the whole
result is held in memory, with the byte budget applied after the read. The
JSON report sets `buffered` to `true`.

**Impact.** A very large plan — a wide `EXPLAIN (FORMAT JSON)` on a complex
query — is read in full before any limit applies.

**Resolution.** None available: PostgreSQL does not allow these statements in
`DECLARE CURSOR`. Reporting the fact, which the `buffered` field does, is the
best that can be done.

## No unix-domain socket support

The host is always treated as a network host. A path such as
`/var/run/postgresql` is not recognised as a socket directory.

**Impact.** A local connection must go through TCP to `localhost`, which
requires the server to be listening on a port and a matching `host` line in
`pg_hba.conf`. Peer authentication over a socket, the default on Debian and
Ubuntu, cannot be used.

**Resolution.** Detect a host beginning with `/` and pass it to the driver as
a socket path. The work is small; the testing is not, since the integration
cluster would need both transports exercised.

## No TLS path covered by automated tests

The disposable cluster the integration tests build has no TLS configured, so
no test exercises an encrypted connection, the `prefer` fallback against a
server that does offer encryption, `verify-ca`, `verify-full`, the
`--ssl-root-cert` handling or the `tls-failure` mapping.

**Impact.** Those paths are covered by reading the code and by manual
checking only. A regression in certificate verification would not be caught.

**Resolution.** Generate a throwaway certificate authority and server
certificate in the global setup, start the cluster with `ssl = on`, and add
cases for each mode including a deliberately mismatched host name.

## No restricted-role scenario covered either

Every integration test connects as the cluster's superuser. Nothing exercises
the behaviour of a role that may connect but may not read a given relation —
the "not permitted" columns, the `permission-denied` mapping, a schema the
role cannot use.

**Impact.** The permission-related output paths are untested. The read-only
role in [read-only-role.md](read-only-role.md) was verified by hand, not by
the suite.

**Resolution.** Create a second role in the global setup rather than in the
fixture, so that the fixture remains the shared read-only artefact, and run a
subset of the suite as that role.

## No Windows or macOS testing

The suite is run on Linux only. Path handling, the configuration directory,
the file modes `0600` and `0700`, signal handling and the terminal detection
are all platform-sensitive.

**Impact.** Behaviour on Windows and macOS is unverified. The POSIX file
modes have no direct equivalent on Windows, so the guarantee that a
configuration file or an exported file is private does not hold there.

**Resolution.** Add those platforms to the continuous integration matrix,
which also means finding a way to run the disposable cluster on each.

## No benchmarking

There are no performance tests and no recorded measurements of catalogue
query cost, cursor throughput or rendering time against a catalogue of any
size.

**Impact.** No performance claim can be made, and none is made anywhere in
this documentation. A change that makes a catalogue query slower on a
database with tens of thousands of relations would not be noticed.

**Resolution.** A benchmark fixture with a large generated catalogue, and a
recorded baseline that the continuous integration job compares against.
