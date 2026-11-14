// Error vocabulary and process exit codes.
//
// Every failure a user can cause is an `AppError` with a stable code. Anything
// else escaping to the entry point is a defect and exits 3.

/** Documented exit codes. These are part of the command-line contract. */
export const ExitCode = {
  /** The command completed and produced the answer it was asked for. */
  Success: 0,
  /** The command could not complete: connection, permission or query error. */
  Failure: 1,
  /** Usage error: unknown command, unknown flag, invalid argument. */
  Usage: 2,
  /** Unexpected internal error. */
  Internal: 3,
  /** Interrupted (128 + SIGINT). */
  Interrupted: 130,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export type ErrorCode =
  | 'usage'
  | 'invalid-connection'
  | 'connection-failed'
  | 'authentication-failed'
  | 'tls-failure'
  | 'timeout'
  | 'query-failed'
  | 'read-only-violation'
  | 'permission-denied'
  | 'not-found'
  | 'limit-exceeded'
  | 'config-invalid'
  | 'export-failed'
  | 'cancelled';

const EXIT_BY_CODE: Record<ErrorCode, ExitCodeValue> = {
  usage: ExitCode.Usage,
  'invalid-connection': ExitCode.Usage,
  'connection-failed': ExitCode.Failure,
  'authentication-failed': ExitCode.Failure,
  'tls-failure': ExitCode.Failure,
  timeout: ExitCode.Failure,
  'query-failed': ExitCode.Failure,
  'read-only-violation': ExitCode.Failure,
  'permission-denied': ExitCode.Failure,
  'not-found': ExitCode.Failure,
  'limit-exceeded': ExitCode.Failure,
  'config-invalid': ExitCode.Usage,
  'export-failed': ExitCode.Failure,
  cancelled: ExitCode.Interrupted,
};

/**
 * An error with a message written for the person who ran the command.
 *
 * Messages must never contain a password or a connection string that still
 * holds one: an error is printed, logged and pasted into issue reports. Every
 * message built from a connection target goes through `core/redact.ts` first.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  /** One line of guidance, printed under the message. */
  readonly hint: string | undefined;

  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.hint = hint;
  }

  get exitCode(): ExitCodeValue {
    return EXIT_BY_CODE[this.code];
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function usageError(message: string, hint?: string): AppError {
  return new AppError('usage', message, hint);
}
