import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { config } from '../config.js';
import { sha256Hex } from '../lib/crypto.js';
import { parseDatabaseUrl } from './dsn.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../../db/migrations');

const IGNORABLE = new Set([1061, 1826, 1022]); // duplicate key name / duplicate fk / duplicate key

export async function runMigrations({ log = console } = {}) {
  const dsn = parseDatabaseUrl(config.databaseUrl);
  const conn = await mysql.createConnection({
    host: dsn.host,
    port: dsn.port,
    user: dsn.user,
    password: dsn.password,
    database: dsn.database,
    multipleStatements: true,
    timezone: 'Z',
    charset: 'utf8mb4',
    ...(dsn.ssl ? { ssl: dsn.ssl } : {}),
  });

  const applied = [];
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    const [rows] = await conn.query('SELECT filename, checksum FROM schema_migrations');
    const done = new Map(rows.map((r) => [r.filename, r.checksum]));

    const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      const checksum = sha256Hex(sql);
      if (done.has(file)) {
        if (done.get(file) !== checksum) {
          log.warn?.(`[migrate] ${file} changed after it was applied; schema is not re-run automatically`);
        }
        continue;
      }
      log.info?.(`[migrate] applying ${file}`);
      try {
        await conn.query(sql);
      } catch (error) {
        // A partially applied migration can hit an object that already exists.
        if (!IGNORABLE.has(error.errno)) throw error;
        log.warn?.(`[migrate] ${file}: ignored duplicate object (${error.code})`);
      }
      await conn.query('INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)', [file, checksum]);
      applied.push(file);
    }
    log.info?.(applied.length ? `[migrate] applied ${applied.length} migration(s)` : '[migrate] schema up to date');
    return applied;
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[migrate] failed:', error.message);
      process.exit(1);
    });
}
