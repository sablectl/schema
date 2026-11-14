// Library entry point.
//
// The command line is the supported interface; these exports exist so that
// the same catalogue queries can be reused without shelling out.

export { VERSION } from './version.js';
export {
  AppError,
  ExitCode,
  isAppError,
  type ErrorCode,
  type ExitCodeValue,
} from './core/errors.js';
export {
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  SSL_MODES,
  configPath,
  loadSettings,
  saveSettings,
  type Settings,
  type SslMode,
} from './core/config.js';
export {
  describeTarget,
  parseConnectionUrl,
  redactedUrl,
  resolveTarget,
  type ConnectionOverrides,
  type ConnectionTarget,
} from './core/connection.js';
export { Database, type ConnectionInfo, type RowSet } from './core/client.js';
export * from './core/catalog.js';
export { collectDiagnostics, type Diagnostics } from './core/diagnostics.js';
export {
  DEFAULT_LIMITS,
  runQuery,
  sampleRelation,
  type QueryLimits,
  type QueryOutcome,
} from './core/query.js';
export {
  formatQualifiedName,
  parseQualifiedName,
  quoteIdentifier,
} from './core/identifiers.js';
export { toMermaid, describeEdge } from './core/relations.js';
export {
  assertRunnable,
  hasMultipleStatements,
  leadingKeyword,
  stripLiterals,
} from './core/statement.js';
export { toCsv } from './output/csv.js';
export { run, type Io } from './cli/run.js';
