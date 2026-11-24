import fs from 'node:fs/promises';
import { Router } from 'express';
import { config } from '../../config.js';
import { healthCheck, many, one } from '../../db/pool.js';
import { asyncHandler, listBody, pagination } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { jobStats, listJobs, retryJob } from '../jobs/service.js';
import { businessScopeSql } from '../businesses/access.js';

const router = Router();
router.use(requireAuth);

async function storageBytes() {
  try {
    const entries = await fs.readdir(config.storageDir, { recursive: true, withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      if (entry.isFile()) {
        try {
          const stat = await fs.stat(`${entry.path}/${entry.name}`);
          total += stat.size;
        } catch {
          /* file removed during scan */
        }
      }
    }
    return total;
  } catch {
    return 0;
  }
}

router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const scope = businessScopeSql(req.auth);
    const [businesses, documents, invoices, transactions, pendingJobs, trustRecords, unmatched] = await Promise.all([
      one(`SELECT COUNT(*) AS total FROM businesses b WHERE ${scope.sql}`, scope.params),
      one(
        `SELECT COUNT(*) AS total FROM documents d JOIN businesses b ON b.id = d.business_id WHERE ${scope.sql}`,
        scope.params,
      ),
      one(
        `SELECT COUNT(*) AS total, COALESCE(SUM(i.total_amount),0) AS value FROM invoices i JOIN businesses b ON b.id = i.business_id WHERE ${scope.sql}`,
        scope.params,
      ),
      one(
        `SELECT COUNT(*) AS total FROM transactions t JOIN businesses b ON b.id = t.business_id WHERE ${scope.sql}`,
        scope.params,
      ),
      one("SELECT COUNT(*) AS total FROM processing_jobs WHERE org_id = ? AND status IN ('queued','running')", [req.auth.org.id]),
      one(
        `SELECT COUNT(*) AS total FROM trust_records tr JOIN businesses b ON b.id = tr.business_id WHERE ${scope.sql}`,
        scope.params,
      ),
      one(
        `SELECT COUNT(*) AS total FROM reconciliation_matches m JOIN reconciliations r ON r.id = m.reconciliation_id
           JOIN businesses b ON b.id = r.business_id WHERE ${scope.sql} AND m.status = 'suggested'`,
        scope.params,
      ),
    ]);

    const verificationBreakdown = await many(
      `SELECT b.verification_status AS status, COUNT(*) AS count FROM businesses b WHERE ${scope.sql} GROUP BY b.verification_status`,
      scope.params,
    );
    const invoiceBreakdown = await many(
      `SELECT i.verification_status AS status, COUNT(*) AS count, COALESCE(SUM(i.total_amount),0) AS value
         FROM invoices i JOIN businesses b ON b.id = i.business_id WHERE ${scope.sql} GROUP BY i.verification_status`,
      scope.params,
    );
    const countryBreakdown = await many(
      `SELECT b.country_code AS country, COUNT(*) AS count FROM businesses b WHERE ${scope.sql} GROUP BY b.country_code ORDER BY count DESC`,
      scope.params,
    );
    const recentActivity = await many(
      `SELECT action, entity_type, entity_id, actor_type, actor_label, created_at FROM audit_logs
        WHERE org_id = ? ORDER BY seq DESC LIMIT 12`,
      [req.auth.org.id],
    );
    const recentInvoices = await many(
      `SELECT i.id, i.invoice_number, i.total_amount, i.currency_code, i.verification_status, i.issue_date, b.legal_name
         FROM invoices i JOIN businesses b ON b.id = i.business_id WHERE ${scope.sql}
        ORDER BY i.created_at DESC LIMIT 8`,
      scope.params,
    );

    res.json({
      data: {
        counts: {
          businesses: Number(businesses.total),
          documents: Number(documents.total),
          invoices: Number(invoices.total),
          invoice_value: Number(invoices.value),
          transactions: Number(transactions.total),
          trust_records: Number(trustRecords.total),
          pending_jobs: Number(pendingJobs.total),
          pending_matches: Number(unmatched.total),
        },
        verification_breakdown: verificationBreakdown.map((r) => ({ ...r, count: Number(r.count) })),
        invoice_breakdown: invoiceBreakdown.map((r) => ({ ...r, count: Number(r.count), value: Number(r.value) })),
        country_breakdown: countryBreakdown.map((r) => ({ ...r, count: Number(r.count) })),
        recent_activity: recentActivity,
        recent_invoices: recentInvoices,
      },
    });
  }),
);

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const started = Date.now();
    let db = { ok: false };
    let dbError = null;
    try {
      db = await healthCheck();
    } catch (error) {
      dbError = error.message;
    }
    const stats = await jobStats();
    const failed = await one("SELECT COUNT(*) AS c FROM processing_jobs WHERE status = 'failed'");
    res.json({
      data: {
        status: db.ok ? 'operational' : 'degraded',
        version: config.version,
        environment: config.env,
        uptime_seconds: Math.round(process.uptime()),
        database: { connected: db.ok, latency_ms: Date.now() - started, error: dbError },
        storage: { bytes: await storageBytes(), path: config.storageDir },
        jobs: { ...stats, failed_total: Number(failed.c) },
        integrations_live: Number((await one("SELECT COUNT(*) AS c FROM integrations WHERE status = 'connected'")).c),
        memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
    });
  }),
);

router.get(
  '/jobs',
  requireRole('system_admin', 'institution_admin', 'business_admin'),
  asyncHandler(async (req, res) => {
    const page = pagination(req, { defaultLimit: 25 });
    const allOrgs = req.auth.role === 'system_admin';
    const { rows, total } = await listJobs({
      orgId: req.auth.org.id,
      status: req.query.status,
      allOrgs,
      ...page,
    });
    res.json(listBody(rows, total, page));
  }),
);

router.post(
  '/jobs/:id/retry',
  requireRole('system_admin', 'institution_admin', 'business_admin'),
  asyncHandler(async (req, res) => {
    const result = await retryJob(req.auth.org.id, req.params.id);
    if (!result.requeued) throw notFound('Job not found or not in a failed state');
    res.json({ data: result });
  }),
);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const scope = businessScopeSql(req.auth);
    const rows = await many(
      `SELECT b.id, b.legal_name, b.verification_status,
              (SELECT COUNT(*) FROM invoices i WHERE i.business_id = b.id) AS invoices,
              (SELECT COUNT(*) FROM documents d WHERE d.business_id = b.id) AS documents
         FROM businesses b WHERE ${scope.sql} ORDER BY b.created_at DESC LIMIT 50`,
      scope.params,
    );
    res.json({ data: rows });
  }),
);

export default router;
