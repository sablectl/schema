import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../../src/version.js';

describe('VERSION', () => {
  it('agrees with package.json', () => {
    const path = fileURLToPath(new URL('../../package.json', import.meta.url));
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
      version: string;
    };
    expect(VERSION).toBe(manifest.version);
  });

  it('is a release number', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
