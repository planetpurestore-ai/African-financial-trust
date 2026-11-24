import { Router } from 'express';
import { many, one } from '../../db/pool.js';
import { asyncHandler, listBody, pagination } from '../../lib/http.js';
import { verifyAuditChain } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = ['org_id = ?'];
    const params = [req.auth.org.id];
    if (req.query.action) {
      clauses.push('action LIKE ?');
      params.push(`${req.query.action}%`);
    }
    if (req.query.entityType) {
      clauses.push('entity_type = ?');
      params.push(req.query.entityType);
    }
    if (req.query.entityId) {
      clauses.push('entity_id = ?');
      params.push(req.query.entityId);
    }
    if (req.query.from) {
      clauses.push('created_at >= ?');
      params.push(req.query.from);
    }
    if (req.query.to) {
      clauses.push('created_at <= ?');
      params.push(req.query.to);
    }
    const where = clauses.join(' AND ');
    const page = pagination(req);
    const [{ total }] = await many(`SELECT COUNT(*) AS total FROM audit_logs WHERE ${where}`, params);
    const rows = await many(
      `SELECT id, seq, actor_type, actor_id, actor_label, action, entity_type, entity_id, metadata_json, ip, prev_hash, hash, created_at
         FROM audit_logs WHERE ${where} ORDER BY seq DESC LIMIT ? OFFSET ?`,
      [...params, page.limit, page.offset],
    );
    res.json(listBody(rows.map((r) => ({ ...r, metadata: r.metadata_json })), Number(total), page));
  }),
);

router.get(
  '/verify',
  asyncHandler(async (req, res) => {
    res.json({ data: await verifyAuditChain(req.auth.org.id) });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await one('SELECT * FROM audit_logs WHERE id = ? AND org_id = ?', [req.params.id, req.auth.org.id]);
    if (!row) throw notFound('Audit entry not found');
    res.json({ data: row });
  }),
);

export default router;
