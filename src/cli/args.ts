// Argument parsing.
//
// Hand-written rather than taken from a dependency: the surface is small, the
// rules are strict, and an unknown flag must be an error rather than a
// silently ignored token.

import { usageError } from '../core/errors.js';

export type OptionKind = 'boolean' | 'string' | 'list';

export interface OptionSpec {
  readonly kind: OptionKind;
  readonly short?: string;
  readonly describe: string;
  readonly valueName?: string;
}

export interface ParsedArgs {
  readonly positional: readonly string[];
  readonly booleans: ReadonlyMap<string, boolean>;
  readonly strings: ReadonlyMap<string, string>;
  readonly lists: ReadonlyMap<string, readonly string[]>;
}

export function parseArgs(
  argv: readonly string[],
  specs: Readonly<Record<string, OptionSpec>>,
): ParsedArgs {
  const byShort = new Map<string, string>();
  for (const [name, spec] of Object.entries(specs)) {
    if (spec.short !== undefined) byShort.set(spec.short, name);
  }

  const positional: string[] = [];
  const booleans = new Map<string, boolean>();
  const strings = new Map<string, string>();
  const lists = new Map<string, string[]>();

  const take = (name: string, inline: string | null, rest: string[]): void => {
    const spec = specs[name];
    if (spec === undefined) {
      throw usageError(
        `Unknown option "--${name}".`,
        'Run schema --help for the list of options.',
      );
    }
    if (spec.kind === 'boolean') {
      if (inline !== null) {
        throw usageError(`Option "--${name}" does not take a value.`);
      }
      booleans.set(name, true);
      return;
    }
    const value = inline ?? rest.shift();
    if (value === undefined) {
      throw usageError(`Option "--${name}" needs a value.`);
    }
    if (spec.kind === 'list') {
      const existing = lists.get(name) ?? [];
      existing.push(value);
      lists.set(name, existing);
    } else {
      strings.set(name, value);
    }
  };

  const rest = [...argv];
  let onlyPositional = false;
  while (rest.length > 0) {
    const token = rest.shift();
    if (token === undefined) break;
    if (onlyPositional) {
      positional.push(token);
      continue;
    }
    if (token === '--') {
      onlyPositional = true;
      continue;
    }
    if (token.startsWith('--')) {
      // `--` on its own was handled above, so the body is never empty here.
      const body = token.slice(2);
      const equals = body.indexOf('=');
      if (equals === -1) take(body, null, rest);
      else take(body.slice(0, equals), body.slice(equals + 1), rest);
      continue;
    }
    if (token.startsWith('-') && token.length > 1) {
      // Short flags do not bundle: -abc would be ambiguous once any of them
      // takes a value, and ambiguity in a database tool is not worth the
      // keystrokes it saves.
      const short = token.slice(1);
      const name = byShort.get(short);
      if (name === undefined) {
        throw usageError(
          `Unknown option "-${short}".`,
          'Run schema --help for the list of options.',
        );
      }
      take(name, null, rest);
      continue;
    }
    positional.push(token);
  }

  return { positional, booleans, strings, lists };
}

export function boolOf(args: ParsedArgs, name: string): boolean {
  return args.booleans.get(name) ?? false;
}

export function stringOf(args: ParsedArgs, name: string): string | undefined {
  return args.strings.get(name);
}

export function listOf(args: ParsedArgs, name: string): readonly string[] {
  return args.lists.get(name) ?? [];
}

export function numberOf(
  args: ParsedArgs,
  name: string,
  fallback: number,
): number {
  const raw = args.strings.get(name);
  if (raw === undefined) return fallback;
  // `Number('')` is 0, so an empty value would silently mean "none" rather
  // than the default or an error.
  const value = raw.trim() === '' ? Number.NaN : Number(raw);
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw usageError(
      `Option "--${name}" must be a non-negative whole number, not "${raw}".`,
    );
  }
  return value;
}

/** Merge option tables, refusing a name defined twice. */
export function merge(
  ...tables: readonly Readonly<Record<string, OptionSpec>>[]
): Record<string, OptionSpec> {
  const merged: Record<string, OptionSpec> = {};
  for (const table of tables) {
    for (const [name, spec] of Object.entries(table)) {
      if (name in merged) {
        throw new Error(`Option "--${name}" is defined twice.`);
      }
      merged[name] = spec;
    }
  }
  return merged;
}
