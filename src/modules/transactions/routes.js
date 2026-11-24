import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../../config.js';
import { asyncHandler, listBody, pagination } from '../../lib/http.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { requireAuth, requireWriteRole } from '../../middleware/auth.js';
import { getBusinessAccess } from '../businesses/access.js';
import { createTransaction, importTransactions, importSchema, listTransactions, parseCsvRows, transactionStats } from './service.js';
import { getReconciliation, listReconciliations, reviewMatch, runReconciliation } from './reconcile.js';

const router = Router();
router.use(requireAuth);

const upload = multer({
  dest: path.join(config.storageDir, 'tmp'),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
});

async function accessOr404(req, businessId, scope = 'reconciliation.read') {
  const access = await getBusinessAccess(req.auth, businessId, scope);
  if (!access) throw notFound('Business not found');
  return access;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const businessId = String(req.query.businessId || '');
    await accessOr404(req, businessId);
    const page = pagination(req);
    const { rows, total } = await listTransactions({
      businessId,
      sourceType: req.query.sourceType,
      from: req.query.from,
      to: req.query.to,
      ...page,
    });
    res.json(listBody(rows, total, page));
  }),
);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const businessId = String(req.query.businessId || '');
    await accessOr404(req, businessId);
    res.json({ data: await transactionStats(businessId) });
  }),
);

const createSchema = z.object({
  businessId: z.string().length(26),
  sourceType: z.enum(['bank', 'mobile_money', 'payment_provider', 'accounting', 'manual']),
  provider: z.string().max(60).optional().nullable(),
  externalId: z.string().max(160).optional().nullable(),
  direction: z.enum(['credit', 'debit']),
  amount: z.coerce.number().positive().max(1_000_000_000_000),
  fee: z.coerce.number().min(0).optional(),
  currency: z.string().length(3),
  valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  postedAt: z.string().datetime().optional().nullable(),
  reference: z.string().max(160).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  counterpartyName: z.string().max(255).optional().nullable(),
});

router.post(
  '/',
  requireWriteRole,
  asyncHandler(async (req, res) => {
    const input = parse(createSchema, req.body);
    const access = await accessOr404(req, input.businessId, 'reconciliation.write');
    if (access.mode === 'granted') throw notFound('Business not found');
    res.status(201).json({ data: await createTransaction(req.auth, input) });
  }),
);

router.post(
  '/import',
  requireWriteRole,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    let input;
    let rows;
    if (req.file) {
      input = parse(importSchema, {
        businessId: req.body.businessId,
        sourceType: req.body.sourceType,
        provider: req.body.provider,
        currency: req.body.currency,
        mapping: req.body.mapping ? JSON.parse(req.body.mapping) : undefined,
      });
      rows = parseCsvRows(await import('node:fs/promises').then((fs) => fs.readFile(req.file.path)));
    } else {
      input = parse(importSchema, req.body);
      rows = input.rows;
    }
    if (!rows?.length) throw badRequest('No transaction rows supplied');
    const access = await accessOr404(req, input.businessId, 'reconciliation.write');
    if (access.mode === 'granted') throw notFound('Business not found');
    const result = await importTransactions(req.auth, input, { rows, filename: req.file?.originalname });
    res.status(201).json({ data: result });
  }),
);

export const reconciliationRouter = Router();
reconciliationRouter.use(requireAuth);

const runSchema = z.object({
  businessId: z.string().length(26),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  rules: z
    .object({
      amountAbsolute: z.number().min(0).optional(),
      amountPercent: z.number().min(0).max(100).optional(),
      dateWindowDays: z.number().int().min(0).max(365).optional(),
      exactThreshold: z.number().min(0).max(1).optional(),
      probableThreshold: z.number().min(0).max(1).optional(),
      partialThreshold: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

reconciliationRouter.post(
  '/run',
  requireWriteRole,
  asyncHandler(async (req, res) => {
    const input = parse(runSchema, req.body);
    const access = await accessOr404(req, input.businessId, 'reconciliation.write');
    if (access.mode === 'granted') throw notFound('Business not found');
    res.status(201).json({ data: await runReconciliation(req.auth, input, { ip: req.ip }) });
  }),
);

reconciliationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const businessId = String(req.query.businessId || '');
    await accessOr404(req, businessId);
    res.json({ data: await listReconciliations(businessId) });
  }),
);

reconciliationRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const recon = await getReconciliation(req.params.id);
    await accessOr404(req, recon.business_id);
    res.json({ data: recon });
  }),
);

reconciliationRouter.post(
  '/matches/:id/:decision',
  requireWriteRole,
  asyncHandler(async (req, res) => {
    const decision = req.params.decision;
    if (!['accept', 'reject'].includes(decision)) throw badRequest('decision must be accept or reject');
    res.json({ data: await reviewMatch(req.auth, req.params.id, decision === 'accept' ? 'accepted' : 'rejected', { ip: req.ip }) });
  }),
);

export default router;
