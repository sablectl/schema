// Help text.
//
// Option lists are rendered from the same tables the parser uses, so a flag
// cannot be documented without existing, or exist without being documented.

import { VERSION } from '../version.js';
import { merge, type OptionSpec } from './args.js';
import {
  CONNECTION_OPTIONS,
  GLOBAL_OPTIONS,
  LIMIT_OPTIONS,
  SCHEMA_FILTER_OPTIONS,
  SYSTEM_OPTIONS,
} from './options.js';

export interface CommandHelp {
  readonly name: string;
  readonly summary: string;
  readonly usage: string;
  readonly detail?: string;
  readonly options: Readonly<Record<string, OptionSpec>>;
}

function flag(name: string, spec: OptionSpec): string {
  const short = spec.short === undefined ? '    ' : `-${spec.short}, `;
  const value = spec.valueName === undefined ? '' : ` <${spec.valueName}>`;
  return `  ${short}--${name}${value}`;
}

export function renderOptions(
  specs: Readonly<Record<string, OptionSpec>>,
): string {
  const entries = Object.entries(specs);
  const left = entries.map(([name, spec]) => flag(name, spec));
  const width = left.reduce((size, text) => Math.max(size, text.length), 0);
  return entries
    .map(([, spec], index) => {
      const padded = (left[index] ?? '').padEnd(width);
      return `${padded}  ${spec.describe}`;
    })
    .join('\n');
}

