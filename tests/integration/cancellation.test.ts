// Interrupting a running command.
//
// `run` takes an AbortSignal. When it fires, the open connection asks the
// server to cancel the backend over a second connection, opened with the SSL
// mode that the first connection actually negotiated. The cancellation is
// therefore delivered under the default `prefer` mode as well, including
// against a server built without TLS.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invoke, makeWorkspace, testUrl } from '../helpers/harness.js';

type Workspace = Awaited<ReturnType<typeof makeWorkspace>>;

describe('cancellation', () => {
  let workspace: Workspace;

  beforeAll(async () => {
    workspace = await makeWorkspace();
  });

  afterAll(async () => {
    await workspace.cleanup();
  });

  it('refuses to start when the signal is already aborted', async () => {
    const result = await invoke(['query', 'SELECT 1', '--url', testUrl()], {
      env: workspace.env,
      signal: AbortSignal.abort(),
    });
    expect(result.code).toBe(130);
    expect(result.stderr).toContain('Interrupted');
    expect(result.stdout).toBe('');
  });

  it('cancels a running statement under the default SSL mode', async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => {
      controller.abort();
    }, 500);
    const result = await invoke(
      [
        'query',
        'SELECT pg_sleep(10)',
        '--url',
        testUrl(),
        '--statement-timeout',
        '30000',
      ],
      { env: workspace.env, signal: controller.signal },
    );
    const elapsed = Date.now() - started;
    expect(result.code).toBe(130);
    expect(result.stderr).toContain('Interrupted');
    expect(result.stdout).toBe('');
    expect(elapsed).toBeLessThan(9000);
  }, 30_000);

  it('cancels a running statement with --ssl-mode disable', async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => {
      controller.abort();
    }, 500);
    const result = await invoke(
      [
        'query',
        'SELECT pg_sleep(10)',
        '--url',
        testUrl(),
        '--ssl-mode',
        'disable',
        '--statement-timeout',
        '30000',
      ],
      { env: workspace.env, signal: controller.signal },
    );
    const elapsed = Date.now() - started;
    expect(result.code).toBe(130);
    expect(result.stderr).toContain('Interrupted');
    expect(result.stdout).toBe('');
    expect(elapsed).toBeLessThan(9000);
  }, 30_000);
});
