import { describe, expect, it } from 'vitest';
import {
  describeTarget,
  parseConnectionUrl,
  redactedUrl,
  resolveTarget,
  type ConnectionOverrides,
  type ConnectionTarget,
} from '../../../src/core/connection.js';
import { isAppError } from '../../../src/core/errors.js';
import { REDACTED } from '../../../src/core/redact.js';

const TIMEOUTS = { connectTimeoutMs: 1000, statementTimeoutMs: 2000 };

function overrides(
  extra: Partial<ConnectionOverrides> = {},
): ConnectionOverrides {
  return { ...TIMEOUTS, ...extra };
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return isAppError(error) ? error.code : 'not-an-app-error';
  }
  return 'no-error';
}

describe('parseConnectionUrl', () => {
  it('reads every part of a full connection string', () => {
    expect(
      parseConnectionUrl('postgresql://alice:hunter2@db.example:6543/shop'),
    ).toEqual({
      host: 'db.example',
      port: 6543,
      database: 'shop',
      user: 'alice',
      password: 'hunter2',
    });
  });

  it('accepts the postgres scheme as well', () => {
    expect(parseConnectionUrl('postgres://db/shop')).toEqual({
      host: 'db',
      database: 'shop',
    });
  });

  it('decodes percent-encoded parts', () => {
    expect(
      parseConnectionUrl('postgresql://a%40b:p%40ss@db/my%20database'),
    ).toEqual({
      host: 'db',
      database: 'my database',
      user: 'a@b',
      password: 'p@ss',
    });
  });

  it('strips the brackets from an IPv6 host', () => {
    expect(parseConnectionUrl('postgresql://[::1]:5433/shop')).toEqual({
      host: '::1',
      port: 5433,
      database: 'shop',
    });
  });

  it('reads the sslmode and application_name parameters', () => {
    expect(
      parseConnectionUrl(
        'postgresql://db/shop?sslmode=require&application_name=probe',
      ),
    ).toEqual({
      host: 'db',
      database: 'shop',
      sslMode: 'require',
      applicationName: 'probe',
    });
  });

  it('lets dbname, host, port and user override the URL body', () => {
    expect(
      parseConnectionUrl(
        'postgresql://db/shop?dbname=other&host=elsewhere&port=15432&user=bob',
      ),
    ).toEqual({
      host: 'elsewhere',
      port: 15_432,
      database: 'other',
      user: 'bob',
    });
  });

  it('refuses an unknown parameter rather than ignoring it', () => {
    expect(() =>
      parseConnectionUrl('postgresql://db/shop?sslcert=/tmp/x'),
    ).toThrow(/not a connection parameter/);
    expect(
      codeOf(() => parseConnectionUrl('postgresql://db/shop?sslcert=/tmp/x')),
    ).toBe('invalid-connection');
  });

  it('refuses an unsupported sslmode', () => {
    expect(() =>
      parseConnectionUrl('postgresql://db/shop?sslmode=allow'),
    ).toThrow(/not a supported sslmode/);
  });

  it('refuses a scheme that is not PostgreSQL', () => {
    expect(() => parseConnectionUrl('mysql://db/shop')).toThrow(
      /not a PostgreSQL connection scheme/,
    );
  });

  it('refuses a bad port', () => {
    // The URL parser itself rejects anything above 65535, so port zero is
    // the case that reaches Schema's own check.
    expect(() => parseConnectionUrl('postgresql://db:0/shop')).toThrow(
      /not a valid port number/,
    );
    expect(() => parseConnectionUrl('postgresql://db/shop?port=99999')).toThrow(
      /not a valid port number/,
    );
  });

  it('refuses a malformed string', () => {
    expect(() => parseConnectionUrl('this is not a url')).toThrow(
      /could not be parsed/,
    );
  });
});

