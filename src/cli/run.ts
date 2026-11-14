// Command dispatch.
//
// `run` takes everything it touches as arguments and returns an exit code
// instead of calling `process.exit`, so the whole command line can be driven
// in a test without spawning a process.

import { writeFile } from 'node:fs/promises';
import {
  boolOf,
  listOf,
  numberOf,
  parseArgs,
  stringOf,
  type ParsedArgs,
} from './args.js';
import { commandHelp, findCommand, rootHelp } from './help.js';
import { GLOBAL_OPTIONS } from './options.js';
import { AppError, ExitCode, isAppError, usageError } from '../core/errors.js';
import {
  DEFAULT_SETTINGS,
  configPath,
  isSettingKey,
  isSslMode,
  loadSettings,
  loadStoredPatch,
  parseSettings,
  saveSettings,
  SETTING_KEYS,
  SSL_MODES,
  type Settings,
} from '../core/config.js';
import { resolveTarget, type ConnectionTarget } from '../core/connection.js';
import { Database } from '../core/client.js';
import {
  countRows,
  describeRelation,
  INSPECTABLE_RELKINDS,
  listAllForeignKeys,
  listDatabases,
  listForeignKeys,
  listIndexes,
  listReferencingKeys,
  listRelations,
  listSchemas,
  listSequences,
  resolveRelation,
  type ForeignKeyInfo,
} from '../core/catalog.js';
import { collectDiagnostics } from '../core/diagnostics.js';
import { DEFAULT_LIMITS, runQuery, sampleRelation } from '../core/query.js';
import { parseQualifiedName, quoteIdentifier } from '../core/identifiers.js';
import { toMermaid } from '../core/relations.js';
import {
  createPainter,
  shouldUseColour,
  type Painter,
} from '../output/colour.js';
import * as human from '../output/human.js';
import * as report from '../output/json.js';
import { toCsv } from '../output/csv.js';
import { jsonValue } from '../output/value.js';
import { VERSION } from '../version.js';

export interface Io {
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly stdoutIsTty: boolean;
  write(text: string): void;
  writeError(text: string): void;
  readonly signal?: AbortSignal | undefined;
  readonly now?: (() => Date) | undefined;
}

interface Context {
  readonly io: Io;
  readonly args: ParsedArgs;
  readonly settings: Settings;
  readonly painter: Painter;
  readonly json: boolean;
  readonly quiet: boolean;
  readonly command: string;
}

const RELKIND_BY_NAME: Record<string, string> = {
  table: 'r',
  view: 'v',
  matview: 'm',
  'materialised view': 'm',
  partitioned: 'p',
  foreign: 'f',
};

function formatOptions(context: Context): human.FormatOptions {
  return {
    painter: context.painter,
    maxCellChars: context.settings.maxCellChars,
  };
}

function emit(
  context: Context,
  status: report.ReportStatus,
  body: {
    json: () => unknown;
    human: () => string;
  },
): void {
  if (context.json) {
    const now = context.io.now?.() ?? new Date();
    context.io.write(
      report.render(report.envelope(context.command, status, body.json(), now)),
    );
    return;
  }
  context.io.write(body.human());
}

function targetFrom(context: Context): ConnectionTarget {
  const { args, settings, io } = context;
  const sslModeText = stringOf(args, 'ssl-mode');
  if (sslModeText !== undefined && !isSslMode(sslModeText)) {
    throw usageError(
      `"${sslModeText}" is not a supported SSL mode.`,
      `Use one of ${SSL_MODES.join(', ')}.`,
    );
  }
  const portText = stringOf(args, 'port');
  const port =
    portText === undefined ? undefined : numberOf(args, 'port', 0) || undefined;
  if (portText !== undefined && (port === undefined || port > 65_535)) {
    throw usageError(`"${portText}" is not a valid port number.`);
  }
  return resolveTarget(
    {
      url: stringOf(args, 'url'),
      host: stringOf(args, 'host'),
      port,
      database: stringOf(args, 'dbname'),
      user: stringOf(args, 'user'),
      passwordEnv: stringOf(args, 'password-env'),
      sslMode: sslModeText ?? settings.sslMode,
      sslRootCert: stringOf(args, 'ssl-root-cert'),
      connectTimeoutMs: numberOf(
        args,
        'connect-timeout',
        settings.connectTimeoutMs,
      ),
      statementTimeoutMs: numberOf(
        args,
        'statement-timeout',
        settings.statementTimeoutMs,
      ),
    },
    io.env,
  );
}

