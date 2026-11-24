import mysql from 'mysql2/promise';
import { config } from '../config.js';
import { parseDatabaseUrl } from './dsn.js';
import { normalizeParams } from '../lib/dates.js';

let pool = null;

function connectionOptions() {
  const dsn = parseDatabaseUrl(config.databaseUrl);
  const options = {
    host: dsn.host,
    port: dsn.port,
    user: dsn.user,
    password: dsn.password,
    database: dsn.database,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
    maxIdle: Number(process.env.DB_POOL_SIZE || 10),
    idleTimeout: 60_000,
    queueLimit: 0,
    timezone: 'Z',
    dateStrings: ['DATE'],
    decimalNumbers: true,
    charset: 'utf8mb4',
    enableKeepAlive: true,
  };
  if (dsn.ssl) options.ssl = dsn.ssl;
  return options;
}

export function getPool() {
  if (!pool) pool = mysql.createPool(connectionOptions());
  return pool;
}

export async function q(sql, params = []) {
  const [rows] = await getPool().query(sql, normalizeParams(params));
  return rows;
}

export async function one(sql, params = []) {
  const rows = await q(sql, params);
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

export async function many(sql, params = []) {
  const rows = await q(sql, params);
  return Array.isArray(rows) ? rows : [];
}

/** Run a query on an existing transaction connection (sees uncommitted writes). */
export async function queryOn(conn, sql, params = []) {
  const [rows] = await conn.query(sql, normalizeParams(params));
  return rows;
}

/** Single row on a transaction connection. */
export async function oneOn(conn, sql, params = []) {
  const rows = await queryOn(conn, sql, params);
  return Array.isArray(rows) ? rows[0] ?? null : null;
}
/** All rows on a transaction connection. */
export async function manyOn(conn, sql, params = []) {
  const rows = await queryOn(conn, sql, params);
  return Array.isArray(rows) ? rows : [];
}
export async function execute(sql, params = []) {
  const [result] = await getPool().execute(sql, normalizeParams(params));
  return result;
}

/**
 * Transaction connections are proxied so that `conn.query`/`conn.execute`
 * normalize date parameters exactly like the pool helpers do. Services call
 * `conn.query` directly in places; without this, an ISO timestamp from a JSON
 * request would be rejected by MySQL/TiDB.
 */
function wrapConnection(conn) {
  return new Proxy(conn, {
    get(target, prop) {
      if (prop === 'query' || prop === 'execute') {
        return (sql, params) => target[prop](sql, normalizeParams(params));
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
export async function withTransaction(fn) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(wrapConnection(conn));
    await conn.commit();
    return result;
  } catch (error) {
    try {
      await conn.rollback();
    } catch {
      /* connection already gone */
    }
    throw error;
  } finally {
    conn.release();
  }
}

export async function healthCheck() {
  const row = await one('SELECT 1 AS ok, NOW(3) AS now');
  return { ok: row?.ok === 1, now: row?.now };
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
