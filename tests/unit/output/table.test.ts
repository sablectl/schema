import { describe, expect, it } from 'vitest';
import { renderFields, renderTable } from '../../../src/output/table.js';
import { plain } from '../helpers/fixtures.js';

const options = { maxCellChars: 120, painter: plain };

describe('renderTable', () => {
  it('aligns left by default and pads to the widest cell', () => {
    const text = renderTable(
      [{ header: 'Name' }, { header: 'Kind' }],
      [
        ['customers', 'table'],
        ['v', 'view'],
      ],
      options,
    );
    expect(text.split('\n')).toEqual([
      'Name       Kind',
      '---------  -----',
      'customers  table',
      'v          view',
    ]);
  });

  it('aligns right when asked', () => {
    const text = renderTable(
      [{ header: 'Rows', align: 'right' }],
      [['1'], ['1000']],
      options,
    );
    expect(text.split('\n')).toEqual(['Rows', '----', '   1', '1000']);
  });

  it('draws the rule as wide as each column', () => {
    const text = renderTable(
      [{ header: 'A' }, { header: 'Bee' }],
      [['xxxxx', 'y']],
      options,
    );
    expect(text.split('\n')[1]).toBe('-----  ---');
  });

  it('truncates a cell at maxCellChars', () => {
    const text = renderTable([{ header: 'A' }], [['abcdef']], {
      ...options,
      maxCellChars: 3,
    });
    expect(text.split('\n')[2]).toBe('ab…');
  });

  it('escapes control characters so a row stays on one line', () => {
    const text = renderTable(
      [{ header: 'A' }],
      [['one\ntwo\u001b[31m']],
      options,
    );
    expect(text.split('\n')).toHaveLength(3);
    expect(text).toContain('one\\ntwo\\x1b[31m');
  });

  it('escapes a hostile header and aligns on the escaped width', () => {
    const text = renderTable(
      [{ header: 'id\u001b[2K\r' }, { header: '\u202Ename' }],
      [['1', 'x']],
      options,
    );
    const lines = text.split('\n');

    expect(text).not.toContain('\u001b');
    expect(text).not.toContain('\r');
    expect(text).not.toContain('\u202E');
    expect(lines[0]).toBe('id\\x1b[2K\\r  \\u202ename');
    expect(lines[1]).toBe('-----------  ----------');
    expect(lines[2]).toBe('1            x');
  });

  it('renders a header and a rule for an empty row set', () => {
    expect(renderTable([{ header: 'Name' }], [], options)).toBe('Name\n----');
  });

  it('treats a missing cell as empty', () => {
    const text = renderTable(
      [{ header: 'A' }, { header: 'B' }],
      [['only']],
      options,
    );
    expect(text.split('\n')[2]).toBe('only');
  });

  it('applies the indent to every line', () => {
    const text = renderTable([{ header: 'A' }], [['x']], {
      ...options,
      indent: '  ',
    });
    for (const line of text.split('\n'))
      expect(line.startsWith('  ')).toBe(true);
  });
});

describe('renderFields', () => {
  it('pads the keys to one width', () => {
    expect(
      renderFields(
        [
          ['Server', 'PostgreSQL 16'],
          ['Role', 'alice'],
        ],
        plain,
      ),
    ).toBe('  Server  PostgreSQL 16\n  Role    alice');
  });

  it('honours a custom indent', () => {
    expect(renderFields([['A', 'b']], plain, '')).toBe('A  b');
  });

  it('escapes control characters in the value', () => {
    expect(renderFields([['A', 'one\ntwo']], plain, '')).toBe('A  one\\ntwo');
  });

  it('escapes control characters in the key and pads on the result', () => {
    expect(
      renderFields(
        [
          ['A\u001b[2K', 'b'],
          ['Bee', 'c'],
        ],
        plain,
        '',
      ),
    ).toBe('A\\x1b[2K  b\nBee       c');
  });

  it('renders nothing for an empty list', () => {
    expect(renderFields([], plain)).toBe('');
  });
});
