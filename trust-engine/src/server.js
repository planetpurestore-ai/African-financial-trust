import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { config, assertRuntimeConfig } from './config.js';
import api from './api.js';
import { closePool, healthCheck } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { errorBody, notFound } from './lib/errors.js';
import { requestId } from './lib/http.js';
import { logger } from './lib/logger.js';
import { rateLimit } from './middleware/rateLimit.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(requestId);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'font-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      frameguard: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.get('/health', async (_req, res) => {
    try {
      const db = await healthCheck();
      res.status(db.ok ? 200 : 503).json({ status: db.ok ? 'ok' : 'degraded', database: db.ok, time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', database: false });
    }
  });

  app.get('/ready', async (_req, res) => {
    try {
      const db = await healthCheck();
      res.status(db.ok ? 200 : 503).json({ ready: db.ok });
    } catch {
      res.status(503).json({ ready: false });
    }
  });

  app.use('/api/v1', rateLimit(), api);

  app.use(
    express.static(config.publicDir, {
      index: 'index.html',
      setHeaders(res, filePath) {
        if (/\.(html|js|css)$/.test(filePath)) res.setHeader('cache-control', 'no-cache');
        else res.setHeader('cache-control', 'public, max-age=86400');
      },
    }),
  );

  app.get(/^\/(?!api\/).*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.includes('.')) return next();
    return res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  app.use((req, _res, next) => next(notFound(`No route for ${req.method} ${req.path}`)));

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, _next) => {
    let err = error;
    if (err?.type === 'entity.too.large') {
      err = { status: 413, code: 'payload_too_large', message: 'Request body is too large' };
    } else if (err?.code === 'ER_DUP_ENTRY') {
      err = { status: 409, code: 'duplicate', message: 'A record with those unique values already exists' };
    } else if (err?.code === 'LIMIT_FILE_SIZE') {
      err = { status: 413, code: 'file_too_large', message: 'Uploaded file exceeds the size limit' };
    }
    const status = err.status || 500;
    if (status >= 500) logger.error('request failed', { request_id: req.id, path: req.path, error: error?.message, stack: error?.stack });
    res.status(status).json(errorBody(err, req.id));
  });

  return app;
}

export async function start() {
  const problems = assertRuntimeConfig();
  if (problems.length) {
    for (const problem of problems) logger.error('configuration error', { problem });
    if (config.env === 'production') throw new Error(`Invalid configuration: ${problems.join('; ')}`);
  }
  fs.mkdirSync(config.storageDir, { recursive: true });
  fs.mkdirSync(path.join(config.storageDir, 'documents'), { recursive: true });
  fs.mkdirSync(path.join(config.storageDir, 'reports'), { recursive: true });

  if (process.env.AUTO_MIGRATE !== 'false') {
    await runMigrations({ log: logger });
  }

  registerJobHandlers();
  startWorker();

  const app = createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info('server listening', { port: config.port, env: config.env });
  });

  const shutdown = async (signal) => {
    logger.info('shutting down', { signal });
    stopWorker();
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  start().catch((error) => {
    logger.error('failed to start', { error: error.message, stack: error.stack });
    process.exit(1);
  });
}
import { registerJobHandlers } from './jobs.js';
import { startWorker, stopWorker } from './modules/jobs/service.js';
