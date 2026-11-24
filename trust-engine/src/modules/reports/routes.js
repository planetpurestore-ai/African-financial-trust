import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { many, one } from '../../db/pool.js';
import { writeAuditStandalone } from '../../lib/audit.js';
import { asyncHandler } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { ulid } from '../../lib/ids.js';
import { parse } from '../../lib/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { getBusinessAccess } from '../businesses/access.js';
import { buildReport, REPORT_TYPES } from './builders.js';
import { renderCsv, renderPdf } from './render.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/types',
  asyncHandler(async (_req, res) => {
    res.json({ data: REPORT_TYPES });
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await many(
      'SELECT id, report_type, format, status, filename, size_bytes, business_id, created_at FROM reports WHERE org_id = ? ORDER BY created_at DESC LIMIT 100',
      [req.auth.org.id],
    );
    res.json({ data: rows });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        type: z.enum(REPORT_TYPES),
        format: z.enum(['pdf', 'csv']).default('pdf'),
        businessId: z.string().length(26).optional().nullable(),
      }),
      req.body,
    );
    if (input.type !== 'audit' && !input.businessId) throw notFound('businessId is required for this report');
    if (input.businessId) {
      const access = await getBusinessAccess(req.auth, input.businessId, ['reports.read', 'trust_record.read']);
      if (!access) throw notFound('Business not found');
    }

    const report = await buildReport(input.type, input.businessId, req.auth.org.id);
    const id = ulid();
    const dir = path.join(config.storageDir, 'reports', req.auth.org.id);
    await fs.mkdir(dir, { recursive: true });
    const filename = `${input.type}-${id.slice(-8)}.${input.format}`;
    const storageKey = path.posix.join('reports', req.auth.org.id, filename);
    const absolute = path.join(config.storageDir, storageKey);

    if (input.format === 'pdf') await renderPdf(report, absolute);
    else await fs.writeFile(absolute, renderCsv(report), 'utf8');
    const stat = await fs.stat(absolute);

    await one(
      `INSERT INTO reports (id, org_id, business_id, report_type, format, params_json, status, filename, storage_key, size_bytes, generated_by)
       VALUES (?, ?, ?, ?, ?, ?, 'generated', ?, ?, ?, ?)`,
      [
        id,
        req.auth.org.id,
        input.businessId ?? null,
        input.type,
        input.format,
        JSON.stringify({ meta: report.meta }),
        filename,
        storageKey,
        stat.size,
        req.auth.user?.id ?? null,
      ],
    );
    await writeAuditStandalone({
      orgId: req.auth.org.id,
      actorType: req.auth.type,
      actorId: req.auth.user?.id ?? req.auth.apiKeyId,
      action: 'report.generated',
      entityType: 'report',
      entityId: id,
      metadata: { type: input.type, format: input.format, business_id: input.businessId ?? null },
      ip: req.ip,
    });
    res.status(201).json({
      data: { id, type: input.type, format: input.format, filename, size_bytes: stat.size, download_url: `/api/v1/reports/${id}/download` },
    });
  }),
);

router.get(
  '/:id/download',
  asyncHandler(async (req, res) => {
    const report = await one('SELECT * FROM reports WHERE id = ? AND org_id = ?', [req.params.id, req.auth.org.id]);
    if (!report) throw notFound('Report not found');
    const absolute = path.join(config.storageDir, report.storage_key);
    res.setHeader('content-type', report.format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${report.filename}"`);
    res.sendFile(absolute);
  }),
);

export default router;