describe('resolveTarget', () => {
  it('fills in the defaults', () => {
    const target = resolveTarget(overrides(), { PGUSER: 'alice' });
    expect(target.host).toBe('localhost');
    expect(target.port).toBe(5432);
    expect(target.database).toBe('alice');
    expect(target.user).toBe('alice');
    expect(target.password).toBeUndefined();
    expect(target.sslMode).toBe('prefer');
    expect(target.applicationName).toBe('schema');
    expect(target.connectTimeoutMs).toBe(1000);
    expect(target.statementTimeoutMs).toBe(2000);
  });

  it('keeps the timeouts it is given', () => {
    const target = resolveTarget(
      { connectTimeoutMs: 3000, statementTimeoutMs: 4000 },
      { PGUSER: 'alice' },
    );
    expect(target.connectTimeoutMs).toBe(3000);
    expect(target.statementTimeoutMs).toBe(4000);
  });

  it('falls back to the built-in timeouts when none are given', () => {
    const target = resolveTarget({}, { PGUSER: 'alice' });
    expect(target.connectTimeoutMs).toBe(10_000);
    expect(target.statementTimeoutMs).toBe(15_000);
  });

  it('prefers explicit options over the URL and the environment', () => {
    const target = resolveTarget(
      overrides({
        url: 'postgresql://urluser@urlhost:5433/urldb',
        host: 'opthost',
        port: 5434,
        database: 'optdb',
        user: 'optuser',
      }),
      {
        PGHOST: 'envhost',
        PGPORT: '5435',
        PGDATABASE: 'envdb',
        PGUSER: 'envuser',
      },
    );
    expect(describeTarget(target)).toBe('optuser@opthost:5434/optdb');
  });

  it('prefers the URL over the environment', () => {
    const target = resolveTarget(
      overrides({ url: 'postgresql://urluser@urlhost:5433/urldb' }),
      {
        PGHOST: 'envhost',
        PGPORT: '5435',
        PGDATABASE: 'envdb',
        PGUSER: 'envuser',
      },
    );
    expect(describeTarget(target)).toBe('urluser@urlhost:5433/urldb');
  });

  it('falls back to the PG variables', () => {
    const target = resolveTarget(overrides(), {
      PGHOST: 'envhost',
      PGPORT: '5435',
      PGDATABASE: 'envdb',
      PGUSER: 'envuser',
      PGPASSWORD: 'envpw',
    });
    expect(describeTarget(target)).toBe('envuser@envhost:5435/envdb');
    expect(target.password).toBe('envpw');
  });

  it('reads the URL from SCHEMA_URL and then DATABASE_URL', () => {
    expect(
      resolveTarget(overrides(), {
        SCHEMA_URL: 'postgresql://a@one/db',
        DATABASE_URL: 'postgresql://b@two/db',
      }).host,
    ).toBe('one');
    expect(
      resolveTarget(overrides(), { DATABASE_URL: 'postgresql://b@two/db' })
        .host,
    ).toBe('two');
  });

  it('falls back to USER when PGUSER is unset', () => {
    expect(resolveTarget(overrides(), { USER: 'shelluser' }).user).toBe(
      'shelluser',
    );
  });

  it('refuses to guess when no user can be determined', () => {
    expect(() => resolveTarget(overrides(), {})).toThrow(
      /No database user was given/,
    );
    expect(codeOf(() => resolveTarget(overrides(), {}))).toBe('usage');
  });

  it('reads the password from the variable named by --password-env', () => {
    const target = resolveTarget(overrides({ passwordEnv: 'MY_SECRET' }), {
      PGUSER: 'alice',
      MY_SECRET: 'from-env',
      PGPASSWORD: 'ignored',
    });
    expect(target.password).toBe('from-env');
  });

  it('fails when the named variable is not set', () => {
    expect(() =>
      resolveTarget(overrides({ passwordEnv: 'MISSING' }), {
        PGUSER: 'alice',
      }),
    ).toThrow(/MISSING is not set/);
    expect(
      codeOf(() =>
        resolveTarget(overrides({ passwordEnv: 'MISSING' }), {
          PGUSER: 'alice',
        }),
      ),
    ).toBe('usage');
  });

  it('prefers a password in the URL over PGPASSWORD', () => {
    expect(
      resolveTarget(overrides({ url: 'postgresql://a:urlpw@db/x' }), {
        PGPASSWORD: 'envpw',
      }).password,
    ).toBe('urlpw');
  });

  it('honours a supported PGSSLMODE', () => {
    expect(
      resolveTarget(overrides(), { PGUSER: 'alice', PGSSLMODE: 'verify-full' })
        .sslMode,
    ).toBe('verify-full');
  });

  it('refuses an unsupported PGSSLMODE', () => {
    expect(() =>
      resolveTarget(overrides(), { PGUSER: 'alice', PGSSLMODE: 'allow' }),
    ).toThrow(/PGSSLMODE is set to "allow"/);
    expect(
      codeOf(() =>
        resolveTarget(overrides(), { PGUSER: 'alice', PGSSLMODE: 'allow' }),
      ),
    ).toBe('invalid-connection');
  });

  it('ignores an unsupported PGSSLMODE when one was asked for', () => {
    expect(
      resolveTarget(overrides({ sslMode: 'require' }), {
        PGUSER: 'alice',
        PGSSLMODE: 'allow',
      }).sslMode,
    ).toBe('require');
  });

  it('refuses a bad PGPORT', () => {
    expect(() =>
      resolveTarget(overrides(), { PGUSER: 'alice', PGPORT: 'nope' }),
    ).toThrow(/PGPORT is not a valid port number/);
  });

  it('takes the application name from the URL', () => {
    expect(
      resolveTarget(
        overrides({ url: 'postgresql://a@db/x?application_name=probe' }),
        {},
      ).applicationName,
    ).toBe('probe');
  });

  it('takes the root certificate from the option or PGSSLROOTCERT', () => {
    expect(
      resolveTarget(overrides({ sslRootCert: '/opt/ca.pem' }), {
        PGUSER: 'a',
        PGSSLROOTCERT: '/env/ca.pem',
      }).sslRootCert,
    ).toBe('/opt/ca.pem');
    expect(
      resolveTarget(overrides(), { PGUSER: 'a', PGSSLROOTCERT: '/env/ca.pem' })
        .sslRootCert,
    ).toBe('/env/ca.pem');
  });
});

