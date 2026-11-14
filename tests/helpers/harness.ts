// Driving the command line from a test.
//
// `run` returns an exit code and writes through the `Io` it is given, so a
// whole command can be exercised in process. Each caller gets its own
// temporary configuration file, so a test never reads or writes the
// configuration of the person running it.

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { run, type Io } from '../../src/cli/run.js';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

export const projectRoot = join(here, '..', '..');
export const builtBinary = join(projectRoot, 'dist', 'bin', 'schema.js');

export function binaryExists(): boolean {
  return existsSync(builtBinary);
}

export interface Outcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface InvokeOptions {
  readonly env?: Record<string, string | undefined>;
  readonly stdoutIsTty?: boolean;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
}

/** The connection string of the disposable server. */
export function testUrl(): string {
  const url = process.env['SCHEMA_TEST_URL'];
  if (url === undefined || url === '') {
    throw new Error(
      'SCHEMA_TEST_URL is not set; the global setup did not run.',
    );
  }
  return url;
}

export function testAdminUrl(): string {
  const url = process.env['SCHEMA_TEST_ADMIN_URL'];
  if (url === undefined || url === '') {
    throw new Error('SCHEMA_TEST_ADMIN_URL is not set.');
  }
  return url;
}

/**
 * A temporary workspace with its own configuration file.
 *
 * `NO_COLOR` is set so that output comparisons are not at the mercy of
 * whether the test runner attached a terminal.
 */
export async function makeWorkspace(): Promise<{
  dir: string;
  env: Record<string, string>;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'schema-test-'));
  const env = {
    SCHEMA_CONFIG: join(dir, 'config.json'),
    NO_COLOR: '1',
    PATH: process.env['PATH'] ?? '',
  };
  return {
    dir,
    env,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function invoke(
  argv: readonly string[],
  options: InvokeOptions = {},
): Promise<Outcome> {
  let stdout = '';
  let stderr = '';
  const env: NodeJS.ProcessEnv = { ...options.env };
  const io: Io = {
    argv,
    env,
    stdoutIsTty: options.stdoutIsTty ?? false,
    write: (text) => {
      stdout += text;
    },
    writeError: (text) => {
      stderr += text;
    },
    signal: options.signal,
    now: options.now,
  };
  const code = await run(io);
  return { code, stdout, stderr };
}

/** Run the built binary as a child process. */
export async function runBinary(
  argv: readonly string[],
  env: Record<string, string> = {},
): Promise<Outcome> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [builtBinary, ...argv],
      { env: { PATH: process.env['PATH'] ?? '', NO_COLOR: '1', ...env } },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

/** Matches a colour escape. The control character is the point of it. */
// eslint-disable-next-line no-control-regex
export const ANSI = /\u001b\[[0-9;]*m/;
