import { config } from '../../config.js';
import { execute, many, one } from '../../db/pool.js';
import { logger } from '../../lib/logger.js';
import { ulid } from '../../lib/ids.js';

const handlers = new Map();
const workerId = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

export function registerJobHandler(type, handler) {
  handlers.set(type, handler);
}

export async function enqueueJob({ orgId, type, entityType = null, entityId = null, payload = null, runAfter = null }) {
  if (!handlers.has(type) && !type.startsWith('document.')) {
    // Handlers are registered by the server bootstrap; a missing handler is a programming error.
    logger.warn('enqueueing job with no registered handler yet', { type });
  }
  const id = ulid();
  await execute(
    `INSERT INTO processing_jobs (id, org_id, job_type, entity_type, entity_id, payload_json, status, run_after)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', COALESCE(?, NOW(3)))`,
    [id, orgId, type, entityType, entityId, payload ? JSON.stringify(payload) : null, runAfter],
  );
  return id;
}

async function claimNext() {
  const candidate = await one(
    `SELECT * FROM processing_jobs WHERE status = 'queued' AND run_after <= NOW(3) ORDER BY run_after ASC LIMIT 1`,
  );
  if (!candidate) return null;
  const result = await execute(
    `UPDATE processing_jobs SET status = 'running', attempts = attempts + 1, started_at = NOW(3), locked_by = ?
      WHERE id = ? AND status = 'queued'`,
    [workerId, candidate.id],
  );
  if (result.affectedRows !== 1) return null;
  return { ...candidate, attempts: Number(candidate.attempts) + 1 };
}

export async function runJob(job) {
  const handler = handlers.get(job.job_type);
  if (!handler) throw new Error(`No handler registered for job type ${job.job_type}`);
  const payload = typeof job.payload_json === 'string' ? JSON.parse(job.payload_json || '{}') : job.payload_json || {};
  await handler({ job, payload });
}

export async function processOnce() {
  const job = await claimNext();
  if (!job) return null;
  try {
    await runJob(job);
    await execute("UPDATE processing_jobs SET status = 'completed', finished_at = NOW(3), last_error = NULL WHERE id = ?", [job.id]);
    return { id: job.id, status: 'completed' };
  } catch (error) {
    const attempts = Number(job.attempts);
    const maxAttempts = Number(job.max_attempts);
    const willRetry = attempts < maxAttempts;
    const backoffMinutes = Math.min(2 ** attempts, 60);
    await execute(
      `UPDATE processing_jobs SET status = ?, last_error = ?, finished_at = ?,
        run_after = DATE_ADD(NOW(3), INTERVAL ? MINUTE) WHERE id = ?`,
      [willRetry ? 'queued' : 'failed', String(error.message).slice(0, 4000), willRetry ? null : new Date(), backoffMinutes, job.id],
    );
    logger.error('job failed', { job_id: job.id, type: job.job_type, attempts, willRetry, error: error.message });
    return { id: job.id, status: willRetry ? 'queued' : 'failed', error: error.message };
  }
}

export async function processPending(limit = 20) {
  const results = [];
  for (let i = 0; i < limit; i += 1) {
    const result = await processOnce();
    if (!result) break;
    results.push(result);
  }
  return results;
}

let timer = null;
let running = false;

export function startWorker() {
  if (timer || !config.jobs.enabled) return null;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await processPending(config.jobs.concurrency);
    } catch (error) {
      logger.error('worker loop error', { error: error.message });
    } finally {
      running = false;
    }
  }, config.jobs.pollMs);
  timer.unref();
  logger.info('job worker started', { poll_ms: config.jobs.pollMs });
  return timer;
}

export function stopWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function listJobs({ orgId, status, limit = 50, offset = 0, allOrgs = false }) {
  const clauses = [];
  const params = [];
  if (!allOrgs) {
    clauses.push('org_id = ?');
    params.push(orgId);
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const [{ total }] = await many(`SELECT COUNT(*) AS total FROM processing_jobs ${where}`, params);
  const rows = await many(
    `SELECT id, org_id, job_type, entity_type, entity_id, status, attempts, max_attempts, last_error, run_after, started_at, finished_at, created_at
       FROM processing_jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { rows, total: Number(total) };
}

export async function retryJob(orgId, jobId) {
  const result = await execute(
    `UPDATE processing_jobs SET status = 'queued', attempts = 0, run_after = NOW(3), last_error = NULL, finished_at = NULL
      WHERE id = ? AND org_id = ? AND status IN ('failed','cancelled')`,
    [jobId, orgId],
  );
  return { id: jobId, requeued: result.affectedRows === 1 };
}

export async function jobStats(orgId = null) {
  const params = orgId ? [orgId] : [];
  const where = orgId ? 'WHERE org_id = ?' : '';
  const rows = await many(`SELECT status, COUNT(*) AS count FROM processing_jobs ${where} GROUP BY status`, params);
  const out = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const row of rows) out[row.status] = Number(row.count);
  return out;
}