/** Open a connection, run the body, and always close the connection. */
async function withDatabase<T>(
  context: Context,
  body: (db: Database, target: ConnectionTarget) => T | Promise<T>,
): Promise<T> {
  const target = targetFrom(context);
  if (context.io.signal?.aborted === true) {
    throw new AppError('cancelled', 'Interrupted.');
  }
  const db = await Database.connect(target);
  const onAbort = (): void => {
    void db.cancel();
  };
  context.io.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await body(db, target);
  } finally {
    context.io.signal?.removeEventListener('abort', onAbort);
    await db.close();
  }
}

function schemaFilter(context: Context): string | undefined {
  return stringOf(context.args, 'schema');
}

function includeSystem(context: Context): boolean {
  return (
    boolOf(context.args, 'system') || context.settings.includeSystemSchemas
  );
}

function requirePositional(context: Context, what: string): string {
  const value = context.args.positional[1];
  if (value === undefined) {
    throw usageError(
      `${what} is required.`,
      `Run schema ${context.command} --help.`,
    );
  }
  return value;
}

async function commandConnect(context: Context): Promise<number> {
  return withDatabase(context, (db, target) => {
    emit(context, 'ok', {
      json: () => report.connectionToJson(target, db.info),
      human: () =>
        human.formatConnection(target, db.info, formatOptions(context)),
    });
    return ExitCode.Success;
  });
}

async function commandDatabases(context: Context): Promise<number> {
  return withDatabase(context, async (db) => {
    const rows = await listDatabases(db);
    emit(context, rows.length === 0 ? 'empty' : 'ok', {
      json: () => report.databasesToJson(rows),
      human: () => human.formatDatabases(rows, formatOptions(context)),
    });
    return ExitCode.Success;
  });
}

async function commandSchemas(context: Context): Promise<number> {
  return withDatabase(context, async (db) => {
    const rows = await listSchemas(db, includeSystem(context));
    emit(context, rows.length === 0 ? 'empty' : 'ok', {
      json: () => report.schemasToJson(rows),
      human: () => human.formatSchemas(rows, formatOptions(context)),
    });
    return ExitCode.Success;
  });
}

async function commandTables(context: Context): Promise<number> {
  const kinds = listOf(context.args, 'kind').map((name) => {
    const relkind = RELKIND_BY_NAME[name.toLowerCase()];
    if (relkind === undefined) {
      throw usageError(
        `"${name}" is not a relation kind.`,
        `Use one of ${Object.keys(RELKIND_BY_NAME).join(', ')}.`,
      );
    }
    return relkind;
  });
  const limit = numberOf(context.args, 'limit', 500);
  const pattern = context.args.positional[1];

  return withDatabase(context, async (db) => {
    const rows = await listRelations(db, {
      schema: schemaFilter(context),
      pattern,
      kinds: kinds.length === 0 ? [...INSPECTABLE_RELKINDS] : kinds,
      includeSystem: includeSystem(context),
      limit,
    });
    const status: report.ReportStatus =
      rows.length === 0 ? 'empty' : rows.length === limit ? 'truncated' : 'ok';
    emit(context, status, {
      json: () => report.relationsToJson(rows),
      human: () => human.formatRelations(rows, formatOptions(context)),
    });
    return ExitCode.Success;
  });
}

