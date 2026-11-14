import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  SSL_MODES,
  configPath,
  isSettingKey,
  isSslMode,
  loadSettings,
  loadStoredPatch,
  parseSettings,
  saveSettings,
} from '../../../src/core/config.js';
import { isAppError } from '../../../src/core/errors.js';

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return isAppError(error) ? error.code : 'not-an-app-error';
  }
  return 'no-error';
}

describe('setting keys', () => {
  it('lists every setting, sorted', () => {
    expect([...SETTING_KEYS]).toEqual([
      'connectTimeoutMs',
      'includeSystemSchemas',
      'maxCellChars',
      'maxRows',
      'sslMode',
      'statementTimeoutMs',
    ]);
  });

  it('covers exactly the keys of the defaults', () => {
    expect([...SETTING_KEYS].sort()).toEqual(
      Object.keys(DEFAULT_SETTINGS).sort(),
    );
  });

  it('recognises known keys only', () => {
    expect(isSettingKey('maxRows')).toBe(true);
    expect(isSettingKey('maxrows')).toBe(false);
    expect(isSettingKey('nonsense')).toBe(false);
  });
});

describe('isSslMode', () => {
  it.each(SSL_MODES)('accepts %s', (mode) => {
    expect(isSslMode(mode)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isSslMode('allow')).toBe(false);
    expect(isSslMode('')).toBe(false);
  });
});

describe('parseSettings', () => {
  it('accepts well-typed values', () => {
    expect(
      parseSettings(
        {
          connectTimeoutMs: 5000,
          maxRows: 10,
          includeSystemSchemas: true,
          sslMode: 'require',
        },
        'test',
      ),
    ).toEqual({
      connectTimeoutMs: 5000,
      maxRows: 10,
      includeSystemSchemas: true,
      sslMode: 'require',
    });
  });

  it('accepts numbers and booleans spelled as strings', () => {
    expect(
      parseSettings({ maxRows: '25', includeSystemSchemas: 'false' }, 'test'),
    ).toEqual({ maxRows: 25, includeSystemSchemas: false });
  });

  it('accepts an empty object', () => {
    expect(parseSettings({}, 'test')).toEqual({});
  });

  it('accepts zero as a number', () => {
    expect(parseSettings({ maxRows: 0 }, 'test')).toEqual({ maxRows: 0 });
  });

  it('rejects an unknown key, naming the known ones', () => {
    try {
      parseSettings({ maxRow: 1 }, 'test');
      expect.unreachable();
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (!isAppError(error)) return;
      expect(error.code).toBe('config-invalid');
      expect(error.message).toContain('"maxRow" is not a known setting');
      expect(error.hint).toContain('connectTimeoutMs');
    }
  });

  it.each([
    ['a non-object', 'nope'],
    ['null', null],
    ['an array', []],
    ['a wrongly typed number', { maxRows: true }],
    ['a negative number', { maxRows: -1 }],
    ['a fractional number', { maxRows: 1.5 }],
    ['a non-numeric string', { maxRows: 'many' }],
    ['an empty string for a number', { maxRows: '' }],
    ['a whitespace-only number', { maxRows: '  ' }],
    ['a wrongly typed boolean', { includeSystemSchemas: 'yes' }],
    ['a bad sslMode', { sslMode: 'allow' }],
    ['a non-string sslMode', { sslMode: 3 }],
  ])('rejects %s', (_label, input) => {
    expect(codeOf(() => parseSettings(input, 'test'))).toBe('config-invalid');
  });

  it('prefixes the message with the place it came from', () => {
    try {
      parseSettings({ maxRows: -1 }, '/tmp/config.json');
      expect.unreachable();
    } catch (error) {
      expect(isAppError(error) && error.message).toContain('/tmp/config.json');
    }
  });
});

describe('configPath', () => {
  it('honours SCHEMA_CONFIG first', () => {
    expect(
      configPath({
        SCHEMA_CONFIG: '/etc/schema.json',
        XDG_CONFIG_HOME: '/xdg',
      }),
    ).toBe('/etc/schema.json');
  });

  it('falls back to XDG_CONFIG_HOME', () => {
    expect(configPath({ XDG_CONFIG_HOME: '/xdg' })).toBe(
      join('/xdg', 'schema', 'config.json'),
    );
  });

  it('ignores an empty variable', () => {
    expect(configPath({ SCHEMA_CONFIG: '', XDG_CONFIG_HOME: '/xdg' })).toBe(
      join('/xdg', 'schema', 'config.json'),
    );
  });

  it('falls back to the home directory', () => {
    expect(configPath({})).toBe(
      join(homedir(), '.config', 'schema', 'config.json'),
    );
  });
});

describe('loading and saving', () => {
  let directory: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'schema-config-'));
    env = { SCHEMA_CONFIG: join(directory, 'nested', 'config.json') };
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reports the defaults when no file exists', async () => {
    const loaded = await loadSettings(env);
    expect(loaded.settings).toEqual(DEFAULT_SETTINGS);
    expect(loaded.exists).toBe(false);
    expect(loaded.path).toBe(env['SCHEMA_CONFIG']);
  });

  it('reports an empty patch when no file exists', async () => {
    expect(await loadStoredPatch(env)).toEqual({});
  });

  it('round trips a patch and fills the rest from the defaults', async () => {
    const path = await saveSettings({ maxRows: 7, sslMode: 'require' }, env);
    expect(path).toBe(env['SCHEMA_CONFIG']);

    expect(await loadStoredPatch(env)).toEqual({
      maxRows: 7,
      sslMode: 'require',
    });

    const loaded = await loadSettings(env);
    expect(loaded.exists).toBe(true);
    expect(loaded.settings).toEqual({
      ...DEFAULT_SETTINGS,
      maxRows: 7,
      sslMode: 'require',
    });
  });

  it('writes the file readable by its owner only', async () => {
    const path = await saveSettings({ maxRows: 7 }, env);
    const stats = await stat(path);
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it('rejects invalid JSON on disk', async () => {
    const path = join(directory, 'config.json');
    await writeFile(path, '{ not json', 'utf8');
    await expect(loadSettings({ SCHEMA_CONFIG: path })).rejects.toThrow(
      /is not valid JSON/,
    );
  });

  it('treats invalid JSON as absent when reading the stored patch', async () => {
    const path = join(directory, 'config.json');
    await writeFile(path, '{ not json', 'utf8');
    expect(await loadStoredPatch({ SCHEMA_CONFIG: path })).toEqual({});
  });

  it('rejects an unknown key stored on disk', async () => {
    const path = join(directory, 'config.json');
    await writeFile(path, '{"nonsense": 1}', 'utf8');
    await expect(loadStoredPatch({ SCHEMA_CONFIG: path })).rejects.toThrow(
      /is not a known setting/,
    );
  });
});
