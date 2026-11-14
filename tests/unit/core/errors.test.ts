import { describe, expect, it } from 'vitest';
import {
  AppError,
  ExitCode,
  isAppError,
  usageError,
  type ErrorCode,
  type ExitCodeValue,
} from '../../../src/core/errors.js';

const EXPECTED: readonly (readonly [ErrorCode, ExitCodeValue])[] = [
  ['usage', ExitCode.Usage],
  ['invalid-connection', ExitCode.Usage],
  ['connection-failed', ExitCode.Failure],
  ['authentication-failed', ExitCode.Failure],
  ['tls-failure', ExitCode.Failure],
  ['timeout', ExitCode.Failure],
  ['query-failed', ExitCode.Failure],
  ['read-only-violation', ExitCode.Failure],
  ['permission-denied', ExitCode.Failure],
  ['not-found', ExitCode.Failure],
  ['limit-exceeded', ExitCode.Failure],
  ['config-invalid', ExitCode.Usage],
  ['export-failed', ExitCode.Failure],
  ['cancelled', ExitCode.Interrupted],
];

describe('AppError', () => {
  it.each(EXPECTED)('maps %s to exit code %i', (code, exit) => {
    expect(new AppError(code, 'message').exitCode).toBe(exit);
  });

  it('carries the message and an optional hint', () => {
    const error = new AppError('not-found', 'No such table.', 'Check it.');
    expect(error.name).toBe('AppError');
    expect(error.message).toBe('No such table.');
    expect(error.hint).toBe('Check it.');
    expect(error).toBeInstanceOf(Error);
  });

  it('leaves the hint undefined when none is given', () => {
    expect(new AppError('timeout', 'Too slow.').hint).toBeUndefined();
  });

  it('documents the exit code table', () => {
    expect(ExitCode).toEqual({
      Success: 0,
      Failure: 1,
      Usage: 2,
      Internal: 3,
      Interrupted: 130,
    });
  });
});

describe('isAppError', () => {
  it('recognises an AppError', () => {
    expect(isAppError(new AppError('usage', 'no'))).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isAppError(new Error('no'))).toBe(false);
    expect(isAppError('usage')).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
  });
});

describe('usageError', () => {
  it('builds a usage-coded error', () => {
    const error = usageError('Bad flag.', 'Try --help.');
    expect(error.code).toBe('usage');
    expect(error.exitCode).toBe(ExitCode.Usage);
    expect(error.message).toBe('Bad flag.');
    expect(error.hint).toBe('Try --help.');
  });
});
