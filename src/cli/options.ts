// Option tables.
//
// Kept apart from the command implementations so that the help text and the
// parser are generated from one description of each option, and a command
// cannot advertise a flag it does not read.

import type { OptionSpec } from './args.js';

export const GLOBAL_OPTIONS: Record<string, OptionSpec> = {
  help: { kind: 'boolean', short: 'h', describe: 'Show this help and exit.' },
  version: {
    kind: 'boolean',
    short: 'v',
    describe: 'Show the release number and exit.',
  },
  json: { kind: 'boolean', describe: 'Write a JSON report to stdout.' },
  quiet: {
    kind: 'boolean',
    short: 'q',
    describe: 'Print only the result, with no summary lines.',
  },
  'no-color': { kind: 'boolean', describe: 'Never colour the output.' },
};

export const CONNECTION_OPTIONS: Record<string, OptionSpec> = {
  url: {
    kind: 'string',
    describe: 'Connection string, postgresql://user@host:5432/database.',
    valueName: 'URL',
  },
  host: {
    kind: 'string',
    short: 'H',
    describe: 'Server host name or address.',
    valueName: 'HOST',
  },
  port: {
    kind: 'string',
    short: 'p',
    describe: 'Server port.',
    valueName: 'PORT',
  },
  dbname: {
    kind: 'string',
    short: 'd',
    describe: 'Database name.',
    valueName: 'NAME',
  },
  user: {
    kind: 'string',
    short: 'U',
    describe: 'Role to connect as.',
    valueName: 'NAME',
  },
  'password-env': {
    kind: 'string',
    describe: 'Read the password from this environment variable.',
    valueName: 'NAME',
  },
  'ssl-mode': {
    kind: 'string',
    describe:
      'disable, prefer, require, verify-ca or verify-full (default prefer).',
    valueName: 'MODE',
  },
  'ssl-root-cert': {
    kind: 'string',
    describe: 'PEM certificate authority for verify-ca and verify-full.',
    valueName: 'PATH',
  },
  'connect-timeout': {
    kind: 'string',
    describe: 'Milliseconds to wait for the connection.',
    valueName: 'MS',
  },
  'statement-timeout': {
    kind: 'string',
    describe: 'Milliseconds a single statement may run.',
    valueName: 'MS',
  },
};

export const SYSTEM_OPTIONS: Record<string, OptionSpec> = {
  system: {
    kind: 'boolean',
    describe: 'Include pg_catalog and the other system schemas.',
  },
};

export const SCHEMA_FILTER_OPTIONS: Record<string, OptionSpec> = {
  schema: {
    kind: 'string',
    short: 's',
    describe: 'Restrict the listing to one schema.',
    valueName: 'NAME',
  },
};

export const LIMIT_OPTIONS: Record<string, OptionSpec> = {
  limit: {
    kind: 'string',
    short: 'n',
    describe: 'Maximum rows to read.',
    valueName: 'N',
  },
  'max-bytes': {
    kind: 'string',
    describe: 'Approximate byte budget for the result.',
    valueName: 'N',
  },
};
