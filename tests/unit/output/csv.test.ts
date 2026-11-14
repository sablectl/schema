import { describe, expect, it } from 'vitest';
import { csvField, toCsv } from '../../../src/output/csv.js';

describe('csvField', () => {
  it('writes a NULL as an empty unquoted field', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });

  it('quotes the empty string, so it differs from a NULL', () => {
    expect(csvField('')).toBe('""');
  });

  it('leaves an ordinary value unquoted', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField(42)).toBe('42');
    expect(csvField(true)).toBe('true');
  });

  it('quotes a value containing a comma', () => {
    expect(csvField('a,b')).toBe('"a,b"');
  });

  it('quotes a value containing a quote and doubles it', () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes a value containing a carriage return or newline', () => {
    expect(csvField('a\rb')).toBe('"a\rb"');
    expect(csvField('a\nb')).toBe('"a\nb"');
  });

  it('formats a value before quoting it', () => {
    expect(csvField(new Date(Date.UTC(2024, 0, 2)))).toBe(
      '2024-01-02T00:00:00.000Z',
    );
    // The braces form holds a comma, so it is quoted like any other field.
    expect(csvField([1, 2])).toBe('"{1,2}"');
  });
});

describe('toCsv', () => {
  it('writes a header row and CRLF line endings', () => {
    expect(
      toCsv(
        ['id', 'name'],
        [
          [1, 'alice'],
          [2, null],
        ],
      ),
    ).toBe('id,name\r\n1,alice\r\n2,\r\n');
  });

  it('writes the header alone when there are no rows', () => {
    expect(toCsv(['id'], [])).toBe('id\r\n');
  });

  it('quotes a header that needs it', () => {
    expect(toCsv(['a,b'], [])).toBe('"a,b"\r\n');
  });

  it('always ends with a line break', () => {
    expect(toCsv(['id'], [[1]]).endsWith('\r\n')).toBe(true);
  });
});
