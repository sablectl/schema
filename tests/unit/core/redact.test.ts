import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  isSecretEnvName,
  redactConnectionString,
  redactText,
} from '../../../src/core/redact.js';

describe('redactConnectionString', () => {
  it('replaces the password of a parseable connection string', () => {
    expect(
      redactConnectionString('postgresql://alice:hunter2@db:5432/shop'),
    ).toBe(`postgresql://alice:${REDACTED}@db:5432/shop`);
  });

  it('leaves a connection string without a password alone', () => {
    expect(redactConnectionString('postgresql://alice@db:5432/shop')).toBe(
      'postgresql://alice@db:5432/shop',
    );
  });

  it('never leaks the secret itself', () => {
    const text = redactConnectionString('postgres://alice:hunter2@db/shop');
    expect(text).not.toContain('hunter2');
  });

  it('redacts a string the URL parser rejects', () => {
    // An invalid port stops `new URL`, so the fallback pattern runs.
    expect(
      redactConnectionString('postgresql://alice:hunter2@db:nope/shop'),
    ).toBe(`postgresql://alice:${REDACTED}@db:nope/shop`);
  });

  it('redacts a keyword/value connection string', () => {
    // Not URL-shaped, so the fallback runs it through `redactText`.
    expect(redactConnectionString('host=db user=a password=secret')).toBe(
      `host=db user=a password=${REDACTED}`,
    );
  });

  it('returns a string with nothing to redact unchanged', () => {
    expect(redactConnectionString('not a connection string')).toBe(
      'not a connection string',
    );
  });
});

describe('redactText', () => {
  it('redacts a password keyword assignment', () => {
    expect(redactText('password=secret')).toBe(`password=${REDACTED}`);
  });

  it('redacts a quoted value after the keyword', () => {
    expect(redactText("password='x y' host=db")).toBe(
      `password=${REDACTED} host=db`,
    );
  });

  it('redacts a double-quoted value after the keyword', () => {
    expect(redactText('password="a b" host=db')).toBe(
      `password=${REDACTED} host=db`,
    );
  });

  it('redacts a prefixed name such as PGPASSWORD', () => {
    expect(redactText('PGPASSWORD=secret')).toBe(`PGPASSWORD=${REDACTED}`);
    expect(redactText("pgpassword='x y'")).toBe(`pgpassword=${REDACTED}`);
    expect(redactText('my_password=abc')).toBe(`my_password=${REDACTED}`);
  });

  it('leaves an ordinary word that merely ends in those letters alone', () => {
    expect(redactText('crossword=puzzle')).toBe('crossword=puzzle');
    expect(redactText('sword=fish')).toBe('sword=fish');
  });

  it('redacts a connection string embedded in prose', () => {
    expect(
      redactText('could not connect to postgresql://bob:pw@host/db just now'),
    ).toBe(
      `could not connect to postgresql://bob:${REDACTED}@host/db just now`,
    );
  });

  it('leaves text with no secret in it unchanged', () => {
    expect(redactText('relation "users" does not exist')).toBe(
      'relation "users" does not exist',
    );
  });
});

describe('isSecretEnvName', () => {
  it.each([
    'PGPASSWORD',
    'DB_PASSWD',
    'API_KEY',
    'api-key',
    'MY_SECRET',
    'GITHUB_TOKEN',
    'PRIVATE_KEY',
    'AWS_CREDENTIAL',
    'PGPASSFILE',
  ])('treats %s as secret', (name) => {
    expect(isSecretEnvName(name)).toBe(true);
  });

  it.each(['PGHOST', 'PATH', 'TERM', 'SCHEMA_CONFIG'])(
    'treats %s as ordinary',
    (name) => {
      expect(isSecretEnvName(name)).toBe(false);
    },
  );
});