async function commandDescribe(context: Context): Promise<number> {
  const name = parseQualifiedName(requirePositional(context, 'A table name'));
  const exact = boolOf(context.args, 'exact-count');
  return withDatabase(context, async (db) => {
    const ref = await resolveRelation(db, name.schema, name.name);
    const detail = await describeRelation(db, ref);
    const exactRows =
      exact && ref.kind !== 'foreign table' ? await countRows(db, ref) : null;
    emit(context, 'ok', {
      json: () => report.tableToJson(detail, exactRows),
      human: () => human.formatTable(detail, exactRows, formatOptions(context)),
    });
    return ExitCode.Success;
  });
}

async function writeMermaid(
  path: string,
  keys: readonly ForeignKeyInfo[],
  db: Database,
): Promise<void> {
  // Cardinality needs to know whether the referencing columns are unique and
  // whether they are nullable, which is two more catalogue reads rather than
  // a guess from the column names.
  const unique = new Set<string>();
  const optional = new Set<string>();
  for (const key of keys) {
    const ref = await resolveRelation(db, key.schema, key.table).catch(
      () => null,
    );
    if (ref === null) continue;
    const detail = await describeRelation(db, ref);
    const signature = `${key.schema}.${key.table}.${key.name}`;
    const covered = detail.constraints.some(
      (constraint) =>
        (constraint.type === 'unique' || constraint.type === 'primary key') &&
        constraint.columns.length === key.columns.length &&
        constraint.columns.every((column) => key.columns.includes(column)),
    );
    if (covered) unique.add(signature);
    const nullable = detail.columns.some(
      (column) => key.columns.includes(column.name) && column.nullable,
    );
    if (nullable) optional.add(signature);
  }
  await writeFile(path, toMermaid(keys, unique, optional), { mode: 0o644 });
}

async function commandRelations(context: Context): Promise<number> {
  const raw = context.args.positional[1];
  const mermaid = stringOf(context.args, 'mermaid');
  return withDatabase(context, async (db) => {
    let keys: readonly ForeignKeyInfo[];
    if (raw === undefined) {
      keys = await listAllForeignKeys(
        db,
        schemaFilter(context),
        includeSystem(context),
      );
    } else {
      const name = parseQualifiedName(raw);
      const ref = await resolveRelation(db, name.schema, name.name);
      const outgoing = await listForeignKeys(db, ref.oid);
      const incoming = await listReferencingKeys(db, ref.oid);
      keys = [...outgoing, ...incoming];
    }
    if (mermaid !== undefined) {
      await writeMermaid(mermaid, keys, db);
    }
    emit(context, keys.length === 0 ? 'empty' : 'ok', {
      json: () => ({
        relationships: report.foreignKeysToJson(keys),
        mermaidFile: mermaid ?? null,
      }),
      human: () => {
        const body = human.formatForeignKeys(keys, formatOptions(context));
        return mermaid === undefined
          ? body
          : `${body}Diagram written to ${mermaid}.\n`;
      },
    });
    return ExitCode.Success;
  });
}

async function commandIndexes(context: Context): Promise<number> {
  const name = parseQualifiedName(requirePositional(context, 'A table name'));
  return withDatabase(context, async (db) => {
    const ref = await resolveRelation(db, name.schema, name.name);
    const indexes = await listIndexes(db, ref.oid);
    emit(context, indexes.length === 0 ? 'empty' : 'ok', {
      json: () => ({
        relation: { schema: ref.schema, name: ref.name, kind: ref.kind },
        indexes: report.indexesToJson(indexes),
      }),
      human: () =>
        human.formatIndexes(
          indexes,
          `Indexes on ${ref.schema}.${ref.name}`,
          formatOptions(context),
        ),
    });
    return ExitCode.Success;
  });
}

async function commandSequences(context: Context): Promise<number> {
  return withDatabase(context, async (db) => {
    const rows = await listSequences(
      db,
      schemaFilter(context),
      includeSystem(context),
    );
    emit(context, rows.length === 0 ? 'empty' : 'ok', {
      json: () => report.sequencesToJson(rows),
      human: () => human.formatSequences(rows, formatOptions(context)),
    });
    return ExitCode.Success;
  });
}

