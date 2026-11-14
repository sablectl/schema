// Configuration file handling.
//
// Settings are optional. Precedence is command line, then configuration file,
// then the built-in default. Unknown keys are refused rather than ignored, so
// a typo in a setting is reported instead of silently doing nothing.
//
// No connection string, user name or password is ever written here. Where to
// connect comes from the command line or from the standard PostgreSQL
// environment variables on every run, so a credential cannot be left behind
// in a file by accident.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { AppError } from './errors.js';

export const SSL_MODES = [
  'disable',
  'prefer',
  'require',
  'verify-ca',
  'verify-full',
] as const;

export type SslMode = (typeof SSL_MODES)[number];

export function isSslMode(value: string): value is SslMode {
  return (SSL_MODES as readonly string[]).includes(value);
}

export interface Settings {
  readonly connectTimeoutMs: number;
  readonly statementTimeoutMs: number;
  /** Rows retained from a query result. Further rows are not fetched. */
  readonly maxRows: number;
  /** Characters kept per cell in human-readable tables. */
  readonly maxCellChars: number;
  readonly sslMode: SslMode;
  /** Include pg_catalog, information_schema and the like in listings. */
  readonly includeSystemSchemas: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  connectTimeoutMs: 10_000,
  statementTimeoutMs: 15_000,
  maxRows: 200,
  maxCellChars: 120,
  sslMode: 'prefer',
  includeSystemSchemas: false,
};

type SettingKey = keyof Settings;

const NUMERIC_KEYS: readonly SettingKey[] = [
  'connectTimeoutMs',
  'statementTimeoutMs',
  'maxRows',
  'maxCellChars',
];

const BOOLEAN_KEYS: readonly SettingKey[] = ['includeSystemSchemas'];

const ENUM_KEYS: readonly SettingKey[] = ['sslMode'];

export const SETTING_KEYS: readonly SettingKey[] = [
  ...NUMERIC_KEYS,
  ...BOOLEAN_KEYS,
  ...ENUM_KEYS,
].sort();

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key);
}

function baseDir(env: NodeJS.ProcessEnv): string {
  const xdg = env['XDG_CONFIG_HOME'];
  if (xdg !== undefined && xdg !== '') return join(xdg, 'schema');
  return join(homedir(), '.config', 'schema');
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env['SCHEMA_CONFIG'];
  if (explicit !== undefined && explicit !== '') return explicit;
  return join(baseDir(env), 'config.json');
}

function parseValue(key: SettingKey, value: unknown, where: string): unknown {
  if (NUMERIC_KEYS.includes(key)) {
    // An empty string would otherwise become 0, which is a valid setting and
    // not at all what was meant.
    const numeric =
      typeof value === 'string'
        ? value.trim() === ''
          ? Number.NaN
          : Number(value)
        : value;
    if (
      typeof numeric !== 'number' ||
      !Number.isFinite(numeric) ||
      numeric < 0 ||
      !Number.isInteger(numeric)
    ) {
      throw new AppError(
        'config-invalid',
        `${where}: "${key}" must be a non-negative whole number.`,
      );
    }
    return numeric;
  }
  if (BOOLEAN_KEYS.includes(key)) {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new AppError(
      'config-invalid',
      `${where}: "${key}" must be true or false.`,
    );
  }
  if (typeof value !== 'string' || !isSslMode(value)) {
    throw new AppError(
      'config-invalid',
      `${where}: "${key}" must be one of ${SSL_MODES.join(', ')}.`,
    );
  }
  return value;
}

/** Validate an arbitrary object into a partial settings patch. */
export function parseSettings(
  input: unknown,
  where: string,
): Partial<Settings> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('config-invalid', `${where}: expected a JSON object.`);
  }
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isSettingKey(key)) {
      throw new AppError(
        'config-invalid',
        `${where}: "${key}" is not a known setting.`,
        `Known settings: ${SETTING_KEYS.join(', ')}.`,
      );
    }
    patch[key] = parseValue(key, value, where);
  }
  return patch;
}

export async function loadSettings(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ settings: Settings; path: string; exists: boolean }> {
  const path = configPath(env);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return { settings: DEFAULT_SETTINGS, path, exists: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError('config-invalid', `${path} is not valid JSON.`);
  }
  const patch = parseSettings(parsed, path);
  return { settings: { ...DEFAULT_SETTINGS, ...patch }, path, exists: true };
}

/** Write the file atomically, owner-readable only. */
export async function saveSettings(
  patch: Partial<Settings>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const path = configPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(patch, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
  return path;
}

/** The settings written to the file, without defaults filled in. */
export async function loadStoredPatch(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Partial<Settings>> {
  const path = configPath(env);
  try {
    const text = await readFile(path, 'utf8');
    return parseSettings(JSON.parse(text), path);
  } catch (error) {
    if (error instanceof AppError) throw error;
    return {};
  }
}
