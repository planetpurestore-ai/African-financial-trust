import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3000),
  root,
  publicDir: path.join(root, 'public'),
  storageDir: process.env.STORAGE_DIR || path.join(root, 'storage'),
  databaseUrl: process.env.DATABASE_URL || '',
  appName: 'African Financial Trust',
  productName: 'Trust Engine',
  publicOrigin: (process.env.PUBLIC_ORIGIN || '').replace(/\/$/, ''),
  sessionCookie: process.env.SESSION_COOKIE_NAME || 'aft_session',
  csrfCookie: 'aft_csrf',
  sessionHours: int(process.env.SESSION_HOURS, 12),
  cookieSecure: bool(process.env.COOKIE_SECURE, process.env.NODE_ENV === 'production'),
  maxUploadBytes: int(process.env.MAX_UPLOAD_MB, 25) * 1024 * 1024,
  allowedUploadTypes: [
    'application/pdf',
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/json',
    'image/jpeg',
    'image/png',
    'image/tiff',
    'text/plain',
  ],
  rateLimit: {
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    max: int(process.env.RATE_LIMIT_MAX, 300),
    loginMax: int(process.env.LOGIN_RATE_LIMIT_MAX, 12),
  },
  jobs: {
    pollMs: int(process.env.JOB_POLL_MS, 1500),
    enabled: bool(process.env.JOB_WORKER_ENABLED, true),
    concurrency: int(process.env.JOB_CONCURRENCY, 2),
  },
  retentionDays: int(process.env.DATA_RETENTION_DAYS, 2555),
  version: '1.0.0',
};

export function assertRuntimeConfig() {
  const problems = [];
  if (!config.databaseUrl) problems.push('DATABASE_URL is not set');
  if (config.env === 'production' && !config.cookieSecure) problems.push('COOKIE_SECURE must not be disabled in production');
  if (config.env === 'production' && !process.env.APP_ENCRYPTION_KEY && !process.env.MANUS_JWT_SECRET) {
    problems.push('APP_ENCRYPTION_KEY (or MANUS_JWT_SECRET as key material) is required in production');
  }
  return problems;
}
