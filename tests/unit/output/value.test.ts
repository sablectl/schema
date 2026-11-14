import { describe, expect, it } from 'vitest';
import {
  NULL_TEXT,
  formatBytes,
  formatCount,
  formatMs,
  formatValue,
  jsonValue,
  printable,
  truncate,
} from '../../../src/output/value.js';

describe('formatValue', () => {
  it('writes NULL for null and undefined', () => {
    expect(formatValue(null)).toBe(NULL_TEXT);
    expect(formatValue(undefined)).toBe('NULL');
  });

  it('passes a string through, empty string included', () => {
    expect(formatValue('text')).toBe('text');
    expect(formatValue('')).toBe('');
  });

  it('writes numbers and bigints as digits', () => {
    expect(formatValue(42)).toBe('42');
    expect(formatValue(-1.5)).toBe('-1.5');
    expect(formatValue(9_007_199_254_740_993n)).toBe('9007199254740993');
  });

  it('writes booleans as words', () => {
    expect(formatValue(true)).toBe('true');
    expect(formatValue(false)).toBe('false');
  });

  it('writes a Date as ISO 8601 in UTC', () => {
    expect(formatValue(new Date(Date.UTC(2024, 0, 2, 3, 4, 5, 6)))).toBe(
      '2024-01-02T03:04:05.006Z',
    );
  });

  it('reports an invalid Date rather than throwing', () => {
    expect(formatValue(new Date('nonsense'))).toBe('Invalid Date');
  });

  it('writes a byte array in PostgreSQL hex form', () => {
    expect(formatValue(new Uint8Array([0xde, 0xad, 0x00]))).toBe('\\xdead00');
    expect(formatValue(new Uint8Array())).toBe('\\x');
  });

  it('writes an array in braces', () => {
    expect(formatValue([1, 'two', null])).toBe('{1,two,NULL}');
    expect(formatValue([])).toBe('{}');
  });

  it('writes a plain object as JSON', () => {
    expect(formatValue({ a: 1, b: 'two' })).toBe('{"a":1,"b":"two"}');
  });

  it('reports an object whose toJSON throws', () => {
    const awkward = {
      toJSON(): never {
        throw new Error('no');
      },
    };
    expect(formatValue(awkward)).toBe('unprintable value');
  });

  it('reports a circular object', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(formatValue(circular)).toBe('unprintable value');
  });
});

describe('jsonValue', () => {
  it('normalises null and undefined to null', () => {
    expect(jsonValue(null)).toBeNull();
    expect(jsonValue(undefined)).toBeNull();
  });

  it('renders a Date and a byte array as text', () => {
    expect(jsonValue(new Date(Date.UTC(2024, 0, 2)))).toBe(
      '2024-01-02T00:00:00.000Z',
    );
    expect(jsonValue(new Uint8Array([1, 2]))).toBe('\\x0102');
  });

  it('renders a bigint as a string so precision survives', () => {
    expect(jsonValue(9_007_199_254_740_993n)).toBe('9007199254740993');
  });

  it('passes everything else through untouched', () => {
    const object = { a: 1 };
    expect(jsonValue(object)).toBe(object);
    expect(jsonValue('text')).toBe('text');
    expect(jsonValue(7)).toBe(7);
  });
});

describe('printable', () => {
  it('escapes newline, carriage return and tab', () => {
    expect(printable('a\nb\rc\td')).toBe('a\\nb\\rc\\td');
  });

  it('escapes a NUL byte and an ANSI escape', () => {
    expect(printable('a\0b')).toBe('a\\x00b');
    expect(printable('\u001b[31mred')).toBe('\\x1b[31mred');
  });

  it('escapes delete', () => {
    expect(printable('a\u007fb')).toBe('a\\x7fb');
  });

  it('escapes C1 controls', () => {
    expect(printable('a\u009bb')).toBe('a\\u009bb');
  });

  it('escapes the bidirectional overrides used to disguise names', () => {
    expect(printable('invoice\u202Egnp.exe')).toBe('invoice\\u202egnp.exe');
    expect(printable('a\u202Ab')).toBe('a\\u202ab');
  });

  it('neutralises a line-rewriting sequence', () => {
    const escaped = printable('evil\u001B[2K\r0 rows');
    expect(escaped).not.toContain('\u001B');
    expect(escaped).not.toContain('\r');
    expect(escaped).toBe('evil\\x1b[2K\\r0 rows');
  });

  it('leaves ordinary text alone', () => {
    expect(printable('ordinary — text')).toBe('ordinary — text');
  });
});

describe('truncate', () => {
  it('leaves text within the limit alone', () => {
    expect(truncate('abc', 3)).toBe('abc');
    expect(truncate('abc', 10)).toBe('abc');
  });

  it('cuts longer text and marks it with an ellipsis', () => {
    expect(truncate('abcdef', 3)).toBe('ab…');
  });

  it('treats a limit of one as the ellipsis alone', () => {
    expect(truncate('abcdef', 1)).toBe('…');
  });

  it('treats a limit of zero or less as no limit', () => {
    // Deliberate and documented: zero switches truncation off rather than
    // cutting every cell down to nothing.
    expect(truncate('abcdef', 0)).toBe('abcdef');
    expect(truncate('abcdef', -1)).toBe('abcdef');
  });
});

describe('formatBytes', () => {
  it('says so when the size is unavailable', () => {
    expect(formatBytes(null)).toBe('not available');
  });

  it('writes bytes without a decimal part', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('scales to the largest unit that fits', () => {
    expect(formatBytes(1024)).toBe('1.0 KiB');
    expect(formatBytes(1536)).toBe('1.5 KiB');
    expect(formatBytes(1024 ** 2)).toBe('1.0 MiB');
    expect(formatBytes(1024 ** 3)).toBe('1.0 GiB');
    expect(formatBytes(1024 ** 4)).toBe('1.0 TiB');
  });

  it('stops at tebibytes', () => {
    expect(formatBytes(1024 ** 5)).toBe('1024.0 TiB');
  });
});

describe('formatCount', () => {
  it('says unknown for null', () => {
    expect(formatCount(null)).toBe('unknown');
  });

  it('groups the digits', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(1_234_567)).toBe('1,234,567');
  });
});

describe('formatMs', () => {
  it('uses two decimals below a millisecond', () => {
    expect(formatMs(0.123)).toBe('0.12 ms');
    expect(formatMs(0)).toBe('0.00 ms');
  });

  it('rounds to whole milliseconds below a second', () => {
    expect(formatMs(1)).toBe('1 ms');
    expect(formatMs(12.5)).toBe('13 ms');
    expect(formatMs(999)).toBe('999 ms');
  });

  it('uses seconds from a thousand milliseconds', () => {
    expect(formatMs(1000)).toBe('1.00 s');
    expect(formatMs(1500)).toBe('1.50 s');
  });
});
