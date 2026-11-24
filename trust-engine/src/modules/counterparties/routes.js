import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { requireAuth, requireWriteRole } from '../../middleware/auth.js';
import { getBusinessAccess } from '../businesses/access.js';
import {
  confirmationPreview,
  createCounterparty,
  createCounterpartySchema,
  getCounterparty,
  listCounterparties,
  requestConfirmation,
  respondToConfirmation,
} from './service.js';

export const publicRouter = Router();

publicRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    res.json({ data: await confirmationPreview(req.params.token) });
  }),
);

publicRouter.post(
  '/:token',
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({
        decision: z.enum(['confirm', 'decline']),
        name: z.string().trim().max(255).optional(),
        email: z.string().email().max(255).optional(),
        note: z.string().trim().max(1000).optional(),
      }),
      req.body,
    );
    res.json({ data: await respondToConfirmation(req.params.token, input, { ip: req.ip }) });
  }),
);

const router = Router();
router.use(requireAuth);

async function accessOr404(req, businessId, scope = ['counterparties.read', 'invoices.read', 'trust_record.read']) {
  const access = await getBusinessAccess(req.auth, businessId, scope);
  if (!access) throw notFound('Business not found');
  return access;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const businessId = String(req.query.businessId || '');
    await accessOr404(req, businessId);
    res.json({ data: await listCounterparties(businessId) });
  }),
);

router.post(
  '/',
  requireWriteRole,
  asyncHandler(async (req, res) => {
    const input = parse(createCounterpartySchema, req.body);
    const access = await accessOr404(req, input.businessId, 'counterparties.write');
    if (access.mode === 'granted') throw notFound('Business not found');
    res.status(201).json({ data: await createCounterparty(req.auth, input) });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const cp = await getCounterparty(req.params.id);
    await accessOr404(req, cp.business_id);
    res.json({ data: cp });
  }),
);

router.post(
  '/:id/request-confirmation',
  requireWriteRole,
  asyncHandler(async (req, res) => {
    const cp = await getCounterparty(req.params.id);
    const access = await accessOr404(req, cp.business_id, 'counterparties.write');
    if (access.mode === 'granted') throw notFound('Business not found');
    const input = parse(z.object({ invoiceId: z.string().length(26) }), req.body);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.status(201).json({ data: await requestConfirmation(req.auth, cp.id, { invoiceId: input.invoiceId, baseUrl }, { ip: req.ip }) });
  }),
);

export default router;