export const COMMANDS: readonly CommandHelp[] = [
  {
    name: 'connect',
    summary: 'Open a connection and report what answered.',
    usage: 'schema connect [connection options]',
    detail:
      'Reports the server version, the database, the role, whether the\n' +
      'connection is encrypted and that the transaction is read only.\n' +
      'Nothing else is read, so it works with the most restricted role.',
    options: merge(CONNECTION_OPTIONS, GLOBAL_OPTIONS),
  },
  {
    name: 'databases',
    summary: 'List the databases on this server.',
    usage: 'schema databases [connection options]',
    options: merge(CONNECTION_OPTIONS, GLOBAL_OPTIONS),
  },
  {
    name: 'schemas',
    summary: 'List the schemas in the current database.',
    usage: 'schema schemas [connection options]',
    options: merge(CONNECTION_OPTIONS, SYSTEM_OPTIONS, GLOBAL_OPTIONS),
  },
  {
    name: 'tables',
    summary: 'List tables, views and materialised views.',
    usage: 'schema tables [PATTERN] [connection options]',
    detail:
      'PATTERN is matched with SQL LIKE, so % and _ are wildcards.\n' +
      'Row counts are planner estimates; use describe --exact-count for a\n' +
      'counted figure.',
    options: merge(
      CONNECTION_OPTIONS,
      SCHEMA_FILTER_OPTIONS,
      SYSTEM_OPTIONS,
      {
        kind: {
          kind: 'list',
          describe:
            'Restrict to table, view, matview, partitioned or foreign. Repeatable.',
          valueName: 'KIND',
        },
        limit: {
          kind: 'string',
          short: 'n',
          describe: 'Maximum relations to list (default 500).',
          valueName: 'N',
        },
      },
      GLOBAL_OPTIONS,
    ),
  },
  {
    name: 'describe',
    summary: 'Show the structure of one table or view.',
    usage: 'schema describe TABLE [connection options]',
    detail:
      'TABLE may be qualified, quoted, or both: users, public.users and\n' +
      '"My Schema"."My Table" are all accepted. An unqualified name is\n' +
      'resolved through the search path.',
    options: merge(
      CONNECTION_OPTIONS,
      {
        'exact-count': {
          kind: 'boolean',
          describe: 'Count the rows exactly. This reads the whole table.',
        },
      },
      GLOBAL_OPTIONS,
    ),
  },
  {
    name: 'relations',
    summary: 'Show declared foreign-key relationships.',
    usage: 'schema relations [TABLE] [connection options]',
    detail:
      'With no table, every foreign key in the database is listed. Only\n' +
      'declared constraints are reported; a naming convention is not a\n' +
      'relationship.',
    options: merge(
      CONNECTION_OPTIONS,
      SCHEMA_FILTER_OPTIONS,
      SYSTEM_OPTIONS,
      {
        mermaid: {
          kind: 'string',
          describe: 'Write a Mermaid entity relationship diagram to this file.',
          valueName: 'PATH',
        },
      },
      GLOBAL_OPTIONS,
    ),
  },
  {
    name: 'indexes',
    summary: 'List the indexes on one table.',
    usage: 'schema indexes TABLE [connection options]',
    options: merge(CONNECTION_OPTIONS, GLOBAL_OPTIONS),
  },
  {
    name: 'sequences',
    summary: 'List sequences and the columns that own them.',
    usage: 'schema sequences [connection options]',
    options: merge(
      CONNECTION_OPTIONS,
      SCHEMA_FILTER_OPTIONS,
      SYSTEM_OPTIONS,
      GLOBAL_OPTIONS,
    ),
  },
  {
    name: 'query',
    summary: 'Run one read-only statement.',
    usage: 'schema query SQL [--param VALUE]... [connection options]',
    detail:
      'The statement runs in a read-only transaction under a statement\n' +
      'timeout, and the result is read through a server-side cursor up to\n' +
      '--limit rows. Write values as $1, $2 and pass them with --param;\n' +
      'never build SQL by concatenating untrusted text.',
    options: merge(
      CONNECTION_OPTIONS,
      LIMIT_OPTIONS,
      {
        param: {
          kind: 'list',
          describe: 'A value for the next $n placeholder. Repeatable.',
          valueName: 'VALUE',
        },
        csv: { kind: 'boolean', describe: 'Write the rows as CSV.' },
      },
      GLOBAL_OPTIONS,
    ),
  },
  {
    name: 'export',
    summary: 'Export rows from one table as CSV or JSON.',
    usage: 'schema export TABLE [connection options]',
    options: merge(
      CONNECTION_OPTIONS,
      LIMIT_OPTIONS,
      {
        format: {
          kind: 'string',
          describe: 'csv or json (default csv).',
          valueName: 'FORMAT',
        },
        output: {
          kind: 'string',
          short: 'o',
          describe: 'Write to this file instead of stdout.',
          valueName: 'PATH',
        },
      },
      GLOBAL_OPTIONS,
    ),
  },
  {
    name: 'inspect',
    summary: 'Report server, database and permission diagnostics.',
    usage: 'schema inspect [connection options]',
    detail:
      'Values that depend on privileges are reported as "not permitted"\n' +
      'rather than as zero.',
    options: merge(
      CONNECTION_OPTIONS,
      {
        largest: {
          kind: 'string',
          describe: 'How many of the largest relations to list (default 10).',
          valueName: 'N',
        },
      },
      GLOBAL_OPTIONS,
    ),
  },
  {
    name: 'config',
    summary: 'Show or change the stored settings.',
    usage: 'schema config show|path|set KEY VALUE|unset KEY',
    detail:
      'The configuration file holds defaults only. No connection string,\n' +
      'user name or password is ever written to it.',
    options: merge(GLOBAL_OPTIONS),
  },
];

export function findCommand(name: string): CommandHelp | undefined {
  return COMMANDS.find((command) => command.name === name);
}

export function rootHelp(): string {
  const width = COMMANDS.reduce(
    (size, command) => Math.max(size, command.name.length),
    0,
  );
  const list = COMMANDS.map(
    (command) => `  ${command.name.padEnd(width)}  ${command.summary}`,
  ).join('\n');
  return `schema ${VERSION} — PostgreSQL explorer and read-only query toolkit.

Usage
  schema <command> [options]

Commands
${list}

Global options
${renderOptions(GLOBAL_OPTIONS)}

Connecting
  Where to connect is read from --url, then the individual options, then
  the standard PGHOST, PGPORT, PGDATABASE, PGUSER and PGPASSWORD variables.
  A password is never taken from the command line, because an argument is
  visible to every process on the machine.

  Every statement runs in a read-only transaction. Connect with a role that
  has no write privileges as well; see docs/read-only-role.md.

Run "schema <command> --help" for the options of one command.
Exit codes: 0 success, 1 failure, 2 usage, 3 internal, 130 interrupted.
`;
}

export function commandHelp(command: CommandHelp): string {
  const detail = command.detail === undefined ? '' : `\n${command.detail}\n`;
  return `schema ${command.name} — ${command.summary}

Usage
  ${command.usage}
${detail}
Options
${renderOptions(command.options)}
`;
}