function limitsFrom(context: Context): typeof DEFAULT_LIMITS {
  return {
    maxRows: numberOf(context.args, 'limit', context.settings.maxRows),
    maxBytes: numberOf(context.args, 'max-bytes', DEFAULT_LIMITS.maxBytes),
    batchSize: DEFAULT_LIMITS.batchSize,
  };
}

async function commandQuery(context: Context): Promise<number> {
  const sql = requirePositional(context, 'A SQL statement');
  const params = listOf(context.args, 'param');
  const csv = boolOf(context.args, 'csv');
  if (csv && context.json) {
    throw usageError('Give either --csv or --json, not both.');
  }
  const limits = limitsFrom(context);

  return withDatabase(context, async (db) => {
    const outcome = await runQuery(db, sql, params, limits);
    if (csv) {
      context.io.write(
        toCsv(
          outcome.fields.map((field) => field.name),
          outcome.rows,
        ),
      );
      return ExitCode.Success;
    }
    emit(context, outcome.truncatedBy === null ? 'ok' : 'truncated', {
      json: () => report.queryToJson(outcome, sql, params),
      human: () => human.formatQuery(outcome, formatOptions(context)),
    });
    return ExitCode.Success;
  });
}

async function commandExport(context: Context): Promise<number> {
  const name = parseQualifiedName(requirePositional(context, 'A table name'));
  const format = stringOf(context.args, 'format') ?? 'csv';
  if (format !== 'csv' && format !== 'json') {
    throw usageError(
      `"${format}" is not an export format.`,
      'Use csv or json.',
    );
  }
  const output = stringOf(context.args, 'output');
  const limits = limitsFrom(context);

  return withDatabase(context, async (db) => {
    const ref = await resolveRelation(db, name.schema, name.name);
    const qualified = `${quoteIdentifier(ref.schema)}.${quoteIdentifier(ref.name)}`;
    const outcome = await sampleRelation(db, qualified, limits.maxRows, limits);
    const headers = outcome.fields.map((field) => field.name);
    const text =
      format === 'csv'
        ? toCsv(headers, outcome.rows)
        : `${JSON.stringify(
            outcome.rows.map((row) =>
              Object.fromEntries(
                headers.map((header, index) => [header, jsonValue(row[index])]),
              ),
            ),
            null,
            2,
          )}\n`;

    if (output === undefined) {
      context.io.write(text);
    } else {
      await writeFile(output, text, { mode: 0o600 });
      if (!context.quiet) {
        context.io.writeError(
          `${outcome.rowCount} row(s) written to ${output}.\n`,
        );
      }
    }
    return ExitCode.Success;
  });
}

async function commandInspect(context: Context): Promise<number> {
  const largest = numberOf(context.args, 'largest', 10);
  return withDatabase(context, async (db) => {
    const diagnostics = await collectDiagnostics(db, largest);
    emit(context, 'ok', {
      json: () => report.diagnosticsToJson(diagnostics),
      human: () => human.formatDiagnostics(diagnostics, formatOptions(context)),
    });
    return ExitCode.Success;
  });
}

