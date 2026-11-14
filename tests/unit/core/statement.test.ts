import { describe, expect, it } from 'vitest';
import {
  assertRunnable,
  hasMultipleStatements,
  leadingKeyword,
  stripLiterals,
} from '../../../src/core/statement.js';
import { isAppError } from '../../../src/core/errors.js';

function codeOf(sql: string): string {
  try {
    assertRunnable(sql);
  } catch (error) {
    return isAppError(error) ? error.code : 'not-an-app-error';
  }
  return 'no-error';
}

describe('stripLiterals', () => {
  it('removes a line comment to the end of the line', () => {
    expect(stripLiterals('SELECT 1 -- a comment\nFROM t')).toBe(
      'SELECT 1  \nFROM t',
    );
    expect(stripLiterals('SELECT 1 -- a comment')).not.toContain('comment');
  });

  it('removes a block comment', () => {
    expect(stripLiterals('SELECT /* here */ 1')).toBe('SELECT   1');
  });

  it('removes nested block comments', () => {
    expect(stripLiterals('SELECT /* a /* b */ c */ 1')).toBe('SELECT   1');
  });

  it('removes a single-quoted string, doubled quotes included', () => {
    expect(stripLiterals("SELECT 'it''s here' AS x")).toBe('SELECT   AS x');
  });

  it('removes a dollar-quoted body with no tag', () => {
    expect(stripLiterals('SELECT $$ a ; b $$ AS x')).toBe('SELECT   AS x');
  });

  it('removes a dollar-quoted body with a tag', () => {
    expect(stripLiterals('SELECT $tag$ a ; b $tag$ AS x')).toBe(
      'SELECT   AS x',
    );
  });

  it('removes a double-quoted identifier', () => {
    expect(stripLiterals('SELECT "odd; name" FROM t')).toBe('SELECT   FROM t');
  });

  it('leaves ordinary SQL alone', () => {
    expect(stripLiterals('SELECT a, b FROM t')).toBe('SELECT a, b FROM t');
  });
});

describe('leadingKeyword', () => {
  it('reads the first word, lower-cased', () => {
    expect(leadingKeyword('SELECT 1')).toBe('select');
    expect(leadingKeyword('  WiTh x AS (SELECT 1) SELECT * FROM x')).toBe(
      'with',
    );
  });

  it('ignores a leading line comment', () => {
    expect(leadingKeyword('-- explain this\nSELECT 1')).toBe('select');
  });

  it('ignores a leading block comment', () => {
    expect(leadingKeyword('/* explain this */ SELECT 1')).toBe('select');
  });

  it('is empty for an empty statement', () => {
    expect(leadingKeyword('   ')).toBe('');
    expect(leadingKeyword('-- only a comment')).toBe('');
  });
});

describe('hasMultipleStatements', () => {
  it('is true for two statements', () => {
    expect(hasMultipleStatements('SELECT 1; SELECT 2')).toBe(true);
  });

  it('is false for a trailing semicolon', () => {
    expect(hasMultipleStatements('SELECT 1;')).toBe(false);
    expect(hasMultipleStatements('SELECT 1;  \n ')).toBe(false);
  });

  it('is false with no semicolon at all', () => {
    expect(hasMultipleStatements('SELECT 1')).toBe(false);
  });

  it('is false for a semicolon inside a literal', () => {
    expect(hasMultipleStatements("SELECT 'a; b'")).toBe(false);
  });

  it('is false for a semicolon inside a comment', () => {
    expect(hasMultipleStatements('SELECT 1 -- ; not a statement')).toBe(false);
    expect(hasMultipleStatements('SELECT /* ; */ 1')).toBe(false);
  });
});

describe('assertRunnable', () => {
  it.each([
    'SELECT 1',
    'select 1',
    'WITH x AS (SELECT 1) SELECT * FROM x',
    'TABLE users',
    'VALUES (1), (2)',
    'EXPLAIN SELECT 1',
    'show search_path',
    'ExPlAiN SELECT 1',
    '-- a comment\nSELECT 1',
    'SELECT 1;',
  ])('allows %j', (sql) => {
    expect(() => {
      assertRunnable(sql);
    }).not.toThrow();
  });

  it.each([
    'INSERT INTO t VALUES (1)',
    'UPDATE t SET a = 1',
    'DELETE FROM t',
    'CREATE TABLE t (a int)',
    'DROP TABLE t',
    'ALTER TABLE t ADD COLUMN b int',
    'TRUNCATE t',
    'truncate t',
  ])('refuses %j as a read-only violation', (sql) => {
    expect(codeOf(sql)).toBe('read-only-violation');
    expect(() => {
      assertRunnable(sql);
    }).toThrow(/does not run/);
  });

  it.each([
    "COPY customers TO '/tmp/x'",
    'SET search_path = public',
    'BEGIN',
    'COMMIT',
    '',
    '   ',
  ])('refuses %j as a usage error', (sql) => {
    expect(codeOf(sql)).toBe('usage');
  });

  it('says the statement is empty when there is nothing to run', () => {
    expect(() => {
      assertRunnable('   ');
    }).toThrow(/statement is empty/);
  });

  it('refuses two statements before looking at the keyword', () => {
    expect(() => {
      assertRunnable('SELECT 1; SELECT 2');
    }).toThrow(/one statement at a time/);
    expect(codeOf('SELECT 1; SELECT 2')).toBe('usage');
  });

  it('is not fooled by a keyword hidden in a literal', () => {
    expect(() => {
      assertRunnable("SELECT 'INSERT INTO t'");
    }).not.toThrow();
  });

  it('explains the read-only transaction when refusing a write', () => {
    try {
      assertRunnable('INSERT INTO t VALUES (1)');
      expect.unreachable();
    } catch (error) {
      expect(isAppError(error) && error.hint).toContain('read-only');
    }
  });
});
