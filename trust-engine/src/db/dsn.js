/**
 * Parse a MySQL-compatible DSN, including TiDB-style `?ssl={"rejectUnauthorized":true}`.
 * Returns connection fields plus a normalised `ssl` option (or undefined).
 */
export function parseDatabaseUrl(dsn) {
  if (!dsn) throw new Error('DATABASE_URL is not configured');
  const url = new URL(dsn);
  const params = url.searchParams;
  const ssl = parseSsl(params);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    ssl,
  };
}

function parseSsl(params) {
  const raw = params.get('ssl');
  if (raw) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (process.env.DB_SSL_CA) parsed.ca = process.env.DB_SSL_CA;
        return parsed;
      } catch {
        return { rejectUnauthorized: true };
      }
    }
    if (trimmed === 'true') {
      return { rejectUnauthorized: false, ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA } : {}) };
    }
  }
  const mode = params.get('ssl-mode') || params.get('sslmode');
  if (mode) {
    return {
      rejectUnauthorized: mode === 'VERIFY_IDENTITY' || mode === 'VERIFY_CA',
      ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA } : {}),
    };
  }
  return undefined;
}
