// The built command as a child process.
//
// Everything else drives `run` in process; this file checks that the
// packaged entry point behaves the same way, including its exit codes.

import { describe, expect, it } from 'vitest';
import { binaryExists, runBinary, testUrl } from '../helpers/harness.js';

const present = binaryExists();

describe.skipIf(!present)(
  'the built binary (run npm run build if this is skipped)',
  () => {
    it('prints the release number', async () => {
      const result = await runBinary(['--version']);
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('prints the help', async () => {
      const result = await runBinary(['--help']);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Usage');
      expect(result.stdout).toContain('Commands');
    });

    it('lists the tables of the test database', async () => {
      const result = await runBinary(['tables', '--url', testUrl()]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('customers');
      expect(result.stdout).toContain('order_lines');
    });

    it('exits 2 on a usage error', async () => {
      const result = await runBinary(['no-such-command']);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('is not a command');
    });

    it('exits 1 when the connection fails', async () => {
      const url = new URL(testUrl());
      url.port = '1';
      const result = await runBinary([
        'tables',
        '--url',
        url.toString(),
        '--connect-timeout',
        '2000',
      ]);
      expect(result.code).toBe(1);
      expect(result.stderr).not.toBe('');
    });
  },
);

describe.skipIf(present)('the built binary', () => {
  it.skip('is not built; run npm run build to exercise it', () => {
    expect(true).toBe(true);
  });
});