describe('describeTarget', () => {
  const base: ConnectionTarget = {
    host: 'db',
    port: 5432,
    database: 'shop',
    user: 'alice',
    password: 'hunter2',
    sslMode: 'prefer',
    sslRootCert: undefined,
    applicationName: 'schema',
    ...TIMEOUTS,
  };

  it('writes host and port for a network connection', () => {
    expect(describeTarget(base)).toBe('alice@db:5432/shop');
  });

  it('writes the socket directory without a port', () => {
    expect(describeTarget({ ...base, host: '/var/run/postgresql' })).toBe(
      'alice@/var/run/postgresql/shop',
    );
  });

  it('never contains the password', () => {
    expect(describeTarget(base)).not.toContain('hunter2');
  });
});

describe('redactedUrl', () => {
  const base: ConnectionTarget = {
    host: 'db',
    port: 5432,
    database: 'shop',
    user: 'alice',
    password: 'hunter2',
    sslMode: 'prefer',
    sslRootCert: undefined,
    applicationName: 'schema',
    ...TIMEOUTS,
  };

  it('replaces the password with the placeholder', () => {
    expect(redactedUrl(base)).toBe(
      `postgresql://alice:${REDACTED}@db:5432/shop`,
    );
    expect(redactedUrl(base)).not.toContain('hunter2');
  });

  it('omits the credential when there is no password', () => {
    expect(redactedUrl({ ...base, password: undefined })).toBe(
      'postgresql://alice@db:5432/shop',
    );
  });

  it('brackets an IPv6 host', () => {
    expect(redactedUrl({ ...base, host: '::1', password: undefined })).toBe(
      'postgresql://alice@[::1]:5432/shop',
    );
  });

  it('percent-encodes the user and database', () => {
    expect(
      redactedUrl({
        ...base,
        user: 'a@b',
        database: 'my database',
        password: undefined,
      }),
    ).toBe('postgresql://a%40b@db:5432/my%20database');
  });
});