async function commandConfig(context: Context): Promise<number> {
  const subcommand = context.args.positional[1] ?? 'show';
  const path = configPath(context.io.env);

  if (subcommand === 'path') {
    context.io.write(`${path}\n`);
    return ExitCode.Success;
  }
  if (subcommand === 'show') {
    const { settings, exists } = await loadSettings(context.io.env);
    const stored = await loadStoredPatch(context.io.env);
    if (context.json) {
      emit(context, 'ok', {
        json: () => ({ path, exists, settings, stored }),
        human: () => '',
      });
      return ExitCode.Success;
    }
    const lines = SETTING_KEYS.map((key) => {
      const origin = key in stored ? 'file' : 'default';
      return `  ${key.padEnd(20)}  ${String(settings[key])}  (${origin})`;
    });
    const header = exists
      ? `Settings from ${path}`
      : `No configuration file yet; ${path} would be used.`;
    context.io.write(`${header}\n${lines.join('\n')}\n`);
    return ExitCode.Success;
  }
  if (subcommand === 'set') {
    const key = context.args.positional[2];
    const value = context.args.positional[3];
    if (key === undefined || value === undefined) {
      throw usageError('Usage: schema config set KEY VALUE.');
    }
    if (!isSettingKey(key)) {
      throw usageError(
        `"${key}" is not a known setting.`,
        `Known settings: ${SETTING_KEYS.join(', ')}.`,
      );
    }
    const stored = await loadStoredPatch(context.io.env);
    const patch = parseSettings(
      { ...stored, [key]: value },
      'the command line',
    );
    const written = await saveSettings(patch, context.io.env);
    if (!context.quiet) {
      context.io.write(`${key} = ${value}  (${written})\n`);
    }
    return ExitCode.Success;
  }
  if (subcommand === 'unset') {
    const key = context.args.positional[2];
    if (key === undefined) throw usageError('Usage: schema config unset KEY.');
    if (!isSettingKey(key)) {
      throw usageError(`"${key}" is not a known setting.`);
    }
    const stored = Object.fromEntries(
      Object.entries(await loadStoredPatch(context.io.env)).filter(
        ([name]) => name !== key,
      ),
    );
    const written = await saveSettings(
      parseSettings(stored, 'the configuration file'),
      context.io.env,
    );
    if (!context.quiet) {
      context.io.write(
        `${key} reset to ${String(DEFAULT_SETTINGS[key])}  (${written})\n`,
      );
    }
    return ExitCode.Success;
  }
  throw usageError(
    `"${subcommand}" is not a config subcommand.`,
    'Use show, path, set or unset.',
  );
}

const HANDLERS: Record<string, (context: Context) => Promise<number>> = {
  connect: commandConnect,
  databases: commandDatabases,
  schemas: commandSchemas,
  tables: commandTables,
  describe: commandDescribe,
  relations: commandRelations,
  indexes: commandIndexes,
  sequences: commandSequences,
  query: commandQuery,
  export: commandExport,
  inspect: commandInspect,
  config: commandConfig,
};

export async function run(io: Io): Promise<number> {
  const painterFor = (noColour: boolean): Painter =>
    createPainter(
      shouldUseColour({
        noColorFlag: noColour,
        env: io.env,
        isTty: io.stdoutIsTty,
      }),
    );

  try {
    const name = io.argv[0];
    if (name === undefined) {
      io.write(rootHelp());
      return ExitCode.Success;
    }

    const command = findCommand(name);
    if (command === undefined) {
      const globals = parseArgs(io.argv, GLOBAL_OPTIONS);
      if (boolOf(globals, 'help')) {
        io.write(rootHelp());
        return ExitCode.Success;
      }
      if (boolOf(globals, 'version')) {
        io.write(`${VERSION}\n`);
        return ExitCode.Success;
      }
      throw usageError(
        `"${name}" is not a command.`,
        'Run schema --help for the list of commands.',
      );
    }

    const args = parseArgs(io.argv, command.options);
    if (boolOf(args, 'help')) {
      io.write(commandHelp(command));
      return ExitCode.Success;
    }
    if (boolOf(args, 'version')) {
      io.write(`${VERSION}\n`);
      return ExitCode.Success;
    }

    const { settings } = await loadSettings(io.env);
    const context: Context = {
      io,
      args,
      settings,
      painter: painterFor(boolOf(args, 'no-color')),
      json: boolOf(args, 'json'),
      quiet: boolOf(args, 'quiet'),
      command: name,
    };
    const handler = HANDLERS[name];
    if (handler === undefined) {
      throw new AppError('usage', `"${name}" is not implemented.`);
    }
    return await handler(context);
  } catch (error) {
    if (isAppError(error)) {
      // Errors are always monochrome: they go to stderr, which is read as
      // often by a log as by a terminal.
      io.writeError(`error: ${error.message}\n`);
      if (error.hint !== undefined) io.writeError(`${error.hint}\n`);
      return error.exitCode;
    }
    throw error;
  }
}
