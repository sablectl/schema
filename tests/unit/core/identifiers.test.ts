import { describe, expect, it } from 'vitest';
import {
  formatQualifiedName,
  maybeQuote,
  parseQualifiedName,
  quoteIdentifier,
} from '../../../src/core/identifiers.js';
import { isAppError } from '../../../src/core/errors.js';

describe('quoteIdentifier', () => {
  it('always quotes, even a plain lower-case name', () => {
    expect(quoteIdentifier('users')).toBe('"users"');
  });

  it('preserves case rather than folding it', () => {
    expect(quoteIdentifier('MyTable')).toBe('"MyTable"');
  });

  it('doubles an embedded double quote', () => {
    expect(quoteIdentifier('we"ird')).toBe('"we""ird"');
  });

  it('refuses a NUL byte', () => {
    expect(() => quoteIdentifier('bad\0name')).toThrow(/NUL byte/);
    try {
      quoteIdentifier('bad\0name');
      expect.unreachable();
    } catch (error) {
      expect(isAppError(error) && error.code).toBe('usage');
    }
  });
});

describe('parseQualifiedName', () => {
  it('reads a bare name', () => {
    expect(parseQualifiedName('users')).toEqual({
      schema: undefined,
      name: 'users',
    });
  });

  it('reads a schema-qualified name', () => {
    expect(parseQualifiedName('public.users')).toEqual({
      schema: 'public',
      name: 'users',
    });
  });

  it('reads a fully quoted qualified name literally', () => {
    expect(parseQualifiedName('"My Schema"."My Table"')).toEqual({
      schema: 'My Schema',
      name: 'My Table',
    });
  });

  it('reads a mixed quoted and unquoted name', () => {
    expect(parseQualifiedName('public."My Table"')).toEqual({
      schema: 'public',
      name: 'My Table',
    });
  });

  it('lower-cases an unquoted part, as the server would', () => {
    expect(parseQualifiedName('Public.Users')).toEqual({
      schema: 'public',
      name: 'users',
    });
  });

  it('keeps a quoted part exactly as written', () => {
    expect(parseQualifiedName('"Users"')).toEqual({
      schema: undefined,
      name: 'Users',
    });
  });

  it('treats a dot inside quotes as part of the name', () => {
    expect(parseQualifiedName('"a.b"')).toEqual({
      schema: undefined,
      name: 'a.b',
    });
  });

  it('unescapes a doubled quote inside a quoted part', () => {
    expect(parseQualifiedName('"we""ird"')).toEqual({
      schema: undefined,
      name: 'we"ird',
    });
  });

  it('rejects an unterminated quote', () => {
    expect(() => parseQualifiedName('"users')).toThrow(
      /unterminated quoted identifier/,
    );
  });

  it('rejects three parts', () => {
    expect(() => parseQualifiedName('a.b.c')).toThrow(/too many parts/);
  });

  it('rejects an empty name', () => {
    expect(() => parseQualifiedName('')).toThrow(/is not a table name/);
  });

  it('rejects an empty schema', () => {
    expect(() => parseQualifiedName('.users')).toThrow(/empty schema name/);
  });

  it('reports a usage error', () => {
    try {
      parseQualifiedName('a.b.c');
      expect.unreachable();
    } catch (error) {
      expect(isAppError(error) && error.code).toBe('usage');
    }
  });
});

describe('maybeQuote', () => {
  it('leaves a simple lower-case name unquoted', () => {
    expect(maybeQuote('users')).toBe('users');
    expect(maybeQuote('_private$1')).toBe('_private$1');
  });

  it('quotes anything else', () => {
    expect(maybeQuote('Users')).toBe('"Users"');
    expect(maybeQuote('my table')).toBe('"my table"');
    expect(maybeQuote('1st')).toBe('"1st"');
  });
});

describe('formatQualifiedName', () => {
  it('quotes only the parts that need it', () => {
    expect(formatQualifiedName('public', 'users')).toBe('public.users');
    expect(formatQualifiedName('My Schema', 'users')).toBe('"My Schema".users');
  });
});
