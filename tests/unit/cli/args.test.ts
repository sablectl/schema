import { describe, expect, it } from 'vitest';
import {
  boolOf,
  listOf,
  merge,
  numberOf,
  parseArgs,
  stringOf,
  type OptionSpec,
} from '../../../src/cli/args.js';
import { isAppError } from '../../../src/core/errors.js';

const SPECS: Record<string, OptionSpec> = {
  help: { kind: 'boolean', short: 'h', describe: 'Show help.' },
  host: { kind: 'string', short: 'H', describe: 'Host.' },
  param: { kind: 'list', describe: 'A parameter.' },
  limit: { kind: 'string', short: 'n', describe: 'Limit.' },
};

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return isAppError(error) ? error.code : 'not-an-app-error';
  }
  return 'no-error';
}

describe('parseArgs', () => {
  it('reads a long boolean option', () => {
    const args = parseArgs(['--help'], SPECS);
    expect(boolOf(args, 'help')).toBe(true);
    expect(boolOf(args, 'missing')).toBe(false);
  });

  it('reads a short option', () => {
    expect(stringOf(parseArgs(['-H', 'db'], SPECS), 'host')).toBe('db');
    expect(boolOf(parseArgs(['-h'], SPECS), 'help')).toBe(true);
  });

  it('reads --name=value', () => {
    expect(stringOf(parseArgs(['--host=db'], SPECS), 'host')).toBe('db');
  });

  it('accepts an empty value after the equals sign', () => {
    expect(stringOf(parseArgs(['--host='], SPECS), 'host')).toBe('');
  });

  it('reads a separate value', () => {
    expect(stringOf(parseArgs(['--host', 'db'], SPECS), 'host')).toBe('db');
  });

  it('collects a repeated list option in order', () => {
    const args = parseArgs(['--param', 'a', '--param=b'], SPECS);
    expect(listOf(args, 'param')).toEqual(['a', 'b']);
    expect(listOf(args, 'host')).toEqual([]);
  });

  it('lets the last of a repeated string option win', () => {
    expect(
      stringOf(parseArgs(['--host', 'one', '--host', 'two'], SPECS), 'host'),
    ).toBe('two');
  });

  it('collects positional arguments', () => {
    const args = parseArgs(['tables', 'public.%', '--help'], SPECS);
    expect(args.positional).toEqual(['tables', 'public.%']);
  });

  it('treats everything after -- as positional', () => {
    const args = parseArgs(['--', '--host', '-h'], SPECS);
    expect(args.positional).toEqual(['--host', '-h']);
    expect(boolOf(args, 'help')).toBe(false);
  });

  it('treats a lone - as positional', () => {
    expect(parseArgs(['-'], SPECS).positional).toEqual(['-']);
  });

  it('rejects an unknown long option', () => {
    expect(() => parseArgs(['--nonsense'], SPECS)).toThrow(
      /Unknown option "--nonsense"/,
    );
  });

  it('rejects an unknown short option', () => {
    expect(() => parseArgs(['-z'], SPECS)).toThrow(/Unknown option "-z"/);
  });

  it('rejects a missing value', () => {
    expect(() => parseArgs(['--host'], SPECS)).toThrow(
      /Option "--host" needs a value/,
    );
  });

  it('rejects a value given to a boolean option', () => {
    expect(() => parseArgs(['--help=yes'], SPECS)).toThrow(
      /does not take a value/,
    );
  });

  it('reports a usage error', () => {
    try {
      parseArgs(['--nonsense'], SPECS);
      expect.unreachable();
    } catch (error) {
      expect(isAppError(error) && error.code).toBe('usage');
    }
  });

  it('returns empty collections for empty input', () => {
    const args = parseArgs([], SPECS);
    expect(args.positional).toEqual([]);
    expect(args.booleans.size).toBe(0);
    expect(args.strings.size).toBe(0);
    expect(args.lists.size).toBe(0);
  });
});

describe('numberOf', () => {
  it('returns the fallback when the option is absent', () => {
    expect(numberOf(parseArgs([], SPECS), 'limit', 42)).toBe(42);
  });

  it('reads a whole number', () => {
    expect(numberOf(parseArgs(['--limit', '10'], SPECS), 'limit', 42)).toBe(10);
    expect(numberOf(parseArgs(['--limit', '0'], SPECS), 'limit', 42)).toBe(0);
  });

  it.each(['-1', '1.5', 'many', 'Infinity'])('rejects %j', (value) => {
    expect(() =>
      numberOf(parseArgs(['--limit', value], SPECS), 'limit', 42),
    ).toThrow(/must be a non-negative whole number/);
  });

  it('rejects an empty value rather than reading it as zero', () => {
    expect(() => numberOf(parseArgs(['--limit='], SPECS), 'limit', 42)).toThrow(
      /must be a non-negative whole number/,
    );
    expect(
      codeOf(() => numberOf(parseArgs(['--limit='], SPECS), 'limit', 42)),
    ).toBe('usage');
  });

  it('rejects a whitespace-only value', () => {
    expect(() =>
      numberOf(parseArgs(['--limit', '  '], SPECS), 'limit', 42),
    ).toThrow(/must be a non-negative whole number/);
  });
});

describe('merge', () => {
  it('combines tables', () => {
    const merged = merge(
      { a: { kind: 'boolean', describe: 'A.' } },
      { b: { kind: 'string', describe: 'B.' } },
    );
    expect(Object.keys(merged)).toEqual(['a', 'b']);
  });

  it('throws on a duplicate option name', () => {
    expect(() =>
      merge(
        { a: { kind: 'boolean', describe: 'A.' } },
        { a: { kind: 'string', describe: 'Also A.' } },
      ),
    ).toThrow('Option "--a" is defined twice.');
  });
});
