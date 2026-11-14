#!/usr/bin/env node
// Process entry point.
//
// Everything that touches the process lives here: argv, the environment, the
// output streams, the interrupt handler and the exit code. `run` itself is
// pure enough to be driven from a test.

import process from 'node:process';
import { ExitCode, isAppError } from '../core/errors.js';
import { run } from '../cli/run.js';

const controller = new AbortController();
let interrupted = false;

const onInterrupt = (): void => {
  interrupted = true;
  controller.abort();
};
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onInterrupt);

// A closed pipe is how `| head` ends a command, not a failure.
const write = (stream: NodeJS.WriteStream, text: string): void => {
  try {
    stream.write(text);
  } catch {
    // Nothing useful can be reported once the stream is gone.
  }
};
process.stdout.on('error', () => undefined);
process.stderr.on('error', () => undefined);

try {
  const code = await run({
    argv: process.argv.slice(2),
    env: process.env,
    stdoutIsTty: process.stdout.isTTY,
    write: (text) => {
      write(process.stdout, text);
    },
    writeError: (text) => {
      write(process.stderr, text);
    },
    signal: controller.signal,
  });
  process.exitCode = interrupted ? ExitCode.Interrupted : code;
} catch (error) {
  if (isAppError(error)) {
    write(process.stderr, `error: ${error.message}\n`);
    process.exitCode = error.exitCode;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    write(
      process.stderr,
      `internal error: ${message}\n` +
        'This is a defect. Please report it at ' +
        'https://github.com/sablectl/schema/issues\n',
    );
    process.exitCode = ExitCode.Internal;
  }
}
