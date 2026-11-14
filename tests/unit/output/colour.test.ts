import { describe, expect, it } from 'vitest';
import { createPainter, shouldUseColour } from '../../../src/output/colour.js';

describe('shouldUseColour', () => {
  it('follows the TTY when nothing else has an opinion', () => {
    expect(shouldUseColour({ noColorFlag: false, env: {}, isTty: true })).toBe(
      true,
    );
    expect(shouldUseColour({ noColorFlag: false, env: {}, isTty: false })).toBe(
      false,
    );
  });

  it('puts --no-color above everything else', () => {
    expect(
      shouldUseColour({
        noColorFlag: true,
        env: { FORCE_COLOR: '1' },
        isTty: true,
      }),
    ).toBe(false);
  });

  it('puts NO_COLOR above FORCE_COLOR', () => {
    expect(
      shouldUseColour({
        noColorFlag: false,
        env: { NO_COLOR: '1', FORCE_COLOR: '1' },
        isTty: true,
      }),
    ).toBe(false);
  });

  it('ignores an empty NO_COLOR', () => {
    expect(
      shouldUseColour({
        noColorFlag: false,
        env: { NO_COLOR: '' },
        isTty: true,
      }),
    ).toBe(true);
  });

  it('puts TERM=dumb above FORCE_COLOR', () => {
    expect(
      shouldUseColour({
        noColorFlag: false,
        env: { TERM: 'dumb', FORCE_COLOR: '1' },
        isTty: true,
      }),
    ).toBe(false);
  });

  it('lets FORCE_COLOR override a pipe', () => {
    expect(
      shouldUseColour({
        noColorFlag: false,
        env: { FORCE_COLOR: '1' },
        isTty: false,
      }),
    ).toBe(true);
  });

  it('treats FORCE_COLOR=0 and an empty value as no opinion', () => {
    expect(
      shouldUseColour({
        noColorFlag: false,
        env: { FORCE_COLOR: '0' },
        isTty: false,
      }),
    ).toBe(false);
    expect(
      shouldUseColour({
        noColorFlag: false,
        env: { FORCE_COLOR: '' },
        isTty: true,
      }),
    ).toBe(true);
  });
});

describe('createPainter', () => {
  it('returns the text unchanged when disabled', () => {
    const painter = createPainter(false);
    expect(painter.enabled).toBe(false);
    expect(painter('hello', 'bold')).toBe('hello');
    expect(painter('hello', 'red')).toBe('hello');
  });

  it('wraps the text in escapes when enabled', () => {
    const painter = createPainter(true);
    expect(painter.enabled).toBe(true);
    expect(painter('hello', 'bold')).toBe('\u001b[1mhello\u001b[0m');
    expect(painter('hello', 'cyan')).toBe('\u001b[36mhello\u001b[0m');
  });
});
